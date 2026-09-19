import http from 'http';
import crypto from 'crypto';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import wrtc from '@roamhq/wrtc';
import dotenv from 'dotenv';
import { LiveIngestEngine, LIVE_STATUS } from './liveIngest.js';
import { validateTelemetryFrame } from './telemetryProtocol.js';

dotenv.config({ quiet: true });

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_DIR = path.resolve(__dirname, '../dist');

export const MAX_PAYLOAD = 256 * 1024;
const MAX_PASSWORD_LENGTH = 128;
const MAX_WHITELIST_ENTRIES = 16;
const MAX_WHITELIST_ENTRY_LENGTH = 64;
const MAX_DIRECTORY_LENGTH = 256;
const MAX_SDP_LENGTH = 200 * 1024;
const MAX_CANDIDATE_LENGTH = 4096;
const MAX_CONNECTIONS = 32;
const MAX_HOST_TOKEN_LENGTH = 256;
const MIN_HOST_TOKEN_LENGTH = 16;
const MAX_CLAIM_ATTEMPTS = 5;
const MAX_AUTH_ATTEMPTS = 5;
const MAX_PENDING_ICE = 64;
const MAX_TELEMETRY_TIMESTAMP = 1e15;
export const TELEMETRY_HIGH_WATER_BYTES = 512 * 1024;
const OPEN = WebSocket.OPEN;

const MESSAGE_TYPES = new Set([
    'claim-host', 'configure', 'auth', 'start-live-ingest', 'stop-live-ingest',
    'stop-webrtc-stream', 'webrtc-restart-request', 'webrtc-offer', 'webrtc-answer',
    'webrtc-ice', 'waveform', 'vector', 'communication', 'telemetry-frame'
]);

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function boundedInteger(value, minimum, maximum) {
    if (typeof value === 'number' && Number.isInteger(value)) return value >= minimum && value <= maximum ? value : null;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
    }
    return null;
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validString(value, maximum, { allowEmpty = false } = {}) {
    if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)) return false;
    return [...value].every(character => {
        const code = character.codePointAt(0);
        return code > 31 && code !== 127;
    });
}

function validSdpString(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SDP_LENGTH) return false;
    return [...value].every(character => {
        const code = character.codePointAt(0);
        return (code >= 32 || code === 9 || code === 10 || code === 13) && code !== 127;
    });
}

function validFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_TELEMETRY_TIMESTAMP;
}

function validateSdpDescription(value, expectedType) {
    if (!isPlainObject(value) || value.type !== expectedType || !validSdpString(value.sdp)) return false;
    return value.sdp.includes('v=0') && /(?:\r?\n|^)a=/.test(value.sdp);
}

function validateCandidate(value) {
    if (!isPlainObject(value) || !validString(value.candidate, MAX_CANDIDATE_LENGTH)) return false;
    if (!value.candidate.startsWith('candidate:')) return false;
    if (value.sdpMid !== undefined && value.sdpMid !== null && !validString(value.sdpMid, 128)) return false;
    if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null && boundedInteger(value.sdpMLineIndex, 0, 128) === null) return false;
    if (value.usernameFragment !== undefined && value.usernameFragment !== null && !validString(value.usernameFragment, 256)) return false;
    return true;
}

