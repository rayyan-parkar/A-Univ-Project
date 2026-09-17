import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer, validateMessage } from '../src/server.js';

const apps = [];
let staticFixture;

before(async () => {
    staticFixture = await mkdtemp(path.join(os.tmpdir(), 'phase1-static-'));
    await writeFile(path.join(staticFixture, 'index.html'), '<!doctype html><html><body>fixture</body></html>');
    await writeFile(path.join(staticFixture, 'app.js'), 'console.log("fixture");');
});

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()));
});

after(async () => {
    await rm(staticFixture, { recursive: true, force: true });
});

function withTimeout(promise, label, milliseconds = 5000) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function startTestServer() {
    const app = createServer({ staticDir: staticFixture, logger: { info() {}, warn() {}, error() {} } });
    await withTimeout(new Promise((resolve, reject) => {
        app.httpServer.once('listening', resolve);
        app.httpServer.once('error', reject);
        app.httpServer.listen(0, '127.0.0.1');
    }), 'test server startup');
    apps.push(app);
    const { port } = app.httpServer.address();
    return { app, url: `ws://127.0.0.1:${port}/ws`, httpUrl: `http://127.0.0.1:${port}` };
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
    const next = () => {
        if (messages.length > 0) return Promise.resolve(messages.shift());
        return withTimeout(new Promise((resolve, reject) => {
            const waiter = message => { clearTimeout(waiter.timer); resolve(message); };
            waiter.timer = setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                reject(new Error('Timed out waiting for WebSocket message'));
            }, 5000);
            waiters.push(waiter);
        }), 'WebSocket message');
    };
    const onMessage = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    return withTimeout(new Promise((resolve, reject) => {
        ws.once('open', () => resolve({ ws, next, onMessage }));
        ws.once('error', reject);
    }), 'WebSocket connection');
}

function send(ws, message) {
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));
}

test('serves health, static assets, SPA fallback, and blocks traversal', async () => {
    const { httpUrl } = await startTestServer();
    const health = await fetch(`${httpUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const root = await fetch(`${httpUrl}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /<html/i);

    const asset = await fetch(`${httpUrl}/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');

    const spa = await fetch(`${httpUrl}/some/client/route`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /<html/i);

    const traversal = await fetch(`${httpUrl}/%2e%2e/package.json`);
    assert.notEqual(traversal.status, 200);
});

test('assigns host, validates configuration, and authenticates a viewer', async () => {
    const { url } = await startTestServer();
    const host = await connect(url);
    assert.deepEqual(await host.next(), { type: 'server-state', state: 'CONFIGURING', role: 'host' });

    send(host.ws, { type: 'configure', maxClients: 99, password: 'secret', whitelist: [] });
    assert.equal((await host.next()).type, 'protocol-error');
    send(host.ws, { type: 'configure', maxClients: 2, password: 'secret', whitelist: [] });
    assert.deepEqual(await host.next(), { type: 'config-success', password: 'secret' });

    const viewer = await connect(url);
    assert.deepEqual(await viewer.next(), { type: 'server-state', state: 'ACTIVE', role: 'viewer-auth-required' });
    send(viewer.ws, { type: 'auth', password: 'secret' });
    assert.deepEqual(await viewer.next(), { type: 'auth-success' });
    assert.deepEqual(await viewer.next(), { type: 'stream-status', active: false });
    host.ws.close(); viewer.ws.close();
});

test('rejects malformed signaling without taking down the server', async () => {
    const { url, httpUrl } = await startTestServer();
    const host = await connect(url);
    await host.next();
    send(host.ws, { type: 'configure', maxClients: 2, password: 'secret', whitelist: [] });
    await host.next();

    const superficiallyValidOffer = 'v=0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n';
    assert.equal(validateMessage({ type: 'webrtc-offer', sdp: { type: 'offer', sdp: superficiallyValidOffer } }).ok, true);
    send(host.ws, { type: 'webrtc-offer', sdp: { type: 'offer', sdp: superficiallyValidOffer } });
    assert.deepEqual(await host.next(), { type: 'protocol-error', code: 'invalid-webrtc', message: 'Request could not be completed' });

    const viewer = await connect(url);
    await viewer.next();
    send(viewer.ws, { type: 'auth', password: 'secret' });
    await viewer.next(); await viewer.next();
    send(viewer.ws, { type: 'webrtc-answer', sdp: { type: 'answer', sdp: superficiallyValidOffer } });
    assert.deepEqual(await viewer.next(), { type: 'protocol-error', code: 'invalid-webrtc', message: 'Request could not be completed' });

    const health = await fetch(`${httpUrl}/healthz`);
    assert.equal(health.status, 200);
    host.ws.close(); viewer.ws.close();
});

test('forwards a synthetic native WebRTC video track from host to viewer', async () => {
    const childPath = fileURLToPath(new URL('./webrtc-forwarding-child.js', import.meta.url));
    const child = spawn(process.execPath, [childPath], { cwd: path.resolve(path.dirname(childPath), '..') });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const result = await withTimeout(new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
    }), 'native WebRTC child test', 20000);
    assert.equal(result.code, 0, `${result.signal || 'child'}\n${output}`);
    assert.match(output, /received frame 2x2/);
});

test('validates bounded telemetry and signaling fields before handling them', () => {
    assert.equal(validateMessage({ type: 'waveform', data: [1, 2], timestamp: 3 }).ok, true);
    assert.equal(validateMessage({ type: 'waveform', data: [1, Number.NaN] }).ok, false);
    assert.equal(validateMessage({ type: 'vector', data: Array.from({ length: 9 }, () => [0, 0, 0]) }).ok, true);
    assert.equal(validateMessage({ type: 'vector', data: [[0, 0, 0]] }).ok, false);
    assert.equal(validateMessage({ type: 'webrtc-ice', candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host', sdpMid: null, sdpMLineIndex: null, usernameFragment: null } }).ok, true);
    assert.equal(validateMessage({ type: 'webrtc-ice', candidate: { candidate: 'hostile' } }).ok, false);
});
