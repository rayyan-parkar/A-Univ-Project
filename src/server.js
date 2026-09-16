import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import wrtc from '@roamhq/wrtc';
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;
import dotenv from 'dotenv';
import { parse } from 'url';

dotenv.config();

const wss = new WebSocketServer({ host: '127.0.0.1', port: 8181 });
console.log('SFU Server started on ws://127.0.0.1:8181!');

let sessionState = 'IDLE'; // IDLE, CONFIGURING, ACTIVE
let hostConfig = { maxClients: 3, password: '', whitelist: [] };
let connectedSockets = new Map(); // ws -> { role, ip, authenticated }

// WebRTC State
let hostPC = null;
let hostTracks = [];
let viewerPCs = new Map(); // ws -> RTCPeerConnection

// Server-side Live Ingest State
let liveIngestInterval = null;
let liveIndices = { spherical: 0, vibration: 0, communication: 0 };

function stopLiveIngest() {
    if (liveIngestInterval) {
        clearInterval(liveIngestInterval);
        liveIngestInterval = null;
        console.log('Live experiment ingest stopped.');
    }
}

function broadcastPayload(msgObj) {
    const raw = JSON.stringify(msgObj);
    for (let [sock, info] of connectedSockets.entries()) {
        if (info.authenticated && (info.role === 'host' || info.role === 'viewer')) {
            if (sock.readyState === 1) sock.send(raw);
        }
    }
}

function startLiveIngest(dirPath) {
    stopLiveIngest();
    const resolvedDir = path.resolve(process.cwd(), dirPath || './src/data');
    liveIndices = { spherical: 0, vibration: 0, communication: 0 };
    console.log(`Starting live experiment ingest from: ${resolvedDir}`);

    const parseFloats = (line) => {
        if (!line) return [];
        return line.split(/\s+/).map(parseFloat).filter(v => !isNaN(v));
    };

    const loadLinesSafe = (filename) => {
        try {
            const p = path.join(resolvedDir, filename);
            if (!fs.existsSync(p)) return [];
            const text = fs.readFileSync(p, 'utf8');
            return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        } catch {
            return [];
        }
    };

    liveIngestInterval = setInterval(() => {
        const now = Date.now();

        // 1. Vibration
        const vibLines = loadLinesSafe('VibrationData.txt');
        const fpgaLines = loadLinesSafe('VibrationData_FPGA.txt');
        const vibLen = Math.min(vibLines.length, fpgaLines.length);
        if (liveIndices.vibration < vibLen) {
            const v = parseFloats(vibLines[liveIndices.vibration]);
            const f = parseFloats(fpgaLines[liveIndices.vibration]);
            if (v.length > 0 && f.length > 0) {
                broadcastPayload({ type: 'waveform', data: [v[0], f[0]], timestamp: now });
            }
            liveIndices.vibration++;
        }

        // 2. Spherical SOP
        const sLow = loadLinesSafe('SphericalData_low.txt');
        const sMed = loadLinesSafe('SphericalData_medium.txt');
        const sHigh = loadLinesSafe('SphericalData_high.txt');
        const sLen = Math.min(sLow.length, sMed.length, sHigh.length);
        if (liveIndices.spherical < sLen) {
            const l = parseFloats(sLow[liveIndices.spherical]);
            const m = parseFloats(sMed[liveIndices.spherical]);
            const h = parseFloats(sHigh[liveIndices.spherical]);
            if (l.length >= 9 && m.length >= 9 && h.length >= 9) {
                const vectors = [
                    [l[0], l[1], l[2]], [l[3], l[4], l[5]], [l[6], l[7], l[8]],
                    [m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]],
                    [h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]],
                ];
                broadcastPayload({ type: 'vector', data: vectors, timestamp: now });
            }
            liveIndices.spherical++;
        }

        // 3. Communication
        const cLow = loadLinesSafe('CommunicationData_low.txt');
        const cMed = loadLinesSafe('CommunicationData_medium.txt');
        const cHigh = loadLinesSafe('CommunicationData_high.txt');
        const cLen = Math.min(cLow.length, cMed.length, cHigh.length);
        if (liveIndices.communication < cLen) {
            const l = parseFloats(cLow[liveIndices.communication]);
            const m = parseFloats(cMed[liveIndices.communication]);
            const h = parseFloats(cHigh[liveIndices.communication]);
            if (l.length >= 2 && m.length >= 2 && h.length >= 2) {
                broadcastPayload({
                    type: 'communication',
                    data: [[l[0], l[1]], [m[0], m[1]], [h[0], h[1]]],
                    timestamp: now
                });
            }
            liveIndices.communication++;
        }
    }, 16);
}

