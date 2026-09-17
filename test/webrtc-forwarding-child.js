import { WebSocket } from 'ws';
import wrtc from '@roamhq/wrtc';
import { createServer } from '../src/server.js';

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, nonstandard } = wrtc;

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function connect(url) {
    const ws = new WebSocket(url);
    const messages = [];
    const waiters = [];
    const listeners = new Set();
    ws.on('message', data => {
        const message = JSON.parse(data.toString());
        const waiter = waiters.shift();
        if (waiter) waiter(message);
        else messages.push(message);
        for (const listener of listeners) listener(message);
    });
    const next = () => new Promise((resolve, reject) => {
        if (messages.length > 0) { resolve(messages.shift()); return; }
        const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), 5000);
        waiters.push(message => { clearTimeout(timer); resolve(message); });
    });
    const onMessage = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
        ws.once('open', () => { clearTimeout(timer); resolve({ ws, next, onMessage }); });
        ws.once('error', error => { clearTimeout(timer); reject(error); });
    });
}

function send(ws, message) {
    ws.send(JSON.stringify(message));
}

function waitForConnection(pc, label) {
    if (pc.connectionState === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} connection timeout`)), 10000);
        const check = () => {
            if (pc.connectionState === 'connected') {
                clearTimeout(timer); pc.removeEventListener('connectionstatechange', check); resolve();
            } else if (['failed', 'closed'].includes(pc.connectionState)) {
                clearTimeout(timer); pc.removeEventListener('connectionstatechange', check); reject(new Error(`${label} entered ${pc.connectionState}`));
            }
        };
        pc.addEventListener('connectionstatechange', check);
        check();
    });
}

let app;
let host;
let viewer;
let hostPC;
let viewerPC;
let source;
let hostTrack;
let viewerTrack;
let sink;
let frameTimer;
let removeHostListener;
let removeViewerListener;
let successful = false;

try {
    app = createServer({ staticDir: process.cwd(), logger: { info() {}, warn() {}, error() {} } });
    await new Promise((resolve, reject) => {
        app.httpServer.once('listening', resolve);
        app.httpServer.once('error', reject);
        app.httpServer.listen(0, '127.0.0.1');
    });
    const port = app.httpServer.address().port;
    host = await connect(`ws://127.0.0.1:${port}/ws`);
    await host.next();
    send(host.ws, { type: 'configure', maxClients: 2, password: 'secret', whitelist: [] });
    await host.next();
    viewer = await connect(`ws://127.0.0.1:${port}/ws`);
    await viewer.next();
    send(viewer.ws, { type: 'auth', password: 'secret' });
    await viewer.next(); await viewer.next();

    hostPC = new RTCPeerConnection({ iceServers: [] });
    viewerPC = new RTCPeerConnection({ iceServers: [] });
    source = new nonstandard.RTCVideoSource();
    hostTrack = source.createTrack();
    let hostRemoteDescription = false;
    let viewerRemoteDescription = false;
    const hostCandidates = [];
    const viewerCandidates = [];
    const flushCandidates = async (pc, candidates) => {
        while (candidates.length > 0) await pc.addIceCandidate(new RTCIceCandidate(candidates.shift()));
    };

    hostPC.addTrack(hostTrack);
    hostPC.onicecandidate = event => { if (event.candidate) send(host.ws, { type: 'webrtc-ice', candidate: event.candidate }); };
    viewerPC.onicecandidate = event => { if (event.candidate) send(viewer.ws, { type: 'webrtc-ice', candidate: event.candidate }); };
    removeHostListener = host.onMessage(message => {
        if (message.type === 'webrtc-answer') {
            hostPC.setRemoteDescription(new RTCSessionDescription(message.sdp)).then(async () => {
                hostRemoteDescription = true;
                await flushCandidates(hostPC, hostCandidates);
            }).catch(() => {});
        } else if (message.type === 'webrtc-ice') {
            if (hostRemoteDescription) hostPC.addIceCandidate(new RTCIceCandidate(message.candidate)).catch(() => {});
            else hostCandidates.push(message.candidate);
        }
    });
    removeViewerListener = viewer.onMessage(message => {
        if (message.type === 'webrtc-offer') {
            viewerPC.setRemoteDescription(new RTCSessionDescription(message.sdp)).then(async () => {
                viewerRemoteDescription = true;
                await flushCandidates(viewerPC, viewerCandidates);
                const answer = await viewerPC.createAnswer();
                await viewerPC.setLocalDescription(answer);
                send(viewer.ws, { type: 'webrtc-answer', sdp: viewerPC.localDescription });
            }).catch(() => {});
        } else if (message.type === 'webrtc-ice') {
            if (viewerRemoteDescription) viewerPC.addIceCandidate(new RTCIceCandidate(message.candidate)).catch(() => {});
            else viewerCandidates.push(message.candidate);
        }
    });

    const frame = new Promise((resolve, reject) => {
        viewerPC.ontrack = event => {
            viewerTrack = event.track;
            sink = new nonstandard.RTCVideoSink(viewerTrack);
            sink.onframe = frameEvent => {
                if (frameTimer) clearInterval(frameTimer);
                resolve(frameEvent.frame);
            };
        };
        (async () => {
            try {
                const offer = await hostPC.createOffer();
                await hostPC.setLocalDescription(offer);
                send(host.ws, { type: 'webrtc-offer', sdp: hostPC.localDescription });
                await Promise.all([waitForConnection(hostPC, 'host'), waitForConnection(viewerPC, 'viewer')]);
                const frameData = new Uint8ClampedArray(6).fill(128);
                frameTimer = setInterval(() => source.onFrame({ width: 2, height: 2, data: frameData }), 25);
            } catch (error) { reject(error); }
        })();
    });
    const received = await Promise.race([
        frame,
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('video frame timeout')), 15000))
    ]);
    if (received.width !== 2 || received.height !== 2) throw new Error('unexpected video frame dimensions');
    process.stdout.write(`received frame ${received.width}x${received.height}\n`);
    successful = true;
} catch (error) {
    console.error(error.stack || error.message);
} finally {
    if (frameTimer) clearInterval(frameTimer);
    if (removeHostListener) removeHostListener();
    if (removeViewerListener) removeViewerListener();
    if (viewerTrack) viewerTrack.stop();
    if (sink) sink.stop();
    if (hostTrack) hostTrack.stop();
    if (hostPC) hostPC.close();
    if (viewerPC) viewerPC.close();
    if (host?.ws) host.ws.close();
    if (viewer?.ws) viewer.ws.close();
    if (app) await app.close().catch(() => {});
    await wait(100);
}

// Exit before native WebRTC finalizers can race with the test runner process.
process.exit(successful ? 0 : 1);