/** Canonicalize IPv4, IPv6, and IPv4-mapped IPv6 addresses. */
export function normalizeIp(value) {
    if (typeof value !== 'string') return null;
    let address = value.trim();
    const zone = address.indexOf('%');
    if (zone >= 0) address = address.slice(0, zone);
    const ipv4Parts = address.split('.');
    if (ipv4Parts.length === 4 && ipv4Parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return ipv4Parts.map(Number).join('.');
    if (net.isIP(address) !== 6) return null;
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
        const mappedParts = mapped[1].split('.');
        if (mappedParts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return mappedParts.map(Number).join('.');
    }
    const halves = address.toLowerCase().split('::');
    if (halves.length > 2) return null;
    const expand = parts => {
        const result = [];
        for (const part of parts) {
            if (part.includes('.')) {
                if (net.isIP(part) !== 4) return null;
                const octets = part.split('.').map(Number);
                result.push(((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
            } else if (/^[0-9a-f]{1,4}$/.test(part)) result.push(part);
            else return null;
        }
        return result;
    };
    const left = expand(halves[0] ? halves[0].split(':').filter(Boolean) : []);
    const right = expand(halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : []);
    if (!left || !right) return null;
    const missing = 8 - left.length - right.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = halves.length === 1 ? left : [...left, ...Array(missing).fill('0'), ...right];
    if (groups.length !== 8) return null;
    let bestStart = -1; let bestLength = 1;
    for (let index = 0; index < groups.length;) {
        if (groups[index] !== '0') { index++; continue; }
        const start = index;
        while (index < groups.length && groups[index] === '0') index++;
        if (index - start > bestLength) { bestStart = start; bestLength = index - start; }
    }
    const compact = groups.map(group => Number.parseInt(group, 16).toString(16));
    if (bestStart >= 0) compact.splice(bestStart, bestLength, '');
    let result = compact.join(':');
    if (bestStart === 0) result = `:${result}`;
    if (bestStart + bestLength === 8) result = `${result}:`;
    return result;
}

export function normalizeWhitelist(entries) {
    if (!Array.isArray(entries)) return null;
    const normalized = [];
    for (const entry of entries) {
        const address = normalizeIp(entry);
        if (!address || normalized.includes(address)) return null;
        normalized.push(address);
    }
    return normalized;
}

function validateTelemetry(message) {
    const { type, data, timestamp } = message;
    if (!Array.isArray(data)) return 'data must be an array';
    if (timestamp !== undefined && !validFiniteNumber(timestamp)) return 'timestamp must be finite';
    if (type === 'waveform' && (data.length !== 2 || !data.every(validFiniteNumber))) return 'waveform data must contain two finite numbers';
    if (type === 'vector' && (data.length !== 9 || !data.every(item => Array.isArray(item) && item.length === 3 && item.every(validFiniteNumber)))) return 'vector data must contain nine three-number vectors';
    if (type === 'communication' && (data.length !== 3 || !data.every(item => Array.isArray(item) && item.length === 2 && item.every(validFiniteNumber)))) return 'communication data must contain three two-number points';
    return null;
}

/** Validate syntax and bounded fields before role-specific processing. */
export function validateMessage(message) {
    if (!isPlainObject(message)) return { ok: false, code: 'invalid-message', message: 'Message must be a JSON object' };
    if (!MESSAGE_TYPES.has(message.type)) return { ok: false, code: 'unknown-message', message: 'Unknown message type' };
    switch (message.type) {
        case 'claim-host':
            if (!validString(message.token, MAX_HOST_TOKEN_LENGTH) || message.token.length < MIN_HOST_TOKEN_LENGTH) return { ok: false, code: 'invalid-host-token', message: 'Host token is invalid' };
            break;
        case 'configure':
            if (boundedInteger(message.maxClients, 1, 10) === null) return { ok: false, code: 'invalid-config', message: 'maxClients must be an integer from 1 to 10' };
            if (message.password !== undefined && !validString(message.password, MAX_PASSWORD_LENGTH, { allowEmpty: true })) return { ok: false, code: 'invalid-config', message: 'password is too long or contains control characters' };
            if (message.whitelist !== undefined && (!Array.isArray(message.whitelist) || message.whitelist.length > MAX_WHITELIST_ENTRIES || !message.whitelist.every(entry => validString(entry, MAX_WHITELIST_ENTRY_LENGTH)) || normalizeWhitelist(message.whitelist) === null)) return { ok: false, code: 'invalid-config', message: 'whitelist contains invalid or duplicate IP addresses' };
            break;
        case 'auth':
            if (!validString(message.password, MAX_PASSWORD_LENGTH, { allowEmpty: true })) return { ok: false, code: 'invalid-auth', message: 'password is invalid' };
            break;
        case 'start-live-ingest':
            if (message.dir !== undefined && !validString(message.dir, MAX_DIRECTORY_LENGTH)) return { ok: false, code: 'invalid-directory', message: 'directory is invalid' };
            break;
        case 'webrtc-offer':
            if (!validateSdpDescription(message.sdp, 'offer')) return { ok: false, code: 'invalid-sdp', message: 'offer SDP is invalid' };
            break;
        case 'webrtc-answer':
            if (!validateSdpDescription(message.sdp, 'answer')) return { ok: false, code: 'invalid-sdp', message: 'answer SDP is invalid' };
            break;
        case 'webrtc-ice':
            if (message.candidate !== null && !validateCandidate(message.candidate)) return { ok: false, code: 'invalid-ice', message: 'ICE candidate is invalid' };
            break;
        case 'waveform': case 'vector': case 'communication': {
            const telemetryError = validateTelemetry(message);
            if (telemetryError) return { ok: false, code: 'invalid-telemetry', message: telemetryError };
            break;
        }
        case 'telemetry-frame': {
            const telemetryError = validateTelemetryFrame(message);
            if (telemetryError) return { ok: false, code: 'invalid-telemetry-frame', message: telemetryError };
            if (Math.abs(message.timestamp) > MAX_TELEMETRY_TIMESTAMP) return { ok: false, code: 'invalid-telemetry-frame', message: 'timestamp must be finite and bounded' };
            break;
        }
        default: break;
    }
    return { ok: true };
}

function readBoundedEnvInteger(name, fallback, minimum, maximum) {
    const parsed = boundedInteger(process.env[name], minimum, maximum);
    if (parsed === null) {
        if (process.env[name] !== undefined) console.warn(`${name} is invalid; using ${fallback}.`);
        return fallback;
    }
    return parsed;
}
function readHost() {
    const value = process.env.HOST;
    if (value === undefined) return '127.0.0.1';
    if (!validString(value, 255) || /\s/.test(value)) {
        console.warn('HOST is invalid; using 127.0.0.1.');
        return '127.0.0.1';
    }
    return value;
}
function generatePassword() {
    return crypto.randomBytes(8).toString('hex');
}

function safeClosePeerConnection(pc) {
    if (pc) {
        try {
            pc.close();
        } catch {
            // Already closed
        }
    }
}

function safeCloseSocket(ws, code = 1000, reason = '') {
    if (!ws) return;
    try {
        ws.close(code, reason);
    } catch {
        // Already closed
    }
}

function resolveHostToken(injected) {
    const candidate = injected ?? process.env.HOST_TOKEN;
    if (candidate !== undefined && validString(candidate, MAX_HOST_TOKEN_LENGTH) && candidate.length >= MIN_HOST_TOKEN_LENGTH) {
        return candidate;
    }
    if (candidate !== undefined) {
        console.warn('HOST_TOKEN is invalid; generating a new token.');
    }
    return crypto.randomBytes(32).toString('hex');
}

function tokenEquals(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createServer({ staticDir = DEFAULT_STATIC_DIR, logger = console, hostToken, heartbeatIntervalMs = 15000, heartbeatTimeoutMs = 30000, hostReconnectGraceMs = 10000 } = {}) {
    const resolvedStaticDir = path.resolve(staticDir);
    const generatedHostToken = resolveHostToken(hostToken);
    let sessionState = 'IDLE';
    let hostConfig = { maxClients: 3, password: '', whitelist: [] };
    const connectedSockets = new Map();
    const viewerPCs = new Map();
    const messageQueues = new Map();
    const iceQueues = new Map();
    const pendingPeerTasks = new Set();
    let hostPC = null;
    let hostTracks = [];
    let liveIngestEngine = null;
    let liveIngestDirectory = null;
    let hostSocket = null;
    let hostReconnectTimer = null;
    let hostPeerGeneration = 0;
    let heartbeatTimer = null;
    let isClosing = false;
    let latestTelemetryFrame = null;
    const scheduledTimers = new Set();
    const schedule = (callback, delay) => {
        const timer = setTimeout(() => {
            scheduledTimers.delete(timer);
            callback();
        }, delay);
        scheduledTimers.add(timer);
        return timer;
    };
    const clearScheduled = timer => {
        if (timer) {
            clearTimeout(timer);
            scheduledTimers.delete(timer);
        }
    };
    const logError = (message, error) => logger.error(message, error?.message || error || 'unknown error');

    const isTelemetryPayload = payload => {
        if (typeof payload === 'string') {
            return payload.includes('"telemetry-frame"') ||
                   payload.includes('"waveform"') ||
                   payload.includes('"vector"') ||
                   payload.includes('"communication"');
        }
        return payload?.type === 'telemetry-frame' || ['waveform', 'vector', 'communication'].includes(payload?.type);
    };

    const safeSend = (ws, payload, telemetry = isTelemetryPayload(payload)) => {
        if (!ws || ws.readyState !== OPEN || isClosing) return false;
        if (telemetry && ws.bufferedAmount > TELEMETRY_HIGH_WATER_BYTES) return false;
        try {
            const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
            ws.send(data, error => {
                if (error && ws.readyState === OPEN && !isClosing) {
                    logError('WebSocket send failed', error);
                }
            });
            return true;
        } catch (error) {
            if (ws.readyState === OPEN && !isClosing) {
                logError('WebSocket send failed', error);
            }
            return false;
        }
    };
    const protocolError = (ws, code, message) => safeSend(ws, { type: 'protocol-error', code, message });
    const sendState = (ws, state, role) => safeSend(ws, { type: 'server-state', state, role });
    function stopHostTracks() {
        for (const track of hostTracks) {
            try { track.stop(); } catch { /* closed */ }
        }
        hostTracks = [];
    }
    function notifyStreamStatus(active) {
        for (const [sock, info] of connectedSockets.entries()) {
            if (info.role === 'viewer' && info.authenticated) {
                safeSend(sock, { type: 'stream-status', active });
            }
        }
    }
    function clearIceQueue(ws) {
        iceQueues.delete(ws);
    }
    function setIcePeer(ws, pc, remoteDescriptionSet = false) {
        iceQueues.set(ws, { pc, remoteDescriptionSet, candidates: [] });
    }
    async function flushIceQueue(ws) {
        const state = iceQueues.get(ws);
        if (!state || !state.pc || !state.remoteDescriptionSet) return;
        const candidates = state.candidates.splice(0);
        for (const candidate of candidates) {
            if (state.pc.connectionState === 'closed') return;
            await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }
    async function addOrQueueIce(ws, candidate) {
        if (candidate === null) return;
        const state = iceQueues.get(ws);
        if (!state || !state.pc || !state.remoteDescriptionSet) {
            const queue = state?.candidates || [];
            if (queue.length >= MAX_PENDING_ICE) throw new Error('ICE candidate queue is full');
            if (state) state.candidates.push(candidate);
            else iceQueues.set(ws, { pc: null, remoteDescriptionSet: false, candidates: [candidate] });
            return;
        }
        await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    function stopHostMedia() {
        const hadMedia = Boolean(hostPC || hostTracks.length || viewerPCs.size);
        hostPeerGeneration += 1;
        const currentHostPC = hostPC;
        hostPC = null;
        safeClosePeerConnection(currentHostPC);
        if (hostSocket) clearIceQueue(hostSocket);
        stopHostTracks();
        for (const [sock, pc] of viewerPCs.entries()) {
            viewerPCs.delete(sock);
            clearIceQueue(sock);
            safeClosePeerConnection(pc);
        }
        if (hadMedia) notifyStreamStatus(false);
    }
    function broadcastPayload(message) {
        if (message?.type === 'telemetry-frame') latestTelemetryFrame = message;
        const raw = JSON.stringify(message);
        for (const [sock, info] of connectedSockets.entries()) {
            if (info.authenticated && (info.role === 'host' || info.role === 'viewer')) {
                safeSend(sock, raw, true);
            }
        }
    }
    function broadcastLiveStatus(status, detail) {
        if (!hostSocket) return;
        const message = { type: 'live-ingest-status', status, ...(typeof detail === 'string' ? { detail } : {}) };
        safeSend(hostSocket, message, false);
    }
    async function stopLiveIngest({ pause = false } = {}) {
        if (!liveIngestEngine) return;
        if (pause) {
            liveIngestEngine.pause();
            broadcastLiveStatus(LIVE_STATUS.PAUSED);
            return;
        }
        await liveIngestEngine.stop();
        liveIngestEngine = null;
        liveIngestDirectory = null;
        latestTelemetryFrame = null;
    }
    async function startLiveIngest(dirPath) {
        const requestedDirectory = dirPath || './src/data';
        if (liveIngestEngine && liveIngestDirectory !== path.resolve(process.cwd(), requestedDirectory)) await stopLiveIngest();
        if (!liveIngestEngine) {
            liveIngestEngine = new LiveIngestEngine({
                onFrame: frame => broadcastPayload(frame),
                onStatus: event => broadcastLiveStatus(event.status, event.status === LIVE_STATUS.ERROR ? 'Live ingest encountered a read error' : undefined),
                onWarning: event => (logger.warn || logger.error || (() => {}))(`Live ingest warning: ${event.message}`)
            });
        }
        try {
            const result = await liveIngestEngine.start(requestedDirectory);
            liveIngestDirectory = result.directory;
        } catch (error) {
            broadcastLiveStatus(LIVE_STATUS.ERROR, 'Live data directory or files are not available');
            throw error;
        }
    }
    async function setupViewerPC(ws) {
        const info = connectedSockets.get(ws);
        if (!info || info.role !== 'viewer' || !info.authenticated || ws.readyState !== OPEN || hostTracks.length === 0) {
            return;
        }

        const existingPC = viewerPCs.get(ws);
        if (existingPC) {
            viewerPCs.delete(ws);
            safeClosePeerConnection(existingPC);
        }
        clearIceQueue(ws);

        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        viewerPCs.set(ws, pc);
        setIcePeer(ws, pc, false);

        pc.onconnectionstatechange = () => {
            if (viewerPCs.get(ws) !== pc || !['failed', 'closed'].includes(pc.connectionState)) return;
            viewerPCs.delete(ws);
            clearIceQueue(ws);
            safeClosePeerConnection(pc);
            safeSend(ws, { type: 'stream-status', active: false });
        };

        try {
            hostTracks.forEach(track => {
                try {
                    pc.addTrack(track);
                } catch (error) {
                    logError('Unable to add host track', error);
                }
            });

            const pendingLocalCandidates = [];
            let offerSent = false;

            pc.onicecandidate = event => {
                if (!event.candidate || viewerPCs.get(ws) !== pc || ws.readyState !== OPEN) return;
                if (!offerSent) {
                    pendingLocalCandidates.push(event.candidate);
                } else {
                    safeSend(ws, { type: 'webrtc-ice', candidate: event.candidate });
                }
            };

            const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
            if (viewerPCs.get(ws) !== pc || ws.readyState !== OPEN) return;

            await pc.setLocalDescription(offer);
            if (viewerPCs.get(ws) !== pc || ws.readyState !== OPEN) return;

            safeSend(ws, { type: 'webrtc-offer', sdp: pc.localDescription });
            offerSent = true;

            for (const candidate of pendingLocalCandidates.splice(0)) {
                safeSend(ws, { type: 'webrtc-ice', candidate });
            }
        } catch (error) {
            if (viewerPCs.get(ws) === pc) viewerPCs.delete(ws);
            clearIceQueue(ws);
            safeClosePeerConnection(pc);
            throw error;
        }
    }

    async function handleHostOffer(ws, sdp) {
        if (hostSocket !== ws || ws.readyState !== OPEN) return;
        if (hostPC) safeClosePeerConnection(hostPC);
        stopHostTracks();

        const pendingCandidates = iceQueues.get(ws)?.candidates || [];
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        hostPC = pc;
        const peerGeneration = ++hostPeerGeneration;
        setIcePeer(ws, pc, false);
        iceQueues.get(ws).candidates = pendingCandidates;

        pc.onconnectionstatechange = () => {
            if (hostPC === pc && ['failed', 'closed'].includes(pc.connectionState)) {
                stopHostMedia();
            }
        };

        pc.ontrack = event => {
            const task = Promise.resolve().then(async () => {
                if (hostPC !== pc || peerGeneration !== hostPeerGeneration || !connectedSockets.has(ws)) return;
                if (!hostTracks.includes(event.track)) hostTracks.push(event.track);

                event.track.onended = () => {
                    if (hostPC === pc && peerGeneration === hostPeerGeneration && hostTracks.includes(event.track)) {
                        stopHostMedia();
                    }
                };

                for (const [sock, info] of connectedSockets.entries()) {
                    if (info.role === 'viewer' && info.authenticated) {
                        safeSend(sock, { type: 'stream-status', active: true });
                        try {
                            await setupViewerPC(sock);
                        } catch (error) {
                            logError('Viewer peer setup failed', error);
                            safeSend(sock, { type: 'stream-status', active: false });
                        }
                    }
                }
            }).catch(error => logError('Viewer peer setup failed', error));

            pendingPeerTasks.add(task);
            task.finally(() => pendingPeerTasks.delete(task)).catch(() => {});
        };

        pc.onicecandidate = event => {
            if (event.candidate && hostPC === pc && ws.readyState === OPEN) {
                safeSend(ws, { type: 'webrtc-ice', candidate: event.candidate });
            }
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const state = iceQueues.get(ws);
            if (state) state.remoteDescriptionSet = true;
            await flushIceQueue(ws);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (hostPC === pc) safeSend(ws, { type: 'webrtc-answer', sdp: pc.localDescription });
        } catch (error) {
            if (hostPC === pc) {
                stopHostMedia();
            } else {
                clearIceQueue(ws);
                stopHostTracks();
                safeClosePeerConnection(pc);
            }
            throw error;
        }
    }

    function resetSession(reason = 'Host disconnected') {
        if (hostReconnectTimer) {
            clearScheduled(hostReconnectTimer);
            hostReconnectTimer = null;
        }
        void stopLiveIngest();
        stopHostMedia();
        sessionState = 'IDLE';
        hostSocket = null;
        hostConfig = { maxClients: 3, password: '', whitelist: [] };
        latestTelemetryFrame = null;

        for (const [sock] of connectedSockets.entries()) {
            safeSend(sock, { type: 'server-reset', message: reason });
            safeCloseSocket(sock, 1008, reason);
        }
        connectedSockets.clear();
        viewerPCs.clear();
        iceQueues.clear();
        messageQueues.clear();
    }

    function handleDisconnect(ws) {
        const client = connectedSockets.get(ws);
        clearIceQueue(ws);
        messageQueues.delete(ws);
        if (!client) return;

        connectedSockets.delete(ws);
        const viewerPC = viewerPCs.get(ws);
        viewerPCs.delete(ws);
        if (viewerPC) safeClosePeerConnection(viewerPC);

        if (client.role === 'host' && hostSocket === ws) {
            hostSocket = null;
            void stopLiveIngest({ pause: true });
            stopHostMedia();
            if (!isClosing) {
                if (hostReconnectTimer) clearScheduled(hostReconnectTimer);
                hostReconnectTimer = schedule(() => resetSession('Host disconnected'), hostReconnectGraceMs);
            }
        }
    }

    function ipAllowed(info) {
        return hostConfig.whitelist.length === 0 || hostConfig.whitelist.includes(info.ip);
    }

    function promoteWaitingClients() {
        for (const [sock, info] of connectedSockets.entries()) {
            if (info.role === 'waiting') {
                if (!ipAllowed(info)) {
                    protocolError(sock, 'ip-not-allowed', 'This client is not allowed by the host IP policy');
                    safeCloseSocket(sock, 1008, 'IP not allowed');
                } else {
                    info.role = 'viewer';
                    info.authenticated = false;
                    sendState(sock, 'ACTIVE', 'viewer-auth-required');
                }
            }
        }
    }

    function authorize(client, type) {
        const allowed = {
            host: new Set([
                'configure', 'start-live-ingest', 'stop-live-ingest', 'stop-webrtc-stream',
                'webrtc-offer', 'webrtc-ice', 'waveform', 'vector', 'communication', 'telemetry-frame'
            ]),
            viewer: new Set(['auth', 'webrtc-answer', 'webrtc-ice', 'webrtc-restart-request']),
            waiting: new Set(['claim-host'])
        };

        if (type === 'claim-host') return null;
        if (!allowed[client.role]?.has(type)) return 'Message is not allowed for this connection role';

        if (type === 'configure' && (sessionState !== 'CONFIGURING' && sessionState !== 'ACTIVE' || !client.authenticated || client.role !== 'host')) {
            return 'Session is not configurable';
        }
        if (type === 'auth' && (sessionState !== 'ACTIVE' || client.authenticated || client.authLocked)) {
            return 'Authentication is not allowed now';
        }
        if (
            ['start-live-ingest', 'stop-live-ingest', 'webrtc-offer', 'waveform', 'vector', 'communication', 'telemetry-frame', 'stop-webrtc-stream'].includes(type) &&
            (sessionState !== 'ACTIVE' || !client.authenticated || client.role !== 'host' || hostSocket === null)
        ) {
            return 'Session is not active';
        }
        if (
            ['webrtc-answer', 'webrtc-ice', 'webrtc-restart-request'].includes(type) &&
            (!client.authenticated || sessionState !== 'ACTIVE')
        ) {
            return 'Authentication is required';
        }
        return null;
    }

    async function processMessage(ws, message) {
        const client = connectedSockets.get(ws);
        if (!client) return;

        let parsed;
        try {
            parsed = JSON.parse(message.toString());
        } catch {
            protocolError(ws, 'invalid-json', 'Message must contain valid JSON');
            return;
        }

        const validation = validateMessage(parsed);
        if (!validation.ok) {
            protocolError(ws, validation.code, validation.message);
            return;
        }

        if (parsed.type === 'claim-host') {
            if (client.role !== 'waiting' || hostSocket) {
                protocolError(ws, 'host-unavailable', 'Host is already claimed');
                return;
            }
            client.claimAttempts += 1;
            if (!tokenEquals(parsed.token, generatedHostToken)) {
                if (client.claimAttempts >= MAX_CLAIM_ATTEMPTS) {
                    protocolError(ws, 'host-claim-locked', 'Too many host claim attempts');
                    safeCloseSocket(ws, 1008, 'Too many attempts');
                } else {
                    protocolError(ws, 'invalid-host-token', 'Host token is invalid');
                }
                return;
            }

            client.role = 'host';
            client.authenticated = true;
            hostSocket = ws;
            if (hostReconnectTimer) {
                clearScheduled(hostReconnectTimer);
                hostReconnectTimer = null;
            }
            if (sessionState === 'IDLE') sessionState = 'CONFIGURING';
            sendState(ws, sessionState, 'host');
            if (sessionState === 'ACTIVE') promoteWaitingClients();
            return;
        }

        const authorizationError = authorize(client, parsed.type);
        if (authorizationError) {
            protocolError(ws, 'not-authorized', authorizationError);
            return;
        }

        try {
            if (parsed.type === 'configure') {
                hostConfig = {
                    maxClients: boundedInteger(parsed.maxClients, 1, 10),
                    password: parsed.password || generatePassword(),
                    whitelist: normalizeWhitelist(parsed.whitelist || [])
                };
                sessionState = 'ACTIVE';
                safeSend(ws, { type: 'config-success', password: hostConfig.password });
                promoteWaitingClients();
            } else if (parsed.type === 'start-live-ingest') {
                await startLiveIngest(parsed.dir);
            } else if (parsed.type === 'stop-live-ingest') {
                await stopLiveIngest();
                broadcastLiveStatus(LIVE_STATUS.STOPPED);
            } else if (parsed.type === 'stop-webrtc-stream') {
                stopHostMedia();
            } else if (parsed.type === 'webrtc-restart-request') {
                if (Date.now() - (client.lastRestartAt || 0) < 500) {
                    protocolError(ws, 'restart-rate-limited', 'Stream restart is temporarily rate limited');
                    return;
                }
                client.lastRestartAt = Date.now();
                if (hostTracks.length > 0) {
                    await setupViewerPC(ws);
                    safeSend(ws, { type: 'stream-status', active: true });
                } else {
                    safeSend(ws, { type: 'stream-status', active: false });
                }
            } else if (parsed.type === 'auth') {
                if (!ipAllowed(client)) {
                    safeSend(ws, { type: 'auth-fail', message: 'Client IP is not allowed' });
                    if (!client.authCloseTimer) {
                        client.authCloseTimer = schedule(() => safeCloseSocket(ws, 1008, 'IP not allowed'), 100);
                    }
                    return;
                }
                if (parsed.password !== hostConfig.password) {
                    client.authAttempts = (client.authAttempts || 0) + 1;
                    if (client.authAttempts >= MAX_AUTH_ATTEMPTS) client.authLocked = true;
                    safeSend(ws, { type: 'auth-fail', message: 'Invalid password' });
                    if (client.authLocked && !client.authCloseTimer) {
                        client.authCloseTimer = schedule(() => safeCloseSocket(ws, 1008, 'Too many authentication attempts'), 100);
                    }
                    return;
                }

                const viewers = [...connectedSockets.values()].filter(item => item.role === 'viewer' && item.authenticated);
                if (viewers.length >= hostConfig.maxClients) {
                    safeSend(ws, { type: 'auth-fail', message: 'Room is full' });
                    schedule(() => safeCloseSocket(ws, 1008, 'Full'), 100);
                    return;
                }

                client.authenticated = true;
                client.authAttempts = 0;
                client.authLocked = false;
                safeSend(ws, { type: 'auth-success' });

                if (latestTelemetryFrame) safeSend(ws, latestTelemetryFrame, true);
                if (hostTracks.length > 0) {
                    await setupViewerPC(ws);
                    safeSend(ws, { type: 'stream-status', active: true });
                } else {
                    safeSend(ws, { type: 'stream-status', active: false });
                }
            } else if (parsed.type === 'webrtc-offer') {
                await handleHostOffer(ws, parsed.sdp);
            } else if (parsed.type === 'webrtc-answer') {
                const pc = viewerPCs.get(ws);
                if (!pc) throw new Error('No viewer peer connection exists');
                await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
                const state = iceQueues.get(ws);
                if (state && state.pc === pc) {
                    state.remoteDescriptionSet = true;
                    await flushIceQueue(ws);
                }
            } else if (parsed.type === 'webrtc-ice') {
                if (client.role === 'host' && hostSocket !== ws) return;
                await addOrQueueIce(ws, parsed.candidate);
            } else if (['waveform', 'vector', 'communication', 'telemetry-frame'].includes(parsed.type)) {
                if (parsed.type === 'telemetry-frame') latestTelemetryFrame = parsed;
                const raw = typeof message === 'string' ? message : message.toString();
                for (const [sock, info] of connectedSockets.entries()) {
                    if (sock !== ws && info.role === 'viewer' && info.authenticated) {
                        safeSend(sock, raw, true);
                    }
                }
            }
        } catch (error) {
            logError(`Failed to process ${parsed.type}`, error);
            protocolError(
                ws,
                parsed.type.startsWith('webrtc-') ? 'invalid-webrtc' : 'server-error',
                error?.message === 'ICE candidate queue is full' ? 'ICE candidate queue is full' : 'Request could not be completed'
            );
        }
    }

    const HEALTHZ_PAYLOAD = Buffer.from(JSON.stringify({ status: 'ok' }));

    const httpServer = http.createServer((request, response) => {
        try {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                response.writeHead(405, { Allow: 'GET, HEAD' });
                response.end('Method Not Allowed');
                return;
            }

            const requestUrl = new URL(request.url || '/', 'http://localhost');
            if (requestUrl.pathname === '/healthz') {
                response.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': HEALTHZ_PAYLOAD.length
                });
                response.end(request.method === 'HEAD' ? undefined : HEALTHZ_PAYLOAD);
                return;
            }

            let pathname;
            try {
                pathname = decodeURIComponent(requestUrl.pathname);
            } catch {
                response.writeHead(400);
                response.end('Bad Request');
                return;
            }

            const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
            const candidate = path.resolve(resolvedStaticDir, relativePath);
            if (candidate !== resolvedStaticDir && !candidate.startsWith(`${resolvedStaticDir}${path.sep}`)) {
                response.writeHead(400);
                response.end('Bad Request');
                return;
            }

            let filePath = candidate;
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                if (path.extname(pathname)) {
                    response.writeHead(404);
                    response.end('Not Found');
                    return;
                }
                filePath = path.join(resolvedStaticDir, 'index.html');
            }

            if (!fs.existsSync(filePath)) {
                response.writeHead(503);
                response.end('Built application not found');
                return;
            }

            const body = fs.readFileSync(filePath);
            response.writeHead(200, {
                'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
                'Content-Length': body.length,
                'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
            });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch (error) {
            logError('HTTP request failed', error);
            if (!response.headersSent) response.writeHead(500);
            response.end('Internal Server Error');
        }
    });

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
    wss.on('error', error => logError('WebSocket server error', error));

    httpServer.on('upgrade', (request, socket, head) => {
        let pathname;
        try {
            pathname = new URL(request.url || '/', 'http://localhost').pathname;
        } catch {
            socket.destroy();
            return;
        }

        if (pathname !== '/ws') {
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
    });

    wss.on('connection', (ws, request) => {
        const ip = normalizeIp(request.socket.remoteAddress || '') || 'unknown';
        if (connectedSockets.size >= MAX_CONNECTIONS) {
            safeSend(ws, { type: 'protocol-error', code: 'server-busy', message: 'Server connection limit reached' });
            ws.close(1013, 'Server busy');
            return;
        }

        const activeViewer = sessionState === 'ACTIVE' && hostSocket !== null;
        const info = {
            role: activeViewer ? 'viewer' : 'waiting',
            ip,
            authenticated: false,
            claimAttempts: 0,
            isAlive: true,
            lastPongAt: Date.now()
        };

        connectedSockets.set(ws, info);
        ws.on('error', error => logError('WebSocket client error', error));
        ws.on('pong', () => {
            const current = connectedSockets.get(ws);
            if (current) {
                current.isAlive = true;
                current.lastPongAt = Date.now();
            }
        });
        ws.on('close', () => handleDisconnect(ws));
        sendState(ws, sessionState, activeViewer ? 'viewer-auth-required' : 'waiting');

        ws.on('message', message => {
            const previous = messageQueues.get(ws) || Promise.resolve();
            const queued = previous
                .then(() => processMessage(ws, message))
                .catch(error => logError('WebSocket message handling failed', error));
            messageQueues.set(ws, queued);
            queued.finally(() => {
                if (messageQueues.get(ws) === queued) messageQueues.delete(ws);
            }).catch(() => {});
        });
    });

    heartbeatTimer = setInterval(() => {
        for (const [ws, info] of connectedSockets.entries()) {
            if (!info.isAlive || Date.now() - info.lastPongAt > heartbeatTimeoutMs) {
                try {
                    ws.terminate();
                } catch {
                    // Socket already closed
                }
                continue;
            }
            info.isAlive = false;
            try {
                if (ws.readyState === OPEN) ws.ping();
            } catch {
                try {
                    ws.terminate();
                } catch {
                    // Socket already closed
                }
            }
        }
    }, heartbeatIntervalMs);

    async function close() {
        if (isClosing) return;
        isClosing = true;

        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (hostReconnectTimer) {
            clearScheduled(hostReconnectTimer);
            hostReconnectTimer = null;
        }
        for (const timer of scheduledTimers) clearScheduled(timer);

        await stopLiveIngest();
        stopHostMedia();
        await Promise.allSettled([...pendingPeerTasks]);

        for (const ws of connectedSockets.keys()) {
            try {
                ws.close(1001, 'Server shutting down');
            } catch {
                // Socket already closed
            }
        }

        connectedSockets.clear();
        viewerPCs.clear();
        iceQueues.clear();
        messageQueues.clear();

        await new Promise(resolve => wss.close(() => resolve()));
        if (httpServer.listening) await new Promise(resolve => httpServer.close(() => resolve()));
    }

    return {
        httpServer,
        wss,
        close,
        getState: () => ({
            sessionState,
            hostConfig: { ...hostConfig, whitelist: [...hostConfig.whitelist] },
            connectedClients: connectedSockets.size
        }),
        announceHostToken: () => generatedHostToken
    };
}

export function startServer({ host = readHost(), port = readBoundedEnvInteger('PORT', 8181, 1, 65535), ...options } = {}) {
    const app = createServer(options);
    return new Promise((resolve, reject) => {
        const onError = error => {
            app.httpServer.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            app.httpServer.off('error', onError);
            console.log(`SFU server listening on http://${host}:${port} (WebSocket /ws)`);
            console.log(`HOST_TOKEN=${app.announceHostToken()}`);
            resolve({ ...app, host, port });
        };
        app.httpServer.once('error', onError);
        app.httpServer.once('listening', onListening);
        app.httpServer.listen(port, host);
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const serverPromise = startServer();
    serverPromise.catch(error => {
        console.error(`Unable to start SFU server: ${error.message}`);
        process.exitCode = 1;
    });

    const shutdown = async signal => {
        try {
            const app = await serverPromise;
            await app.close();
            console.log(`Server stopped (${signal}).`);
        } catch {
            // Shutdown completed
        }
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}
