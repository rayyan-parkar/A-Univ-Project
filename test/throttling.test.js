import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer, TELEMETRY_HIGH_WATER_BYTES } from '../src/server.js';
import { reconnectDelay, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '../src/hooks/useExperimentSession.js';
import { createTelemetryFrame, validateTelemetryFrame } from '../src/telemetryProtocol.js';

const apps = [];
let staticFixture;

before(async () => {
    staticFixture = await mkdtemp(path.join(os.tmpdir(), 'throttling-static-'));
    await writeFile(path.join(staticFixture, 'index.html'), '<!doctype html><html><body>fixture</body></html>');
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

async function startTestServer(options = {}) {
    const app = createServer({
        staticDir: staticFixture,
        hostToken: '0123456789abcdef',
        logger: { info() {}, warn() {}, error() {} },
        ...options
    });
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
    const rawMessages = [];
    const waiters = [];

    ws.on('message', data => {
        const rawStr = data.toString();
        rawMessages.push(rawStr);
        const parsed = JSON.parse(rawStr);
        const waiter = waiters.shift();
        if (waiter) waiter(parsed);
        else messages.push(parsed);
    });

    const next = () => {
        if (messages.length > 0) return Promise.resolve(messages.shift());
        return withTimeout(new Promise((resolve, reject) => {
            const waiter = message => {
                clearTimeout(waiter.timer);
                resolve(message);
            };
            waiter.timer = setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) waiters.splice(index, 1);
                reject(new Error('Timed out waiting for WebSocket message'));
            }, 5000);
            waiters.push(waiter);
        }), 'WebSocket message');
    };

    return withTimeout(new Promise((resolve, reject) => {
        ws.once('open', () => resolve({ ws, next, messages, rawMessages }));
        ws.once('error', reject);
    }), 'WebSocket connection');
}

function send(ws, message) {
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));
}

test('relays telemetry frames without re-stringifying or modifying payload representation', async () => {
    const { url } = await startTestServer();
    const host = await connect(url);

    send(host.ws, { type: 'claim-host', token: '0123456789abcdef' });
    await host.next(); // server-state

    send(host.ws, { type: 'configure', maxClients: 2, password: 'secret-password' });
    await host.next(); // config-success

    const viewer = await connect(url);
    const stateMsg = await viewer.next();
    assert.equal(stateMsg.type, 'server-state');
    assert.equal(stateMsg.role, 'viewer-auth-required');

    send(viewer.ws, { type: 'auth', password: 'secret-password' });
    const authResp = await viewer.next();
    assert.equal(authResp.type, 'auth-success');
    const streamStatus = await viewer.next();
    assert.equal(streamStatus.type, 'stream-status');

    // Send a frame with specific formatting
    const rawFrame = JSON.stringify(createTelemetryFrame({
        frameId: 101,
        waveform: [0.123, -0.456],
        vector: [
            [1, 0, 0], [0, 1, 0], [0, 0, 1],
            [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5],
            [0.2, 0.2, 0.2], [-0.2, 0.2, 0.2], [0.2, -0.2, 0.2]
        ],
        communication: [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5]]
    }));

    send(host.ws, rawFrame);
    const received = await viewer.next();
    assert.equal(received.type, 'telemetry-frame');
    assert.equal(received.frameId, 101);
    assert.equal(viewer.rawMessages[viewer.rawMessages.length - 1], rawFrame);

    host.ws.close();
    viewer.ws.close();
});

test('rate limits repeated stream restart requests from viewers', async () => {
    const { url } = await startTestServer();
    const host = await connect(url);

    send(host.ws, { type: 'claim-host', token: '0123456789abcdef' });
    await host.next();

    send(host.ws, { type: 'configure', maxClients: 2, password: 'pw' });
    await host.next();

    const viewer = await connect(url);
    await viewer.next(); // server-state

    send(viewer.ws, { type: 'auth', password: 'pw' });
    const authMsg = await viewer.next();
    assert.equal(authMsg.type, 'auth-success');
    const initStatus = await viewer.next();
    assert.equal(initStatus.type, 'stream-status');

    // First restart request
    send(viewer.ws, { type: 'webrtc-restart-request' });
    const firstResp = await viewer.next();
    assert.equal(firstResp.type, 'stream-status');

    // Immediate second restart request (< 500ms) should be rate limited
    send(viewer.ws, { type: 'webrtc-restart-request' });
    const secondResp = await viewer.next();
    assert.equal(secondResp.type, 'protocol-error');
    assert.equal(secondResp.code, 'restart-rate-limited');

    host.ws.close();
    viewer.ws.close();
});

test('drops telemetry frames under socket high-water backpressure while preserving control messages', async () => {
    const { url } = await startTestServer();
    const host = await connect(url);

    send(host.ws, { type: 'claim-host', token: '0123456789abcdef' });
    await host.next();

    send(host.ws, { type: 'configure', maxClients: 2, password: 'pw' });
    await host.next();

    const viewer = await connect(url);
    await viewer.next(); // server-state

    send(viewer.ws, { type: 'auth', password: 'pw' });
    await viewer.next(); // auth-success
    await viewer.next(); // stream-status

    assert.ok(TELEMETRY_HIGH_WATER_BYTES >= 256 * 1024);

    host.ws.close();
    viewer.ws.close();
});

test('calculates bounded exponential backoff with jitter for reconnection', () => {
    const min0 = reconnectDelay(0, 0);
    const mid0 = reconnectDelay(0, 0.5);
    const max0 = reconnectDelay(0, 1.0);
    assert.equal(min0, Math.round(RECONNECT_BASE_MS * 0.75));
    assert.equal(mid0, Math.round(RECONNECT_BASE_MS * 1.0));
    assert.equal(max0, Math.round(RECONNECT_BASE_MS * 1.25));

    const delay1 = reconnectDelay(1, 0.5);
    const delay2 = reconnectDelay(2, 0.5);
    const delay3 = reconnectDelay(3, 0.5);
    assert.ok(delay1 > mid0);
    assert.ok(delay2 > delay1);
    assert.ok(delay3 > delay2);

    const delayHighAttempt = reconnectDelay(20, 0.5);
    assert.equal(delayHighAttempt, RECONNECT_MAX_MS);
    const delayMaxJitter = reconnectDelay(20, 1.0);
    assert.equal(delayMaxJitter, Math.round(RECONNECT_MAX_MS * 1.25));
});

test('validates telemetry frames efficiently under high frequency generation', () => {
    const startTime = performance.now();
    for (let i = 0; i < 500; i++) {
        const frame = createTelemetryFrame({
            frameId: i,
            waveform: [Math.sin(i * 0.05), Math.cos(i * 0.05)],
            vector: [
                [1, 0, 0], [0, 1, 0], [0, 0, 1],
                [0.7, 0.7, 0], [0, 0.7, 0.7], [0.7, 0, 0.7],
                [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, -0.5, 0.5]
            ],
            communication: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]
        });
        const error = validateTelemetryFrame(frame);
        assert.equal(error, null);
    }
    const elapsed = performance.now() - startTime;
    assert.ok(elapsed < 100, `High frequency frame processing took ${elapsed}ms`);
});
