export const TELEMETRY_FRAME_TYPE = 'telemetry-frame';
export const MAX_FRAME_ID = Number.MAX_SAFE_INTEGER;

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const isSafeFrameId = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_FRAME_ID;

export function isWaveform(value) {
    return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}

export function isVector(value) {
    return Array.isArray(value) && value.length === 9 && value.every(item => Array.isArray(item) && item.length === 3 && item.every(isFiniteNumber));
}

export function isCommunication(value) {
    return Array.isArray(value) && value.length === 3 && value.every(item => Array.isArray(item) && item.length === 2 && item.every(isFiniteNumber));
}

export function validateTelemetryFrame(frame) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return 'frame must be an object';
    if (frame.type !== TELEMETRY_FRAME_TYPE) return 'frame type is invalid';
    if (!isSafeFrameId(frame.frameId)) return 'frameId must be a non-negative safe integer';
    if (!isFiniteNumber(frame.timestamp)) return 'timestamp must be finite';
    if (!isWaveform(frame.waveform)) return 'waveform must contain two finite numbers';
    if (!isVector(frame.vector)) return 'vector must contain nine three-number vectors';
    if (!isCommunication(frame.communication)) return 'communication must contain three two-number points';
    return null;
}

export function isTelemetryFrame(frame) {
    return validateTelemetryFrame(frame) === null;
}

export function createTelemetryFrame({ frameId, timestamp = Date.now(), waveform, vector, communication }) {
    const frame = { type: TELEMETRY_FRAME_TYPE, frameId, timestamp, waveform, vector, communication };
    const error = validateTelemetryFrame(frame);
    if (error) throw new TypeError(error);
    return frame;
}
