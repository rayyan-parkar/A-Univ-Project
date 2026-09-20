import { access, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { FILE_GROUPS, REQUIRED_FILES } from './dataFiles.js';
import { createTelemetryFrame } from './telemetryProtocol.js';

export const LIVE_STATUS = Object.freeze({ STARTING: 'Starting', RUNNING: 'Running', PAUSED: 'Paused', STOPPED: 'Stopped', ERROR: 'Error' });
export const DEFAULT_POLL_INTERVAL_MS = 33;
export const MAX_READ_CHUNK_BYTES = 64 * 1024;
export const MAX_QUEUE_ROWS = 256;
export const MAX_CARRY_BYTES = 256 * 1024;
export const MAX_FRAMES_PER_POLL = 4;

const FILE_KIND = new Map([
    ...FILE_GROUPS.waveform.map(name => [name, 'waveform']),
    ...FILE_GROUPS.vector.map(name => [name, 'vector']),
    ...FILE_GROUPS.communication.map(name => [name, 'communication'])
]);
const SHAPES = { waveform: 2, vector: 9, communication: 2 };

const signature = info => `${info.dev}:${info.ino}`;
const isFiniteRow = (row, count) => row.length === count && row.every(value => Number.isFinite(value));
const parseRow = (line, kind) => {
    const values = line.trim().split(/\s+/).map(Number);
    return isFiniteRow(values, SHAPES[kind]) ? values : null;
};

function emptyCursor(name) {
    return { name, offset: 0, carry: '', rows: [], signature: null, mtimeMs: null, discarded: false };
}

/**
 * Incrementally tails the eight experiment files. A row is only consumed when
 * every file has the same next row available; malformed rows consume one row
 * from every file so one bad measurement cannot wedge the stream forever.
 */
export class LiveIngestEngine {
    constructor({ onFrame, onStatus, onWarning, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, maxQueueRows = MAX_QUEUE_ROWS, maxReadBytes = MAX_READ_CHUNK_BYTES, maxFramesPerPoll = MAX_FRAMES_PER_POLL } = {}) {
        this.onFrame = onFrame || (() => {});
        this.onStatus = onStatus || (() => {});
        this.onWarning = onWarning || (() => {});
        this.pollIntervalMs = Math.max(1, pollIntervalMs);
        this.maxQueueRows = Math.max(8, maxQueueRows);
        this.maxReadBytes = Math.min(MAX_READ_CHUNK_BYTES, Math.max(1024, maxReadBytes));
        const requestedMaxFrames = Number.isFinite(maxFramesPerPoll) ? Math.floor(maxFramesPerPoll) : MAX_FRAMES_PER_POLL;
        this.maxFramesPerPoll = Math.min(MAX_FRAMES_PER_POLL, Math.max(1, requestedMaxFrames));
        this.directory = null;
        this.cursors = new Map(REQUIRED_FILES.map(name => [name, emptyCursor(name)]));
        this.frameId = 0;
        this.timer = null;
        this.pollInFlightGeneration = null;
        this.pollInFlightPromise = null;
        this.stopped = true;
        this.paused = false;
        this.lastWarningAt = 0;
        this.warningCount = 0;
        this.lastRuntimeError = '';
        this.lastRuntimeErrorAt = 0;
        this.generation = 0;
        this.pauseReason = null;
    }

    status(status, detail) {
        this.onStatus({ status, ...(detail ? { detail } : {}) });
    }

    warn(message) {
        const now = Date.now();
        if (now - this.lastWarningAt < 1000) return;
        this.lastWarningAt = now;
        this.warningCount += 1;
        this.onWarning({ message, count: this.warningCount });
    }

    async validateDirectory(directory) {
        if (typeof directory !== 'string' || directory.length === 0) throw new Error('Live data directory is required');
        const resolved = path.resolve(directory);
        let dirInfo;
        try { dirInfo = await stat(resolved); } catch (error) { throw new Error(`Live data directory is not readable: ${error.message}`); }
        if (!dirInfo.isDirectory()) throw new Error(`Live data path is not a directory: ${resolved}`);
        for (const name of REQUIRED_FILES) {
            const filename = path.join(resolved, name);
            try {
                const info = await stat(filename);
                if (!info.isFile()) throw new Error('not a regular file');
                await access(filename);
            } catch (error) { throw new Error(`Required live data file ${name} is not readable in ${resolved}: ${error.message}`); }
        }
        return resolved;
    }

    resetCursors() {
        this.cursors = new Map(REQUIRED_FILES.map(name => [name, emptyCursor(name)]));
    }

    schedule(run = this.generation) {
        if (this.timer || this.stopped || this.paused) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.poll(run);
        }, this.pollIntervalMs);
    }

    async start(directory, { reclaim = false } = {}) {
        const resolved = await this.validateDirectory(directory);
        const sameDirectory = this.directory === resolved;
        if (sameDirectory && !this.stopped && !this.paused) return { directory: resolved, resumed: false };
        if (sameDirectory && !this.stopped && this.paused && reclaim && this.pauseReason === 'reconnect') {
            this.resume();
            return { directory: resolved, resumed: true };
        }
        // A brand-new engine has no generation to terminate; avoid emitting a
        // misleading Stopped event before its first Starting event.
        if (!this.stopped || this.paused || this.directory !== null) await this.stop(false);
        this.directory = resolved;
        this.resetCursors();
        this.frameId = 0;
        this.stopped = false;
        this.paused = false;
        this.pauseReason = null;
        this.status(LIVE_STATUS.STARTING, { directory: resolved });
        this.status(LIVE_STATUS.RUNNING, { directory: resolved });
        this.schedule();
        return { directory: resolved };
    }

    pause(reason = 'manual') {
        if (this.stopped || this.paused) return false;
        this.paused = true;
        this.pauseReason = reason;
        this.generation += 1;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.status(LIVE_STATUS.PAUSED, { directory: this.directory });
        return true;
    }

    resume() {
        if (this.stopped || !this.paused) return;
        this.paused = false;
        this.pauseReason = null;
        this.generation += 1;
        this.status(LIVE_STATUS.RUNNING, { directory: this.directory });
        this.schedule();
    }

    async stop(clearDirectory = true) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.stopped = true;
        this.paused = false;
        this.pauseReason = null;
        this.generation += 1;
        if (this.pollInFlightPromise) {
            try {
                await this.pollInFlightPromise;
            } catch {
                // In-flight poll completed or was cancelled
            }
        }
        this.resetCursors();
        if (clearDirectory) this.directory = null;
        this.status(LIVE_STATUS.STOPPED, clearDirectory ? undefined : { directory: this.directory });
    }

    async detectRecreation(run) {
        let changed = false;
        for (const cursor of this.cursors.values()) {
            let info;
            try {
                info = await stat(path.join(this.directory, cursor.name));
            } catch {
                changed = true;
                break;
            }
            if (run !== this.generation || this.stopped || this.paused) return false;
            const currentSignature = signature(info);
            if ((cursor.signature && cursor.signature !== currentSignature) || info.size < cursor.offset || (info.size === cursor.offset && cursor.mtimeMs !== null && info.mtimeMs !== cursor.mtimeMs)) {
                changed = true;
                break;
            }
        }
        if (changed) {
            this.resetCursors();
            this.warn('Live data files were truncated or recreated; realigning all row cursors.');
            this.paused = true;
            this.status(LIVE_STATUS.ERROR, 'Live files changed; restart the live stream after all eight files are ready.');
        }
        return changed;
    }

    async readCursor(cursor, run) {
        const kind = FILE_KIND.get(cursor.name);
        const consumeCarry = () => {
            if (cursor.discarded) {
                const newlineIndex = cursor.carry.indexOf('\n');
                if (newlineIndex === -1) {
                    cursor.carry = '';
                    return;
                }
                cursor.carry = cursor.carry.slice(newlineIndex + 1);
                cursor.discarded = false;
            }
            while (cursor.rows.length < this.maxQueueRows) {
                const newlineIndex = cursor.carry.indexOf('\n');
                if (newlineIndex === -1) break;
                const rawLine = cursor.carry.slice(0, newlineIndex);
                cursor.carry = cursor.carry.slice(newlineIndex + 1);
                const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
                if (!line.trim()) continue;
                cursor.rows.push(parseRow(line, kind));
            }
        };
        // Consume already-buffered complete lines before reading more bytes;
        // otherwise a fast producer can grow carry while output is paced.
        consumeCarry();
        if (cursor.rows.length >= this.maxQueueRows) return true;
        if (cursor.carry.length > MAX_CARRY_BYTES && !cursor.carry.includes('\n')) {
            cursor.carry = '';
            cursor.discarded = true;
            this.warn(`Live data row in ${cursor.name} exceeded the bounded line size.`);
            return true;
        }
        const filename = path.join(this.directory, cursor.name);
        let handle;
        try {
            handle = await open(filename, 'r');
        } catch (error) {
            this.resetCursors();
            this.paused = true;
            this.status(LIVE_STATUS.ERROR, `Live data file ${cursor.name} could not be opened: ${error.message}`);
            throw error;
        }
        try {
            const info = await handle.stat();
            if (run !== this.generation || this.stopped || this.paused) return false;
            const currentSignature = signature(info);
            if ((cursor.signature && cursor.signature !== currentSignature) || info.size < cursor.offset) {
                this.resetCursors();
                this.paused = true;
                this.status(LIVE_STATUS.ERROR, 'Live files changed during a read; restart the live stream after all eight files are ready.');
                throw new Error('Live data files changed during a read; restart the live stream after all eight files are ready');
            }
            cursor.signature = currentSignature;
            cursor.mtimeMs = info.mtimeMs;
            if (info.size <= cursor.offset) return true;
            const amount = Math.min(this.maxReadBytes, info.size - cursor.offset);
            const buffer = new Uint8Array(amount);
            const { bytesRead } = await handle.read(buffer, 0, amount, cursor.offset);
            if (run !== this.generation || this.stopped || this.paused) return false;
            cursor.offset += bytesRead;
            cursor.mtimeMs = info.mtimeMs;
            cursor.carry += new TextDecoder().decode(buffer.subarray(0, bytesRead));
        } finally {
            await handle.close();
        }
        consumeCarry();
        return true;
    }

    emitFrames(maxFrames = this.maxFramesPerPoll, run = this.generation) {
        const waveform = FILE_GROUPS.waveform;
        const vector = FILE_GROUPS.vector;
        const communication = FILE_GROUPS.communication;
        if (this.stopped || this.paused) return;

        let processed = 0;
        while (processed < maxFrames && run === this.generation && !this.stopped && !this.paused && REQUIRED_FILES.every(name => this.cursors.get(name).rows.length > 0)) {
            const rows = new Map(REQUIRED_FILES.map(name => [name, this.cursors.get(name).rows.shift()]));
            processed += 1;
            const valid = [...rows.entries()].every(([name, row]) => row !== null && row.length === SHAPES[FILE_KIND.get(name)]);
            if (!valid) {
                this.warn('Malformed synchronized live data row discarded; subsequent rows remain aligned.');
                continue;
            }
            const frame = createTelemetryFrame({
                frameId: this.frameId,
                timestamp: Date.now(),
                waveform: [rows.get(waveform[0])[0], rows.get(waveform[1])[0]],
                vector: [...rows.get(vector[0]), ...rows.get(vector[1]), ...rows.get(vector[2])].reduce((all, value, index, values) => {
                    if (index % 3 === 0) all.push(values.slice(index, index + 3));
                    return all;
                }, []),
                communication: [rows.get(communication[0]), rows.get(communication[1]), rows.get(communication[2])]
            });
            this.frameId += 1;
            if (!this.stopped && !this.paused) this.onFrame(frame);
        }
    }

    async poll(run = this.generation) {
        if (this.stopped || this.paused || !this.directory || run !== this.generation) return;
        if (this.pollInFlightGeneration !== null) {
            this.schedule(run);
            return;
        }
        this.pollInFlightGeneration = run;
        let resolveInFlight;
        this.pollInFlightPromise = new Promise(resolve => {
            resolveInFlight = resolve;
        });
        try {
            const recreated = await this.detectRecreation(run);
            if (recreated || run !== this.generation || this.stopped || this.paused) return;
            await Promise.all([...this.cursors.values()].map(cursor => this.readCursor(cursor, run)));
            if (run !== this.generation || this.stopped || this.paused) return;
            this.emitFrames(this.maxFramesPerPoll, run);
            if (this.lastRuntimeError) {
                this.lastRuntimeError = '';
                this.status(LIVE_STATUS.RUNNING, { directory: this.directory });
            }
        } catch (error) {
            if (!this.stopped && run === this.generation) {
                const now = Date.now();
                if (this.lastRuntimeError !== error.message || now - this.lastRuntimeErrorAt >= 1000) {
                    this.lastRuntimeError = error.message;
                    this.lastRuntimeErrorAt = now;
                    this.status(LIVE_STATUS.ERROR, { detail: error.message });
                    this.warn(`Live ingest read failed: ${error.message}`);
                }
            }
        } finally {
            if (this.pollInFlightGeneration === run) {
                this.pollInFlightGeneration = null;
                this.pollInFlightPromise = null;
            }
            resolveInFlight();
            if (run === this.generation && !this.stopped && !this.paused) this.schedule(run);
        }
    }
}

export { REQUIRED_FILES };
