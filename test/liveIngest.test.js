import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LiveIngestEngine, MAX_FRAMES_PER_POLL, REQUIRED_FILES } from '../src/liveIngest.js';

const names = REQUIRED_FILES;
const filesFor = directory => Object.fromEntries(names.map(name => [name, path.join(directory, name)]));
const rowFor = index => ({
    VibrationData: `${index} ${index + 0.1}`,
    VibrationData_FPGA: `${index + 0.2} ${index + 0.3}`,
    SphericalData_low: `${index} ${index + 1} ${index + 2} ${index + 3} ${index + 4} ${index + 5} ${index + 6} ${index + 7} ${index + 8}`,
    SphericalData_medium: `${index + 10} ${index + 11} ${index + 12} ${index + 13} ${index + 14} ${index + 15} ${index + 16} ${index + 17} ${index + 18}`,
    SphericalData_high: `${index + 20} ${index + 21} ${index + 22} ${index + 23} ${index + 24} ${index + 25} ${index + 26} ${index + 27} ${index + 28}`,
    CommunicationData_low: `${index + 30} ${index + 31}`,
    CommunicationData_medium: `${index + 32} ${index + 33}`,
    CommunicationData_high: `${index + 34} ${index + 35}`
});
const keyFor = name => name.replace(/\.txt$/, '');

async function fixture() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phase3-ingest-'));
    const files = filesFor(directory);
    await Promise.all(names.map(name => writeFile(files[name], '')));
    return { directory, files };
}

async function appendRow(files, index, { newline = true } = {}) {
    const row = rowFor(index);
    await Promise.all(names.map(name => appendFile(files[name], `${row[keyFor(name)]}${newline ? '\n' : ''}`)));
}

async function makeEngine(directory, frames, warnings = []) {
    const engine = new LiveIngestEngine({ directory, onFrame: frame => frames.push(frame), onWarning: warning => warnings.push(warning), pollIntervalMs: 100000, maxFramesPerPoll: 1 });
    await engine.start(directory);
    return engine;
}

