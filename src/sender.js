import { WebSocket } from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const key = process.env.VITE_SENDER_KEY || 'default_sender_key';

const sphericalPathLow = './src/data/SphericalData_low.txt';
const sphericalPathMed = './src/data/SphericalData_medium.txt';
const sphericalPathHigh = './src/data/SphericalData_high.txt';
const communicationPathLow = './src/data/CommunicationData_low.txt';
const communicationPathMed = './src/data/CommunicationData_medium.txt';
const communicationPathHigh = './src/data/CommunicationData_high.txt';
const vibrationPath = './src/data/VibrationData.txt';
const vibrationPathFPGA = './src/data/VibrationData_FPGA.txt';

function loadLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return [];
  }
}

// In-memory cached datasets
const datasets = {
  sphericalLow: loadLines(sphericalPathLow),
  sphericalMed: loadLines(sphericalPathMed),
  sphericalHigh: loadLines(sphericalPathHigh),
  vibration: loadLines(vibrationPath),
  vibrationFPGA: loadLines(vibrationPathFPGA),
  commLow: loadLines(communicationPathLow),
  commMed: loadLines(communicationPathMed),
  commHigh: loadLines(communicationPathHigh),
};

console.log('Datasets loaded into memory:');
console.log(`- Spherical: ${datasets.sphericalLow.length} lines`);
console.log(`- Vibration: ${datasets.vibration.length} lines`);
console.log(`- Communication: ${datasets.commLow.length} lines`);

// 3 Independent Stream Line Indexes
let sphericalIndex = 0;
let vibrationIndex = 0;
let communicationIndex = 0;

function parseFloats(line) {
  const values = line.split(/\s+/).map(parseFloat);
  if (values.some(isNaN)) throw new Error('NaN detected in line');
  return values;
}

function sendSphericalData(socket) {
  const { sphericalLow, sphericalMed, sphericalHigh } = datasets;
  const minLen = Math.min(sphericalLow.length, sphericalMed.length, sphericalHigh.length);
  if (minLen === 0) return;

  if (sphericalIndex >= minLen) {
    sphericalIndex = 0;
    console.log('Restarting spherical data from beginning');
  }

  try {
    const lowValues = parseFloats(sphericalLow[sphericalIndex]);
    const medValues = parseFloats(sphericalMed[sphericalIndex]);
    const highValues = parseFloats(sphericalHigh[sphericalIndex]);

    const vectors = [
      [lowValues[0], lowValues[1], lowValues[2]],
      [lowValues[3], lowValues[4], lowValues[5]],
      [lowValues[6], lowValues[7], lowValues[8]],
      [medValues[0], medValues[1], medValues[2]],
      [medValues[3], medValues[4], medValues[5]],
      [medValues[6], medValues[7], medValues[8]],
      [highValues[0], highValues[1], highValues[2]],
      [highValues[3], highValues[4], highValues[5]],
      [highValues[6], highValues[7], highValues[8]],
    ];

    socket.send(JSON.stringify({ type: 'vector', data: vectors }));
  } catch (err) {
    console.warn(`Skipping malformed vector data at line ${sphericalIndex}: ${err.message}`);
  }

  sphericalIndex++;
}

function sendVibrationData(socket) {
  const { vibration, vibrationFPGA } = datasets;
  const minLen = Math.min(vibration.length, vibrationFPGA.length);
  if (minLen === 0) return;

  if (vibrationIndex >= minLen) {
    vibrationIndex = 0;
    console.log('Restarting vibration data from beginning');
  }

  try {
    const vibValues = parseFloats(vibration[vibrationIndex]);
    const vibFPGAValues = parseFloats(vibrationFPGA[vibrationIndex]);

    const vibrationData = [vibValues[0], vibFPGAValues[0]];
    socket.send(JSON.stringify({ type: 'waveform', data: vibrationData }));
  } catch (err) {
    console.warn(`Skipping malformed vibration data at line ${vibrationIndex}: ${err.message}`);
  }

  vibrationIndex++;
}

function sendCommunicationData(socket) {
  const { commLow, commMed, commHigh } = datasets;
  const minLen = Math.min(commLow.length, commMed.length, commHigh.length);
  if (minLen === 0) return;

  if (communicationIndex >= minLen) {
    communicationIndex = 0;
    console.log('Restarting communication data from beginning');
  }

  try {
    const lowValues = parseFloats(commLow[communicationIndex]);
    const medValues = parseFloats(commMed[communicationIndex]);
    const highValues = parseFloats(commHigh[communicationIndex]);

    const commData = [
      [lowValues[0], lowValues[1]],
      [medValues[0], medValues[1]],
      [highValues[0], highValues[1]],
    ];

    socket.send(JSON.stringify({ type: 'communication', data: commData }));
  } catch (err) {
    console.warn(`Skipping malformed communication data at line ${communicationIndex}: ${err.message}`);
  }

  communicationIndex++;
}

const socket = new WebSocket(`ws://127.0.0.1:8181?role=sender&token=${key}`);

socket.addEventListener('open', () => {
  console.log('WebSocket connection established!');

  const interval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      console.log('Connection lost.');
      clearInterval(interval);
      return;
    }

    sendSphericalData(socket);
    sendVibrationData(socket);
    sendCommunicationData(socket);
  }, 16);
});

socket.addEventListener('close', event => {
  console.log('WebSocket connection closed:', event.code, event.reason);
});

socket.addEventListener('error', error => {
  console.error('WebSocket error:', error);
});