function generatePassword() {
    return crypto.randomBytes(8).toString('hex');
}

const TARPIT_MS = 5000;

wss.on('connection', async (ws, req) => {
    const ip = req.socket.remoteAddress;
    const { query } = parse(req.url, true);

    // IP Whitelist Check (Tarpit)
    if (sessionState === 'ACTIVE' && hostConfig.whitelist.length > 0) {
        if (!hostConfig.whitelist.includes(ip)) {
            console.log(`Unauthorized IP ${ip} connecting... Tarpitting for 5 seconds.`);
            setTimeout(() => {
                ws.close(1008, 'Unauthorized IP');
            }, TARPIT_MS);
            return;
        }
    }

    ws.on('error', (err) => console.error('WS Error:', err.message));
    ws.on('close', () => handleDisconnect(ws));

    if (sessionState === 'IDLE') {
        sessionState = 'CONFIGURING';
        connectedSockets.set(ws, { role: 'host', ip, authenticated: true });
        ws.send(JSON.stringify({ type: 'server-state', state: 'CONFIGURING', role: 'host' }));
        console.log(`Host connected from ${ip}`);
    } else if (sessionState === 'CONFIGURING') {
        connectedSockets.set(ws, { role: 'waiting', ip, authenticated: false });
        ws.send(JSON.stringify({ type: 'server-state', state: 'CONFIGURING', role: 'waiting' }));
    } else if (sessionState === 'ACTIVE') {
        connectedSockets.set(ws, { role: 'viewer', ip, authenticated: false });
        ws.send(JSON.stringify({ type: 'server-state', state: 'ACTIVE', role: 'viewer-auth-required' }));
    }

    ws.on('message', async (message) => {
        let parsed;
        try {
            parsed = JSON.parse(message.toString());
        } catch { return; }

        const client = connectedSockets.get(ws);
        if (!client) return;

        // Configuration
        if (client.role === 'host' && parsed.type === 'configure') {
            hostConfig.maxClients = parseInt(parsed.maxClients) || 3;
            hostConfig.password = parsed.password || generatePassword();
            hostConfig.whitelist = Array.isArray(parsed.whitelist) ? parsed.whitelist : [];
            sessionState = 'ACTIVE';
            
            ws.send(JSON.stringify({ type: 'config-success', password: hostConfig.password }));
            
            // Notify waiting clients
            for (let [sock, info] of connectedSockets.entries()) {
                if (info.role === 'waiting') {
                    info.role = 'viewer';
                    info.authenticated = false;
                    sock.send(JSON.stringify({ type: 'server-state', state: 'ACTIVE', role: 'viewer-auth-required' }));
                }
            }
        }

        // Host Live Ingest Controls
        if (client.role === 'host' && parsed.type === 'start-live-ingest') {
            startLiveIngest(parsed.dir);
        }
        if (client.role === 'host' && parsed.type === 'stop-live-ingest') {
            stopLiveIngest();
        }

        // Viewer Authentication
        if (client.role === 'viewer' && !client.authenticated && parsed.type === 'auth') {
            if (parsed.password === hostConfig.password) {
                let viewers = Array.from(connectedSockets.values()).filter(c => c.role === 'viewer' && c.authenticated);
                if (viewers.length >= hostConfig.maxClients) {
                    ws.send(JSON.stringify({ type: 'auth-fail', message: 'Room is full' }));
                    setTimeout(()=> ws.close(1008, 'Full'), 100);
                } else {
                    client.authenticated = true;
                    ws.send(JSON.stringify({ type: 'auth-success' }));
                    if (hostTracks.length > 0) {
                        setupViewerPC(ws);
                        ws.send(JSON.stringify({ type: 'stream-status', active: true }));
                    } else {
                        ws.send(JSON.stringify({ type: 'stream-status', active: false }));
                    }
                }
            } else {
                ws.send(JSON.stringify({ type: 'auth-fail', message: 'Invalid password' }));
            }
        }

        // Host WebRTC Signaling
        if (client.role === 'host' && parsed.type === 'webrtc-offer') {
            await handleHostOffer(ws, parsed.sdp);
        }
        if (client.role === 'host' && parsed.type === 'webrtc-ice') {
            if (hostPC && parsed.candidate) hostPC.addIceCandidate(new RTCIceCandidate(parsed.candidate)).catch(e=>console.error('ICE host error', e));
        }

        // Viewer WebRTC Signaling
        if (client.role === 'viewer' && client.authenticated && parsed.type === 'webrtc-answer') {
            const pc = viewerPCs.get(ws);
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
        }
        if (client.role === 'viewer' && client.authenticated && parsed.type === 'webrtc-ice') {
            const pc = viewerPCs.get(ws);
            if (pc && parsed.candidate) pc.addIceCandidate(new RTCIceCandidate(parsed.candidate)).catch(e=>console.error('ICE viewer error', e));
        }

        // Graph Data from Host (forwarded to all authenticated Viewers)
        if (client.role === 'host' && (parsed.type === 'vector' || parsed.type === 'waveform' || parsed.type === 'communication')) {
            for (let [sock, info] of connectedSockets.entries()) {
                if (sock !== ws && info.role === 'viewer' && info.authenticated) {
                    if (sock.readyState === 1) sock.send(message.toString());
                }
            }
        }
    });
});

