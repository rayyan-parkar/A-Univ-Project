import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import wrtc from '@roamhq/wrtc';
import dotenv from 'dotenv';

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
const MAX_TELEMETRY_TIMESTAMP = 1e15;
const TARPIT_MS = 5000;
const OPEN = WebSocket.OPEN;

const MESSAGE_TYPES = new Set([
    'configure', 'auth', 'start-live-ingest', 'stop-live-ingest', 'webrtc-offer',
    'webrtc-answer', 'webrtc-ice', 'waveform', 'vector', 'communication'
]);

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function boundedInteger(value, minimum, maximum) {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value >= minimum && value <= maximum ? value : null;
    }
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
    for (const character of value) {
        const code = character.codePointAt(0);
        if (code <= 31 || code === 127) return false;
    }
    return true;
}

function validSdpString(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SDP_LENGTH) return false;
    for (const character of value) {
        const code = character.codePointAt(0);
        if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return false;
    }
    return true;
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

function validateTelemetry(message) {
    const { type, data, timestamp } = message;
    if (!Array.isArray(data)) return 'data must be an array';
    if (timestamp !== undefined && !validFiniteNumber(timestamp)) return 'timestamp must be finite';
    if (type === 'waveform') {
        if (data.length !== 2 || !data.every(validFiniteNumber)) return 'waveform data must contain two finite numbers';
    } else if (type === 'vector') {
        if (data.length !== 9 || !data.every(item => Array.isArray(item) && item.length === 3 && item.every(validFiniteNumber))) {
            return 'vector data must contain nine three-number vectors';
        }
    } else if (type === 'communication') {
        if (data.length !== 3 || !data.every(item => Array.isArray(item) && item.length === 2 && item.every(validFiniteNumber))) {
            return 'communication data must contain three two-number points';
        }
    }
    return null;
}

