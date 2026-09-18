import fs from 'fs';
import path from 'path';
import os from 'os';

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a-univ-experiment-'));

console.log('🧪 Starting Mock Experiment Data Writer...');
console.log(`📁 Test directory: ${outDir}`);

fs.mkdirSync(outDir, { recursive: true });

const files = {
  vibration: path.join(outDir, 'VibrationData.txt'),
  vibrationFPGA: path.join(outDir, 'VibrationData_FPGA.txt'),
  sphericalLow: path.join(outDir, 'SphericalData_low.txt'),
  sphericalMed: path.join(outDir, 'SphericalData_medium.txt'),
  sphericalHigh: path.join(outDir, 'SphericalData_high.txt'),
  commLow: path.join(outDir, 'CommunicationData_low.txt'),
  commMed: path.join(outDir, 'CommunicationData_medium.txt'),
  commHigh: path.join(outDir, 'CommunicationData_high.txt'),
};

let interval = null;

// Cleanup on exit
function cleanup() {
  if (interval) clearInterval(interval);
  console.log(`\n🧹 Cleaning up ${outDir} (files created by this process only)...`);
  try {
    for (const filename of Object.values(files)) if (fs.existsSync(filename)) fs.unlinkSync(filename);
    if (fs.existsSync(outDir)) fs.rmdirSync(outDir);
    console.log('✅ Cleanup complete. Sample files were not modified.');
  } catch (err) {
    console.error('Error during cleanup:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

let step = 0;

function generateLine(stepIdx) {
  // Vibration
  const vib = Math.sin(stepIdx * 0.1);
  const fpga = Math.round(vib * 4) / 4;

  // Spherical
  const angle = stepIdx * 0.05;
  const highVec = [Math.cos(angle), Math.sin(angle), Math.sin(angle * 2) * 0.5];
  const medVec = [
    Math.round(Math.cos(angle) * 8) / 8,
    Math.round(Math.sin(angle) * 8) / 8,
    Math.round(Math.sin(angle * 2) * 4) / 8,
  ];
  const lowVec = [
    Math.round(Math.cos(angle) * 3) / 3,
    Math.round(Math.sin(angle) * 3) / 3,
    Math.round(Math.sin(angle * 2) * 2) / 3,
  ];

  const format9 = (v) => [
    v[0].toFixed(3), v[1].toFixed(3), v[2].toFixed(3),
    (v[0] + 0.02).toFixed(3), (v[1] + 0.02).toFixed(3), (v[2] + 0.02).toFixed(3),
    (v[0] - 0.02).toFixed(3), (v[1] - 0.02).toFixed(3), (v[2] - 0.02).toFixed(3),
  ].join(' ');

  // Communication
  const centers = [[0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];
  const c = centers[stepIdx % centers.length];
  const noise = (s) => ((Math.random() - 0.5) * s);

  return {
    vib: `${vib.toFixed(3)} 0.000\n`,
    fpga: `${fpga.toFixed(3)} 0.000\n`,
    sLow: `${format9(lowVec)}\n`,
    sMed: `${format9(medVec)}\n`,
    sHigh: `${format9(highVec)}\n`,
    cLow: `${(c[0] + noise(0.4)).toFixed(3)} ${(c[1] + noise(0.4)).toFixed(3)}\n`,
    cMed: `${(c[0] + noise(0.2)).toFixed(3)} ${(c[1] + noise(0.2)).toFixed(3)}\n`,
    cHigh: `${(c[0] + noise(0.08)).toFixed(3)} ${(c[1] + noise(0.08)).toFixed(3)}\n`,
  };
}

// Initial batch of 15 lines
for (let i = 0; i < 15; i++) {
  const line = generateLine(i);
  fs.appendFileSync(files.vibration, line.vib);
  fs.appendFileSync(files.vibrationFPGA, line.fpga);
  fs.appendFileSync(files.sphericalLow, line.sLow);
  fs.appendFileSync(files.sphericalMed, line.sMed);
  fs.appendFileSync(files.sphericalHigh, line.sHigh);
  fs.appendFileSync(files.commLow, line.cLow);
  fs.appendFileSync(files.commMed, line.cMed);
  fs.appendFileSync(files.commHigh, line.cHigh);
}
step = 15;

console.log(`✅ Initial 15 lines created in ${outDir}`);
console.log('⚡ Continuously appending live experiment measurements every 100ms...');
console.log('👉 Point the Host GUI "Live Experiment Files" selector to this folder.');
console.log('🛑 Press Ctrl+C at any time to stop and automatically delete test files.\n');

interval = setInterval(() => {
  step++;
  const line = generateLine(step);

  fs.appendFileSync(files.vibration, line.vib);
  fs.appendFileSync(files.vibrationFPGA, line.fpga);
  fs.appendFileSync(files.sphericalLow, line.sLow);
  fs.appendFileSync(files.sphericalMed, line.sMed);
  fs.appendFileSync(files.sphericalHigh, line.sHigh);
  fs.appendFileSync(files.commLow, line.cLow);
  fs.appendFileSync(files.commMed, line.cMed);
  fs.appendFileSync(files.commHigh, line.cHigh);

  if (step % 20 === 0) {
    process.stdout.write(`\r📡 Written ${step} measurement lines across all 8 files...`);
  }
}, 100);