async function handleHostOffer(ws, sdp) {
    if (hostPC) hostPC.close();
    hostTracks = [];

    hostPC = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    hostPC.ontrack = async (event) => {
        if (!hostTracks.includes(event.track)) {
            hostTracks.push(event.track);
        }
        console.log('Received track from host:', event.track.kind);
        
        // Push the new track to all existing authenticated viewers
        for (let [sock, info] of connectedSockets.entries()) {
            if (info.role === 'viewer' && info.authenticated) {
                sock.send(JSON.stringify({ type: 'stream-status', active: true }));
                await setupViewerPC(sock);
            }
        }
    };

    hostPC.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'webrtc-ice', candidate: event.candidate }));
        }
    };

    await hostPC.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await hostPC.createAnswer();
    await hostPC.setLocalDescription(answer);

    ws.send(JSON.stringify({ type: 'webrtc-answer', sdp: hostPC.localDescription }));
}

async function setupViewerPC(ws) {
    const existingPC = viewerPCs.get(ws);
    if (existingPC) {
        existingPC.close();
        viewerPCs.delete(ws);
    }

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    viewerPCs.set(ws, pc);

    hostTracks.forEach(track => {
        pc.addTrack(track);
    });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'webrtc-ice', candidate: event.candidate }));
        }
    };

    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({ type: 'webrtc-offer', sdp: pc.localDescription }));
}

function handleDisconnect(ws) {
    const client = connectedSockets.get(ws);
    if (!client) return;

    if (client.role === 'host') {
        console.log('Host disconnected. Resetting session.');
        stopLiveIngest();
        sessionState = 'IDLE';
        if (hostPC) hostPC.close();
        hostPC = null;
        hostTracks = [];

        for (let sock of connectedSockets.keys()) {
            if (sock !== ws) {
                sock.send(JSON.stringify({ type: 'server-reset', message: 'Host disconnected' }));
                sock.close(1008, 'Host disconnected');
            }
        }
        connectedSockets.clear();
        viewerPCs.forEach(pc => pc.close());
        viewerPCs.clear();
    } else if (client.role === 'viewer') {
        const pc = viewerPCs.get(ws);
        if (pc) pc.close();
        viewerPCs.delete(ws);
        connectedSockets.delete(ws);
    } else {
        connectedSockets.delete(ws);
    }
}