test('reads coherent initial and incrementally appended rows', async () => {
    const { directory, files } = await fixture();
    try {
        await appendRow(files, 0); await appendRow(files, 1);
        const frames = []; const engine = await makeEngine(directory, frames);
        await engine.poll();
        assert.equal(frames.length, 1); assert.equal(frames[0].frameId, 0); assert.equal(frames[0].waveform[0], 0);
        await engine.poll(); assert.equal(frames.length, 2); assert.equal(frames[1].frameId, 1);
        await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bounds per-poll catch-up while preserving ordered frame IDs and data', async () => {
    const { directory, files } = await fixture();
    try {
        for (let index = 0; index < 5; index += 1) await appendRow(files, index);
        const frames = [];
        const engine = new LiveIngestEngine({
            onFrame: frame => frames.push(frame),
            pollIntervalMs: 100000,
            maxFramesPerPoll: 2
        });
        await engine.start(directory);
        await engine.poll();
        assert.deepEqual(frames.map(frame => [frame.frameId, frame.waveform[0]]), [[0, 0], [1, 1]]);
        await engine.poll();
        assert.deepEqual(frames.map(frame => [frame.frameId, frame.waveform[0]]), [[0, 0], [1, 1], [2, 2], [3, 3]]);
        await engine.poll();
        assert.deepEqual(frames.map(frame => [frame.frameId, frame.waveform[0]]), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
        await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('keeps the per-poll frame cap bounded for invalid configuration', () => {
    assert.equal(new LiveIngestEngine({ maxFramesPerPoll: Number.NaN }).maxFramesPerPoll, MAX_FRAMES_PER_POLL);
    assert.equal(new LiveIngestEngine({ maxFramesPerPoll: Number.POSITIVE_INFINITY }).maxFramesPerPoll, MAX_FRAMES_PER_POLL);
    assert.equal(new LiveIngestEngine({ maxFramesPerPoll: Number.MAX_SAFE_INTEGER }).maxFramesPerPoll, MAX_FRAMES_PER_POLL);
});

test('reclaims a reconnect pause without replaying rows or resetting frame IDs', async () => {
    const { directory, files } = await fixture();
    try {
        await appendRow(files, 0); await appendRow(files, 1);
        const frames = [];
        const engine = new LiveIngestEngine({ onFrame: frame => frames.push(frame), pollIntervalMs: 100000, maxFramesPerPoll: 2 });
        await engine.start(directory);
        await engine.poll();
        assert.deepEqual(frames.map(frame => frame.frameId), [0, 1]);
        assert.deepEqual(await engine.start(directory), { directory: path.resolve(directory), resumed: false });
        engine.pause('reconnect');
        await appendRow(files, 2); await appendRow(files, 3);
        assert.deepEqual(await engine.start(directory, { reclaim: true }), { directory: path.resolve(directory), resumed: true });
        await engine.poll();
        assert.deepEqual(frames.map(frame => [frame.frameId, frame.waveform[0]]), [[0, 0], [1, 1], [2, 2], [3, 3]]);
        await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('explicit stop followed by start resets cursors and frame IDs', async () => {
    const { directory, files } = await fixture();
    try {
        await appendRow(files, 0);
        const frames = [];
        const engine = await makeEngine(directory, frames);
        await engine.poll();
        await engine.stop();
        await Promise.all(names.map(name => truncate(files[name], 0)));
        await appendRow(files, 9);
        await engine.start(directory);
        await engine.poll();
        assert.deepEqual(frames.map(frame => [frame.frameId, frame.waveform[0]]), [[0, 0], [0, 9]]);
        await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('waits for all eight files and incomplete trailing lines', async () => {
    const { directory, files } = await fixture();
    try {
        const row = rowFor(0);
        await appendFile(files['VibrationData.txt'], `${row.VibrationData}\n`);
        const frames = []; const engine = await makeEngine(directory, frames); await engine.poll(); assert.equal(frames.length, 0);
        await Promise.all(names.slice(1).map(name => appendFile(files[name], `${row[keyFor(name)]}`)));
        await engine.poll(); assert.equal(frames.length, 0);
        await Promise.all(names.slice(1).map(name => appendFile(files[name], '\n')));
        await engine.poll(); assert.equal(frames.length, 1); await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('drops a malformed synchronized row without losing alignment', async () => {
    const { directory, files } = await fixture();
    try {
        await appendRow(files, 0);
        const bad = rowFor(1);
        await Promise.all(names.map(name => appendFile(files[name], `${name === 'SphericalData_low.txt' ? 'bad row' : bad[keyFor(name)]}\n`)));
        await appendRow(files, 2);
        const frames = []; const warnings = []; const engine = await makeEngine(directory, frames, warnings);
        await engine.poll(); await engine.poll(); await engine.poll();
        assert.equal(frames.length, 2); assert.equal(frames[0].waveform[0], 0); assert.equal(frames[1].waveform[0], 2);
        assert.deepEqual(frames[1].vector[0], [2, 3, 4]); assert.deepEqual(frames[1].vector[3], [12, 13, 14]);
        assert.ok(warnings.length > 0); await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('realigns after truncation, pauses without replay, and reports missing files', async () => {
    const { directory, files } = await fixture();
    try {
        await appendRow(files, 0); const frames = []; const engine = await makeEngine(directory, frames); await engine.poll(); assert.equal(frames.length, 1);
        engine.pause(); await appendRow(files, 1); await engine.poll(); assert.equal(frames.length, 1); engine.resume(); await engine.poll(); assert.equal(frames.length, 2);
        await Promise.all(names.map(name => truncate(files[name], 0))); await engine.poll();
        assert.equal(frames.length, 2); await appendRow(files, 7); await engine.start(directory); await engine.poll();
        assert.equal(frames.at(-1).waveform[0], 7); await engine.stop();
        await rm(files['VibrationData.txt']); const failed = new LiveIngestEngine(); await assert.rejects(() => failed.start(directory), /Required live data file/); await failed.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bounds buffering and streams coherently under a fast writer', async () => {
    const { directory, files } = await fixture();
    try {
        // Append 400 rows rapidly into all 8 files
        for (let i = 0; i < 400; i += 1) {
            await appendRow(files, i);
        }
        const frames = [];
        const engine = await makeEngine(directory, frames);
        // Initial poll loads bounded rows into cursor queues
        await engine.poll();
        for (const name of names) {
            const cursor = engine.cursors.get(name);
            assert.ok(cursor.rows.length <= engine.maxQueueRows, `Queue for ${name} exceeded maxQueueRows: ${cursor.rows.length}`);
        }
        assert.equal(frames.length, 1);
        assert.equal(frames[0].frameId, 0);
        assert.equal(frames[0].waveform[0], 0);

        // Advance 10 more polls: frame IDs and values advance monotonically in lockstep
        for (let step = 1; step <= 10; step += 1) {
            await engine.poll();
            assert.equal(frames.length, step + 1);
            assert.equal(frames[step].frameId, step);
            assert.equal(frames[step].waveform[0], step);
        }
        await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('detects file rotation via file replacement and realigns on restart', async () => {
    const { directory, files } = await fixture();
    try {
        await appendRow(files, 0);
        const frames = [];
        const statusEvents = [];
        const engine = new LiveIngestEngine({
            directory,
            onFrame: frame => frames.push(frame),
            onStatus: status => statusEvents.push(status),
            pollIntervalMs: 100000
        });
        await engine.start(directory);
        await engine.poll();
        assert.equal(frames.length, 1);
        assert.equal(frames[0].waveform[0], 0);

        // Replace one file by rewriting it (simulating log rotation / recreation)
        await writeFile(files['VibrationData.txt'], '');
        await engine.poll();
        assert.equal(engine.paused, true);
        assert.ok(statusEvents.some(event => event.status === 'Error'));

        // All 8 files truncated/rotated with new row 99
        await Promise.all(names.map(name => writeFile(files[name], '')));
        await appendRow(files, 99);
        await engine.start(directory);
        await engine.poll();
        assert.equal(frames.length, 2);
        assert.equal(frames[1].waveform[0], 99);
        await engine.stop();
    } finally { await rm(directory, { recursive: true, force: true }); }
});