/** Validate syntax and bounded fields before role-specific processing. */
export function validateMessage(message) {
    if (!isPlainObject(message)) return { ok: false, code: 'invalid-message', message: 'Message must be a JSON object' };
    if (!MESSAGE_TYPES.has(message.type)) return { ok: false, code: 'unknown-message', message: 'Unknown message type' };
    switch (message.type) {
        case 'configure':
            if (boundedInteger(message.maxClients, 1, 10) === null) return { ok: false, code: 'invalid-config', message: 'maxClients must be an integer from 1 to 10' };
            if (message.password !== undefined && !validString(message.password, MAX_PASSWORD_LENGTH, { allowEmpty: true })) return { ok: false, code: 'invalid-config', message: 'password is too long or contains control characters' };
            if (message.whitelist !== undefined && (!Array.isArray(message.whitelist) || message.whitelist.length > MAX_WHITELIST_ENTRIES || !message.whitelist.every(entry => validString(entry, MAX_WHITELIST_ENTRY_LENGTH)))) return { ok: false, code: 'invalid-config', message: 'whitelist contains invalid entries' };
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
        case 'stop-live-ingest': break;
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

function generatePassword() { return crypto.randomBytes(8).toString('hex'); }

function safeClosePeerConnection(pc) {
    if (!pc) return;
    try { pc.close(); } catch { /* already closed */ }
}

export function createServer({ staticDir = DEFAULT_STATIC_DIR, logger = console } = {}) {
    const resolvedStaticDir = path.resolve(staticDir);
    let sessionState = 'IDLE';
    let hostConfig = { maxClients: 3, password: '', whitelist: [] };
    const connectedSockets = new Map();
    const viewerPCs = new Map();
    const messageQueues = new Map();
    const pendingPeerTasks = new Set();
    let hostPC = null;
    let hostTracks = [];
    let liveIngestInterval = null;
    let liveIndices = { spherical: 0, vibration: 0, communication: 0 };

    const logError = (message, error) => logger.error(message, error?.message || error || 'unknown error');
    function stopHostTracks() {
        for (const track of hostTracks) {
            try { track.stop(); } catch { /* already stopped */ }
        }
        hostTracks = [];
    }
    function safeSend(ws, payload) {
        if (!ws || ws.readyState !== OPEN) return false;
        const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
        try {
            ws.send(raw, error => { if (error) logError('WebSocket send failed', error); });
            return true;
        } catch (error) { logError('WebSocket send failed', error); return false; }
    }
    function protocolError(ws, code, message) { safeSend(ws, { type: 'protocol-error', code, message }); }

    function stopLiveIngest() {
        if (liveIngestInterval) {
            clearInterval(liveIngestInterval);
            liveIngestInterval = null;
            logger.info('Live experiment ingest stopped.');
        }
    }
    function broadcastPayload(message) {
        for (const [sock, info] of connectedSockets.entries()) {
            if (info.authenticated && (info.role === 'host' || info.role === 'viewer')) safeSend(sock, message);
        }
    }
    function startLiveIngest(dirPath) {
        stopLiveIngest();
        const resolvedDir = path.resolve(process.cwd(), dirPath || './src/data');
        liveIndices = { spherical: 0, vibration: 0, communication: 0 };
        logger.info(`Starting live experiment ingest from: ${resolvedDir}`);
        const parseFloats = line => line ? line.split(/\s+/).map(Number).filter(Number.isFinite) : [];
        const loadLinesSafe = filename => {
            try { return fs.readFileSync(path.join(resolvedDir, filename), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean); } catch { return []; }
        };
        liveIngestInterval = setInterval(() => {
            try {
                const now = Date.now();
                const vibLines = loadLinesSafe('VibrationData.txt');
                const fpgaLines = loadLinesSafe('VibrationData_FPGA.txt');
                const vibLen = Math.min(vibLines.length, fpgaLines.length);
                if (liveIndices.vibration < vibLen) {
                    const v = parseFloats(vibLines[liveIndices.vibration]); const f = parseFloats(fpgaLines[liveIndices.vibration]);
                    if (v.length > 0 && f.length > 0) broadcastPayload({ type: 'waveform', data: [v[0], f[0]], timestamp: now });
                    liveIndices.vibration++;
                }
                const sLow = loadLinesSafe('SphericalData_low.txt'); const sMed = loadLinesSafe('SphericalData_medium.txt'); const sHigh = loadLinesSafe('SphericalData_high.txt');
                const sLen = Math.min(sLow.length, sMed.length, sHigh.length);
                if (liveIndices.spherical < sLen) {
                    const l = parseFloats(sLow[liveIndices.spherical]); const m = parseFloats(sMed[liveIndices.spherical]); const h = parseFloats(sHigh[liveIndices.spherical]);
                    if (l.length >= 9 && m.length >= 9 && h.length >= 9) broadcastPayload({ type: 'vector', data: [[l[0], l[1], l[2]], [l[3], l[4], l[5]], [l[6], l[7], l[8]], [m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]], [h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]]], timestamp: now });
                    liveIndices.spherical++;
                }
                const cLow = loadLinesSafe('CommunicationData_low.txt'); const cMed = loadLinesSafe('CommunicationData_medium.txt'); const cHigh = loadLinesSafe('CommunicationData_high.txt');
                const cLen = Math.min(cLow.length, cMed.length, cHigh.length);
                if (liveIndices.communication < cLen) {
                    const l = parseFloats(cLow[liveIndices.communication]); const m = parseFloats(cMed[liveIndices.communication]); const h = parseFloats(cHigh[liveIndices.communication]);
                    if (l.length >= 2 && m.length >= 2 && h.length >= 2) broadcastPayload({ type: 'communication', data: [[l[0], l[1]], [m[0], m[1]], [h[0], h[1]]], timestamp: now });
                    liveIndices.communication++;
                }
            } catch (error) { logError('Live experiment ingest tick failed', error); }
        }, 16);
    }

    async function setupViewerPC(ws) {
        const existingPC = viewerPCs.get(ws);
        if (existingPC) safeClosePeerConnection(existingPC);
        viewerPCs.delete(ws);
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        viewerPCs.set(ws, pc);
        try {
            hostTracks.forEach(track => pc.addTrack(track));
            pc.onicecandidate = event => { if (event.candidate) safeSend(ws, { type: 'webrtc-ice', candidate: event.candidate }); };
            const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
            await pc.setLocalDescription(offer);
            safeSend(ws, { type: 'webrtc-offer', sdp: pc.localDescription });
        } catch (error) {
            if (viewerPCs.get(ws) === pc) viewerPCs.delete(ws);
            safeClosePeerConnection(pc);
            throw error;
        }
    }
    async function handleHostOffer(ws, sdp) {
        if (hostPC) safeClosePeerConnection(hostPC);
        stopHostTracks();
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        hostPC = pc;
        pc.ontrack = event => {
            const task = Promise.resolve().then(async () => {
                if (!hostTracks.includes(event.track)) hostTracks.push(event.track);
                logger.info(`Received track from host: ${event.track.kind}`);
                for (const [sock, info] of connectedSockets.entries()) if (info.role === 'viewer' && info.authenticated) {
                    safeSend(sock, { type: 'stream-status', active: true }); await setupViewerPC(sock);
                }
            }).catch(error => logError('Viewer peer setup failed', error));
            pendingPeerTasks.add(task);
            task.finally(() => pendingPeerTasks.delete(task)).catch(() => {});
        };
        pc.onicecandidate = event => { if (event.candidate) safeSend(ws, { type: 'webrtc-ice', candidate: event.candidate }); };
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
            safeSend(ws, { type: 'webrtc-answer', sdp: pc.localDescription });
        } catch (error) {
            if (hostPC === pc) hostPC = null;
            stopHostTracks(); safeClosePeerConnection(pc); throw error;
        }
    }
    function handleDisconnect(ws) {
        const client = connectedSockets.get(ws); messageQueues.delete(ws); if (!client) return;
        connectedSockets.delete(ws);
        const viewerPC = viewerPCs.get(ws); if (viewerPC) safeClosePeerConnection(viewerPC); viewerPCs.delete(ws);
        if (client.role === 'host') {
            logger.info('Host disconnected. Resetting session.'); stopLiveIngest(); sessionState = 'IDLE';
            safeClosePeerConnection(hostPC); hostPC = null; stopHostTracks();
            for (const [sock] of connectedSockets.entries()) { safeSend(sock, { type: 'server-reset', message: 'Host disconnected' }); try { sock.close(1008, 'Host disconnected'); } catch { /* closed */ } }
            connectedSockets.clear(); for (const pc of viewerPCs.values()) safeClosePeerConnection(pc); viewerPCs.clear();
        }
    }
    function authorize(client, type) {
        const allowed = {
            host: new Set(['configure', 'start-live-ingest', 'stop-live-ingest', 'webrtc-offer', 'webrtc-ice', 'waveform', 'vector', 'communication']),
            viewer: new Set(['auth', 'webrtc-answer', 'webrtc-ice']), waiting: new Set()
        };
        if (!allowed[client.role]?.has(type)) return 'Message is not allowed for this connection role';
        if (type === 'configure' && sessionState !== 'CONFIGURING') return 'Session is not configuring';
        if (type === 'auth' && (sessionState !== 'ACTIVE' || client.authenticated)) return 'Authentication is not allowed now';
        if (['start-live-ingest', 'stop-live-ingest', 'webrtc-offer', 'waveform', 'vector', 'communication'].includes(type) && (sessionState !== 'ACTIVE' || !client.authenticated)) return 'Session is not active';
        if (['webrtc-answer', 'webrtc-ice'].includes(type) && (!client.authenticated || sessionState !== 'ACTIVE')) return 'Authentication is required';
        return null;
    }
    async function processMessage(ws, message) {
        const client = connectedSockets.get(ws); if (!client) return;
        let parsed;
        try { parsed = JSON.parse(message.toString()); } catch { protocolError(ws, 'invalid-json', 'Message must contain valid JSON'); return; }
        const validation = validateMessage(parsed);
        if (!validation.ok) { protocolError(ws, validation.code, validation.message); return; }
        const authorizationError = authorize(client, parsed.type);
        if (authorizationError) { protocolError(ws, 'not-authorized', authorizationError); return; }
        try {
            if (parsed.type === 'configure') {
                hostConfig = { maxClients: boundedInteger(parsed.maxClients, 1, 10), password: parsed.password || generatePassword(), whitelist: parsed.whitelist || [] };
                sessionState = 'ACTIVE'; safeSend(ws, { type: 'config-success', password: hostConfig.password });
                for (const [sock, info] of connectedSockets.entries()) if (info.role === 'waiting') { info.role = 'viewer'; info.authenticated = false; safeSend(sock, { type: 'server-state', state: 'ACTIVE', role: 'viewer-auth-required' }); }
            } else if (parsed.type === 'start-live-ingest') startLiveIngest(parsed.dir);
            else if (parsed.type === 'stop-live-ingest') stopLiveIngest();
            else if (parsed.type === 'auth') {
                if (parsed.password !== hostConfig.password) { safeSend(ws, { type: 'auth-fail', message: 'Invalid password' }); return; }
                const viewers = [...connectedSockets.values()].filter(item => item.role === 'viewer' && item.authenticated);
                if (viewers.length >= hostConfig.maxClients) { safeSend(ws, { type: 'auth-fail', message: 'Room is full' }); setTimeout(() => { try { ws.close(1008, 'Full'); } catch { /* closed */ } }, 100); return; }
                client.authenticated = true; safeSend(ws, { type: 'auth-success' });
                if (hostTracks.length > 0) { await setupViewerPC(ws); safeSend(ws, { type: 'stream-status', active: true }); } else safeSend(ws, { type: 'stream-status', active: false });
            } else if (parsed.type === 'webrtc-offer') await handleHostOffer(ws, parsed.sdp);
            else if (parsed.type === 'webrtc-answer') {
                const pc = viewerPCs.get(ws); if (!pc) throw new Error('No viewer peer connection exists');
                await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
            } else if (parsed.type === 'webrtc-ice') {
                const pc = client.role === 'host' ? hostPC : viewerPCs.get(ws);
                if (pc && parsed.candidate !== null) await pc.addIceCandidate(new RTCIceCandidate(parsed.candidate));
            } else if (['waveform', 'vector', 'communication'].includes(parsed.type)) {
                const raw = JSON.stringify(parsed);
                for (const [sock, info] of connectedSockets.entries()) if (sock !== ws && info.role === 'viewer' && info.authenticated) safeSend(sock, raw);
            }
        } catch (error) { logError(`Failed to process ${parsed.type}`, error); protocolError(ws, parsed.type.startsWith('webrtc-') ? 'invalid-webrtc' : 'server-error', 'Request could not be completed'); }
    }

    const httpServer = http.createServer((request, response) => {
        try {
            if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method Not Allowed'); return; }
            const requestUrl = new URL(request.url || '/', 'http://localhost');
            if (requestUrl.pathname === '/healthz') {
                const body = JSON.stringify({ status: 'ok' }); response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }); response.end(request.method === 'HEAD' ? undefined : body); return;
            }
            let pathname; try { pathname = decodeURIComponent(requestUrl.pathname); } catch { response.writeHead(400); response.end('Bad Request'); return; }
            const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
            const candidate = path.resolve(resolvedStaticDir, relativePath);
            if (candidate !== resolvedStaticDir && !candidate.startsWith(`${resolvedStaticDir}${path.sep}`)) { response.writeHead(400); response.end('Bad Request'); return; }
            let filePath = candidate;
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                if (path.extname(pathname)) { response.writeHead(404); response.end('Not Found'); return; }
                filePath = path.join(resolvedStaticDir, 'index.html');
            }
            if (!fs.existsSync(filePath)) { response.writeHead(503); response.end('Built application not found'); return; }
            const body = fs.readFileSync(filePath); response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' }); response.end(request.method === 'HEAD' ? undefined : body);
        } catch (error) { logError('HTTP request failed', error); if (!response.headersSent) response.writeHead(500); response.end('Internal Server Error'); }
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
    wss.on('error', error => logError('WebSocket server error', error));
    httpServer.on('upgrade', (request, socket, head) => {
        let pathname; try { pathname = new URL(request.url || '/', 'http://localhost').pathname; } catch { socket.destroy(); return; }
        if (pathname !== '/ws') { socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
    });
    wss.on('connection', (ws, request) => {
        const ip = request.socket.remoteAddress || 'unknown';
        if (connectedSockets.size >= MAX_CONNECTIONS) { safeSend(ws, { type: 'protocol-error', code: 'server-busy', message: 'Server connection limit reached' }); ws.close(1013, 'Server busy'); return; }
        if (sessionState === 'ACTIVE' && hostConfig.whitelist.length > 0 && !hostConfig.whitelist.includes(ip)) { logger.warn(`Unauthorized IP ${ip} connecting; delaying close.`); setTimeout(() => { try { ws.close(1008, 'Unauthorized IP'); } catch { /* closed */ } }, TARPIT_MS); return; }
        ws.on('error', error => logError('WebSocket client error', error)); ws.on('close', () => handleDisconnect(ws));
        let role;
        if (sessionState === 'IDLE') { sessionState = 'CONFIGURING'; role = 'host'; connectedSockets.set(ws, { role, ip, authenticated: true }); safeSend(ws, { type: 'server-state', state: 'CONFIGURING', role }); logger.info(`Host connected from ${ip}`); }
        else if (sessionState === 'CONFIGURING') { role = 'waiting'; connectedSockets.set(ws, { role, ip, authenticated: false }); safeSend(ws, { type: 'server-state', state: 'CONFIGURING', role }); }
        else { role = 'viewer'; connectedSockets.set(ws, { role, ip, authenticated: false }); safeSend(ws, { type: 'server-state', state: 'ACTIVE', role: 'viewer-auth-required' }); }
        ws.on('message', message => { const queued = (messageQueues.get(ws) || Promise.resolve()).then(() => processMessage(ws, message)).catch(error => logError('WebSocket message handling failed', error)); messageQueues.set(ws, queued); });
    });

    async function close() {
        stopLiveIngest(); safeClosePeerConnection(hostPC); hostPC = null; stopHostTracks();
        await Promise.allSettled([...pendingPeerTasks]);
        for (const pc of viewerPCs.values()) safeClosePeerConnection(pc); viewerPCs.clear();
        for (const ws of connectedSockets.keys()) try { ws.close(1001, 'Server shutting down'); } catch { /* closed */ }
        connectedSockets.clear(); await new Promise(resolve => wss.close(() => resolve()));
        if (httpServer.listening) await new Promise(resolve => httpServer.close(() => resolve()));
    }
    return { httpServer, wss, close, getState: () => ({ sessionState, hostConfig: { ...hostConfig }, connectedClients: connectedSockets.size }) };
}

export function startServer({ host = readHost(), port = readBoundedEnvInteger('PORT', 8181, 1, 65535), ...options } = {}) {
    const app = createServer(options);
    return new Promise((resolve, reject) => {
        const onError = error => { app.httpServer.off('listening', onListening); reject(error); };
        const onListening = () => { app.httpServer.off('error', onError); console.log(`SFU server listening on http://${host}:${port} (WebSocket /ws)`); resolve({ ...app, host, port }); };
        app.httpServer.once('error', onError); app.httpServer.once('listening', onListening); app.httpServer.listen(port, host);
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const serverPromise = startServer();
    serverPromise.catch(error => { console.error(`Unable to start SFU server: ${error.message}`); process.exitCode = 1; });
    const shutdown = async signal => { try { const app = await serverPromise; await app.close(); console.log(`Server stopped (${signal}).`); } catch { /* startup error already reported */ } };
    process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'));
}
