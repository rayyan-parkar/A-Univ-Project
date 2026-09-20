/**
 * Small, dependency-free primitives used by the automatic audio/video
 * synchronizer. Telemetry packets remain opaque to this module: the whole
 * packet is queued and returned, so graph components can never observe a
 * partially updated frame.
 */

export const MAX_SYNC_QUEUE = 240;
export const DEFAULT_HOLD_MS = 140;
export const CLOCK_SYNC_MAX_RTT_MS = 750;
export const CLOCK_SYNC_MAX_OFFSET_JUMP_MS = 2500;

const finite = value => typeof value === 'number' && Number.isFinite(value);

function cap(value, fallback = MAX_SYNC_QUEUE) {
    if (!finite(value)) return fallback;
    return Math.min(MAX_SYNC_QUEUE, Math.max(1, Math.floor(value)));
}

export function createSyncState({ maxQueue = MAX_SYNC_QUEUE, holdMs = DEFAULT_HOLD_MS } = {}) {
    return {
        maxQueue: cap(maxQueue),
        holdMs: finite(holdMs) ? Math.max(0, holdMs) : DEFAULT_HOLD_MS,
        queue: [],
        latestReceived: null,
        selected: null,
        lastAppliedKey: null,
        lastFrameId: null,
        lastVideoAt: null,
        lastCaptureEpoch: null,
        lastReceiveEpoch: null,
        waitStartedAt: null,
        mode: 'fallback',
    };
}

export function resetSyncState(state) {
    if (!state) return state;
    state.queue.length = 0;
    state.latestReceived = null;
    state.selected = null;
    state.lastAppliedKey = null;
    state.lastFrameId = null;
    state.lastVideoAt = null;
    state.lastCaptureEpoch = null;
    state.lastReceiveEpoch = null;
    state.waitStartedAt = null;
    state.mode = 'fallback';
    return state;
}

function packetKey(packet) {
    if (!packet) return null;
    return Number.isSafeInteger(packet.frameId) ? `id:${packet.frameId}` : packet;
}

function entryPacket(entry) {
    return entry?.packet || null;
}

function isCompletePacket(packet) {
    return Boolean(packet && finite(packet.timestamp) && Math.abs(packet.timestamp) <= 1e15);
}

/** Insert a complete packet and its local arrival time, retaining a bounded window. */
export function enqueueSyncPacket(state, packet, receivedAt = Date.now()) {
    if (!state || !isCompletePacket(packet)) return false;
    const arrival = finite(receivedAt) ? receivedAt : Date.now();

    // A lower frame ID marks a writer/session discontinuity. Do not allow old
    // timestamps from the preceding stream to be selected after the reset.
    if (Number.isSafeInteger(packet.frameId) && Number.isSafeInteger(state.lastFrameId) && packet.frameId < state.lastFrameId) {
        const latestPacket = entryPacket(state.latestReceived);
        if (latestPacket && packet.timestamp < latestPacket.timestamp) return false;
        resetSyncState(state);
    }
    state.lastFrameId = Number.isSafeInteger(packet.frameId) ? packet.frameId : state.lastFrameId;

    const existing = state.queue.findIndex(entry => {
        const item = entryPacket(entry);
        return item === packet || (
            Number.isSafeInteger(item?.frameId) && Number.isSafeInteger(packet.frameId) && item.frameId === packet.frameId
        );
    });
    if (existing >= 0) state.queue.splice(existing, 1);
    const entry = { packet, receivedAt: arrival };
    state.latestReceived = entry;
    state.queue.push(entry);
    if (state.queue.length > state.maxQueue) state.queue.splice(0, state.queue.length - state.maxQueue);
    return true;
}

function findBestBefore(queue, target, field) {
    let best = null;
    for (const entry of queue) {
        const value = field === 'receivedAt' ? entry.receivedAt : entryPacket(entry)?.timestamp;
        if (!finite(value) || value > target) continue;
        const bestValue = best ? (field === 'receivedAt' ? best.receivedAt : entryPacket(best)?.timestamp) : null;
        const packet = entryPacket(entry);
        const bestPacket = entryPacket(best);
        if (!best || value > bestValue || (value === bestValue && (packet?.frameId ?? -1) > (bestPacket?.frameId ?? -1))) {
            best = entry;
        }
    }
    return best;
}

