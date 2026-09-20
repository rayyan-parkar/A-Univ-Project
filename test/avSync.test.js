import assert from 'node:assert/strict';
import test from 'node:test';
import {
    addClockSample,
    captureTimeToEpoch,
    clockEstimate,
    createClockEstimator,
    createSyncState,
    enqueueSyncPacket,
    fallbackSyncFrame,
    presentVideoFrame,
    presentVideoReceiveTime,
    receiveTimeToEpoch,
} from '../src/avSync.js';

const packet = (frameId, timestamp) => ({ frameId, timestamp, waveform: [frameId, 0], vector: [], communication: [] });

test('selects one complete newest packet at or before the presented capture time', () => {
    const state = createSyncState();
    enqueueSyncPacket(state, packet(1, 1000), 1000);
    enqueueSyncPacket(state, packet(2, 1030), 1030);
    enqueueSyncPacket(state, packet(3, 1060), 1060);
    assert.equal(presentVideoFrame(state, 1040, 1100, 0)?.frameId, 2);
    assert.equal(state.queue.length, 1);
    assert.equal(state.queue[0].packet.frameId, 3);
});

test('bounds queue and ignores late out-of-order packets', () => {
    const state = createSyncState({ maxQueue: 2 });
    enqueueSyncPacket(state, packet(4, 1040), 1040);
    enqueueSyncPacket(state, packet(5, 1050), 1050);
    enqueueSyncPacket(state, packet(3, 1030), 1030);
    assert.deepEqual(state.queue.map(item => item.packet.frameId), [4, 5]);
    enqueueSyncPacket(state, packet(0, 2000), 2000);
    assert.deepEqual(state.queue.map(item => item.packet.frameId), [0]);
});

test('retains at most the production 240 packet arrival entries', () => {
    const state = createSyncState();
    for (let frameId = 0; frameId < 300; frameId += 1) {
        enqueueSyncPacket(state, packet(frameId, frameId), 1000 + frameId);
    }
    assert.equal(state.queue.length, 240);
    assert.equal(state.queue[0].packet.frameId, 60);
    assert.equal(state.queue.at(-1).receivedAt, 1299);
});

test('keeps a newer frame ID when its timestamp arrives out of order', () => {
    const state = createSyncState();
    enqueueSyncPacket(state, packet(1, 1000), 1000);
    assert.equal(presentVideoFrame(state, 1000, 1000, 0)?.frameId, 1);
    enqueueSyncPacket(state, packet(2, 990), 1010);
    assert.equal(presentVideoFrame(state, 1000, 1010, 0)?.frameId, 2);
});

test('clock estimator accepts midpoint offset, smooths it, and rejects bad RTT/outliers', () => {
    const estimator = createClockEstimator({ alpha: 0.5 });
    assert.equal(addClockSample(estimator, { clientSend: 1000, serverReceive: 1120, serverSend: 1121, clientReceive: 1021 }), true);
    assert.equal(clockEstimate(estimator), 110);
    assert.equal(addClockSample(estimator, { clientSend: 2000, serverReceive: 2120, serverSend: 2121, clientReceive: 2021 }), true);
    assert.equal(clockEstimate(estimator), 110);
    assert.equal(addClockSample(estimator, { clientSend: 3000, serverReceive: 3120, serverSend: 3121, clientReceive: 4000 }), false);
    assert.equal(addClockSample(estimator, { clientSend: 4000, serverReceive: 8000, serverSend: 8001, clientReceive: 4021 }), false);
    assert.equal(createClockEstimator({ maxSamples: Number.NaN }).maxSamples, 8);
});

test('captureTime conversion rejects absent or implausible metadata', () => {
    assert.equal(captureTimeToEpoch({}, { timeOrigin: 100000, now: 101000 }), null);
    assert.equal(captureTimeToEpoch({ captureTime: 1000 }, { timeOrigin: 100000, now: 101000 }), 101000);
    assert.equal(captureTimeToEpoch({ captureTime: 1000 }, { timeOrigin: 100000, now: 400000 }), null);
    assert.equal(captureTimeToEpoch({ captureTime: 1700000000000 }, { now: 1700000000100 }), 1700000000000);
    assert.equal(receiveTimeToEpoch({ receiveTime: 1000 }, { timeOrigin: 100000, now: 101000 }), 101000);
    assert.equal(receiveTimeToEpoch({}, { timeOrigin: 100000, now: 101000 }), null);
});

test('estimated mode matches local packet arrival time despite source-clock skew', () => {
    const state = createSyncState();
    enqueueSyncPacket(state, packet(1, 900000), 1000);
    enqueueSyncPacket(state, packet(2, 2), 1010);
    const selected = presentVideoReceiveTime(state, 1015, 1015);
    assert.equal(selected?.frameId, 2);
    assert.equal(state.mode, 'estimated');
});

test('capture mode remains preferred over receive-time estimation', () => {
    const state = createSyncState();
    enqueueSyncPacket(state, packet(1, 1000), 1050);
    enqueueSyncPacket(state, packet(2, 900), 1005);
    assert.equal(presentVideoFrame(state, 1000, 1010, 0)?.frameId, 1);
    assert.equal(state.mode, 'auto');
});

test('invalid video metadata leaves the synchronizer in fallback mode', () => {
    const state = createSyncState();
    enqueueSyncPacket(state, packet(1, 1000), 1000);
    assert.equal(captureTimeToEpoch({}, { timeOrigin: 100000, now: 101000 }), null);
    assert.equal(receiveTimeToEpoch({}, { timeOrigin: 100000, now: 101000 }), null);
    assert.equal(fallbackSyncFrame(state, 1010)?.frameId, 1);
    assert.equal(state.mode, 'fallback');
});

test('fallback produces recent telemetry after a bounded presentation hold', () => {
    const state = createSyncState({ holdMs: 10 });
    enqueueSyncPacket(state, packet(1, 1000), 1000);
    assert.equal(presentVideoFrame(state, 900, 1000, 0), null);
    assert.equal(fallbackSyncFrame(state, 1005), null);
    assert.equal(presentVideoFrame(state, 900, 1005, 0), null);
    assert.equal(presentVideoFrame(state, 900, 1011, 0)?.frameId, 1);
    enqueueSyncPacket(state, packet(2, 1020), 1020);
    assert.equal(fallbackSyncFrame(state, 2000)?.frameId, 2);
});