function newestRecent(state) {
    return state.latestReceived;
}

function markSelected(state, entry, mode) {
    const packet = entryPacket(entry);
    if (!packet) return null;
    state.selected = packet;
    state.mode = mode;
    state.lastAppliedKey = packetKey(packet);
    state.waitStartedAt = null;
    state.queue = state.queue.filter(item => {
        const candidate = entryPacket(item);
        if (Number.isSafeInteger(candidate?.frameId) && Number.isSafeInteger(packet.frameId)) {
            return candidate.frameId > packet.frameId;
        }
        return candidate?.timestamp > packet.timestamp;
    });
    return packet;
}

/**
 * Pick the newest telemetry packet at or before the presented video time.
 * `clockOffsetMs` is server-clock minus viewer-clock. It is deliberately
 * applied only at comparison time; relayed packets are never rewritten.
 */
export function presentVideoFrame(state, captureEpoch, now = Date.now(), clockOffsetMs = 0) {
    if (!state || !finite(captureEpoch) || !finite(now)) return null;
    if (finite(state.lastCaptureEpoch) && (
        captureEpoch < state.lastCaptureEpoch - 1000 ||
        captureEpoch - state.lastCaptureEpoch > 120000
    )) {
        state.queue.length = 0;
        state.selected = null;
        state.lastAppliedKey = null;
        state.waitStartedAt = null;
    }
    const offset = finite(clockOffsetMs) ? clockOffsetMs : 0;
    const targetServerEpoch = captureEpoch + offset;
    const previousVideoAt = state.lastVideoAt;
    state.lastCaptureEpoch = captureEpoch;
    state.lastVideoAt = now;
    state.mode = 'auto';
    const best = findBestBefore(state.queue, targetServerEpoch, 'timestamp');
    if (best) return markSelected(state, best, 'auto');

    // The packet may still be in flight. Retain the previous complete packet
    // for a short bounded interval, then fall back to recent telemetry.
    if (state.waitStartedAt === null) state.waitStartedAt = now;
    if (now - state.waitStartedAt <= state.holdMs) return null;
    const fallback = entryPacket(newestRecent(state));
    if (fallback && packetKey(fallback) !== state.lastAppliedKey) {
        state.selected = fallback;
        state.mode = 'fallback';
        state.lastAppliedKey = packetKey(fallback);
        return fallback;
    }
    // If the callback is still producing frames but no telemetry can match,
    // keep the queue bounded and allow the RAF fallback to recover later.
    if (previousVideoAt !== null && now - previousVideoAt > state.holdMs) state.mode = 'fallback';
    return null;
}

/**
 * Estimated mode: match video receive time to the local WebSocket arrival
 * time recorded for each packet. Source timestamps and clock offset are
 * intentionally ignored in this mode.
 */
export function presentVideoReceiveTime(state, receiveEpoch, now = Date.now()) {
    if (!state || !finite(receiveEpoch) || !finite(now)) return null;
    if (finite(state.lastReceiveEpoch) && (
        receiveEpoch < state.lastReceiveEpoch - 1000 ||
        receiveEpoch - state.lastReceiveEpoch > 120000
    )) {
        state.queue.length = 0;
        state.selected = null;
        state.lastAppliedKey = null;
        state.waitStartedAt = null;
    }
    state.lastReceiveEpoch = receiveEpoch;
    state.lastVideoAt = now;
    state.mode = 'estimated';
    const best = findBestBefore(state.queue, receiveEpoch, 'receivedAt');
    if (best) return markSelected(state, best, 'estimated');
    if (state.waitStartedAt === null) state.waitStartedAt = now;
    if (now - state.waitStartedAt <= state.holdMs) return null;
    const fallback = entryPacket(newestRecent(state));
    if (fallback && packetKey(fallback) !== state.lastAppliedKey) {
        state.selected = fallback;
        state.mode = 'fallback';
        state.lastAppliedKey = packetKey(fallback);
        return fallback;
    }
    state.mode = 'fallback';
    return null;
}

/** Return a packet when rVFC is unavailable, suspended, or metadata is bad. */
export function fallbackSyncFrame(state, now = Date.now()) {
    if (!state || !finite(now)) return null;
    const hasRecentVideo = ['auto', 'estimated'].includes(state.mode) && finite(state.lastVideoAt) && now - state.lastVideoAt <= state.holdMs;
    if (hasRecentVideo) return null;
    const entry = newestRecent(state);
    const packet = entryPacket(entry);
    if (!packet || packetKey(packet) === state.lastAppliedKey) return null;
    state.selected = packet;
    state.mode = 'fallback';
    state.lastAppliedKey = packetKey(packet);
    state.queue = state.queue.filter(item => item !== entry);
    return packet;
}

/** Convert rVFC metadata.captureTime to a local epoch safely. */
export function captureTimeToEpoch(metadata, { timeOrigin, now = Date.now() } = {}) {
    const captureTime = metadata?.captureTime;
    if (!finite(captureTime)) return null;
    const origin = finite(timeOrigin) ? timeOrigin : null;
    let epoch = null;
    if (captureTime > 1e11) epoch = captureTime;
    else if (origin !== null) epoch = origin + captureTime;
    if (!finite(epoch)) return null;
    // Reject values that clearly came from a different timebase. A short
    // camera/network delay is valid; hours of skew is not.
    if (finite(now) && Math.abs(epoch - now) > 120000) return null;
    return epoch;
}

export function receiveTimeToEpoch(metadata, options = {}) {
    return captureTimeToEpoch({ captureTime: metadata?.receiveTime }, options);
}

export function createClockEstimator({ maxSamples = 8, maxRttMs = CLOCK_SYNC_MAX_RTT_MS, alpha = 0.2 } = {}) {
    return {
        maxSamples: finite(maxSamples) ? Math.max(2, Math.floor(maxSamples)) : 8,
        maxRttMs: finite(maxRttMs) ? Math.max(1, maxRttMs) : CLOCK_SYNC_MAX_RTT_MS,
        alpha: finite(alpha) ? Math.min(1, Math.max(0.02, alpha)) : 0.2,
        samples: [],
        offsetMs: 0,
        rttMs: null,
        ready: false,
    };
}

export function resetClockEstimator(estimator) {
    if (!estimator) return estimator;
    estimator.samples.length = 0;
    estimator.offsetMs = 0;
    estimator.rttMs = null;
    estimator.ready = false;
    return estimator;
}

/** Add an NTP-style t0/t1/t2/t3 sample and reject implausible samples. */
export function addClockSample(estimator, { clientSend, serverReceive, serverSend, clientReceive }) {
    if (!estimator || ![clientSend, serverReceive, serverSend, clientReceive].every(finite)) return false;
    const rtt = (clientReceive - clientSend) - (serverSend - serverReceive);
    const offset = ((serverReceive - clientSend) + (serverSend - clientReceive)) / 2;
    if (!finite(rtt) || !finite(offset) || rtt < 0 || rtt > estimator.maxRttMs) return false;
    if (estimator.ready && Math.abs(offset - estimator.offsetMs) > CLOCK_SYNC_MAX_OFFSET_JUMP_MS) return false;

    estimator.samples.push({ offset, rtt });
    if (estimator.samples.length > estimator.maxSamples) estimator.samples.shift();
    const sorted = estimator.samples.map(sample => sample.offset).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    estimator.offsetMs = estimator.ready
        ? estimator.offsetMs + (median - estimator.offsetMs) * estimator.alpha
        : median;
    estimator.rttMs = estimator.samples.reduce((sum, sample) => sum + sample.rtt, 0) / estimator.samples.length;
    estimator.ready = true;
    return true;
}

export function clockEstimate(estimator) {
    return estimator?.ready && finite(estimator.offsetMs) ? estimator.offsetMs : 0;
}
