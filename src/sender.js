import { WebSocket } from 'ws';
import dotenv from 'dotenv';
import fs, { createReadStream } from 'fs';
import { createInterface } from 'readline';

dotenv.config()

const key = process.env.VITE_SENDER_KEY;
const sphericalPathLow = './src/data/SphericalData_low.txt';
const sphericalPathMed = './src/data/SphericalData_medium.txt';
const sphericalPathHigh = './src/data/SphericalData_high.txt';
const communicationPathLow = './src/data/CommunicationData_low.txt';
const communicationPathMed = './src/data/CommunicationData_medium.txt';
const communicationPathHigh = './src/data/CommunicationData_high.txt';
const vibrationPath = './src/data/VibrationData.txt';
const vibrationPathFPGA = './src/data/VibrationData_FPGA.txt';

async function readNewLinesStream(filePath, lastPosition) {
  return new Promise((resolve, reject)=> {
    if (!fs.existsSync(filePath)) {
      resolve({lines: [], newPosition: lastPosition});
      return;
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    if (lastPosition>= fileSize) {
      resolve({lines: [], newPosition: lastPosition});
      return;
    }

    const newLines = [];
    let currentPosition = lastPosition;

    const stream = createReadStream(filePath, {start: lastPosition, encoding: 'utf8'});
    const readline = createInterface( {input: stream, crlfDelay: Infinity})

    readline.on('line', line=> {
      if (line.trim()) {
        newLines.push(line.trim());
      }
      currentPosition+= Buffer.byteLength(line + '\n', 'utf-8');
    });

    readline.on('close', ()=> {
      resolve({lines: newLines, newPosition: fileSize});
    });

    readline.on('error', error=> {
      console.error(`Error reading ${filePath}:`, error);
      resolve({ lines: [], newPosition: lastPosition });
    });
  });
}

let lineIndex = 0;

async function sendSphericalData(socket) {
  try {
    const[lowData, medData, highData] = await Promise.all([
      readNewLinesStream(sphericalPathLow, 0),
      readNewLinesStream(sphericalPathMed, 0),
      readNewLinesStream(sphericalPathHigh, 0)
    ]);

    if (lineIndex < lowData.lines.length && 
        lineIndex < medData.lines.length && 
        lineIndex < highData.lines.length) {
      
      const vectors = [];
      
      try {
        const parseLine = (line) => {
          const values = line.split(/\s+/).map(parseFloat);
          if (values.some(isNaN)) throw new Error('Malformed data line: NaN detected');
          return values;
        };
        
        const lowValues = parseLine(lowData.lines[lineIndex]);
        const medValues = parseLine(medData.lines[lineIndex]);
        const highValues = parseLine(highData.lines[lineIndex]);
        
        vectors.push([lowValues[0],lowValues[1],lowValues[2]], [lowValues[3],lowValues[4],lowValues[5]], [lowValues[6],lowValues[7],lowValues[8]]);
        vectors.push([medValues[0],medValues[1],medValues[2]], [medValues[3],medValues[4],medValues[5]], [medValues[6],medValues[7],medValues[8]]);
        vectors.push([highValues[0],highValues[1],highValues[2]], [highValues[3],highValues[4],highValues[5]], [highValues[6],highValues[7],highValues[8]]);
        
        const vectorMessage = {
          type: 'vector',
          data: vectors
        };

        socket.send(JSON.stringify(vectorMessage));
        console.log('Sent vectors:', vectors);
      } catch (err) {
        console.warn(`Skipping malformed vector data at line ${lineIndex}: ${err.message}`);
      }
      
      lineIndex++; 
    } 
    else {
      lineIndex = 0;
      console.log('Restarting from beginning of files');
    }
  }
  catch (error) {
    console.error('Error reading spherical data:',error);
  }
}

async function sendVibrationData(socket) {
  try {
    const[vibData, vibFpgaData] = await Promise.all([readNewLinesStream(vibrationPath, 0), readNewLinesStream(vibrationPathFPGA, 0)]);

    if (lineIndex < vibData.lines.length && lineIndex<vibFpgaData.lines.length) {

      try {
        const vibValues = vibData.lines[lineIndex].split(/\s+/).map(parseFloat);
        const vibFPGAValues = vibFpgaData.lines[lineIndex].split(/\s+/).map(parseFloat);

        if (isNaN(vibValues[0]) || isNaN(vibFPGAValues[0])) throw new Error('NaN detected in vibration data');

        const vibrationData = [vibValues[0], vibFPGAValues[0]];

        const vibMessage = {
          type: 'waveform',
          data: vibrationData,
        }

        socket.send(JSON.stringify(vibMessage));
        console.log('Sent vibration data', vibrationData);
      } catch (err) {
        console.warn(`Skipping malformed vibration data at line ${lineIndex}: ${err.message}`);
      }
      
      lineIndex++;
    }
    else {
      lineIndex = 0;
      console.log('Restarting vibration data from the beginning.');
    }
  }
  catch (error) {
    console.error('Error reading vibration data', error);
  }
}

async function sendCommunicationData(socket) {
  try {
    const[lowData, medData, highData] = await Promise.all([
      readNewLinesStream(communicationPathLow, 0),
      readNewLinesStream(communicationPathMed, 0),
      readNewLinesStream(communicationPathHigh, 0),
    ]);

    if (lineIndex < lowData.lines.length && lineIndex < medData.lines.length && lineIndex < highData.lines.length) {
      
      try {
        const commData = [];

        const lowValues = lowData.lines[lineIndex].split(/\s+/).map(parseFloat);
        const medValues = medData.lines[lineIndex].split(/\s+/).map(parseFloat);
        const highValues = highData.lines[lineIndex].split(/\s+/).map(parseFloat);

        if (lowValues.some(isNaN) || medValues.some(isNaN) || highValues.some(isNaN)) {
            throw new Error('NaN detected in communication data');
        }

        commData.push([lowValues[0], lowValues[1]]);
        commData.push([medValues[0], medValues[1]]);
        commData.push([highValues[0], highValues[1]]);

        const commMessage = {
          type: 'communication',
          data: commData,
        }

        socket.send(JSON.stringify(commMessage));
        console.log('Sent communication data:', commData);
      } catch (err) {
        console.warn(`Skipping malformed communication data at line ${lineIndex}: ${err.message}`);
      }

      lineIndex++;
    }
    else {
      lineIndex = 0;
      console.log('Restarting communication data to be read from start of file.');
    }
  }
  catch (error) {
    console.error('Error reading communication data:', error);
  }
}

const socket = new WebSocket(`ws://127.0.0.1:8181?role=sender&token=${key}`);

socket.addEventListener('open', event => {
  console.log('WebSocket connection established!');

  const interval = setInterval(async () => {

    if (socket.readyState !== WebSocket.OPEN) {
      console.log('Connection lost.');
      clearInterval(interval);
      return;
    }

    await sendSphericalData(socket);
    await sendVibrationData(socket);
    await sendCommunicationData(socket);

  }, 16);
});

socket.addEventListener('close', event => {
  console.log('WebSocket connection closed:', event.code, event.reason);
});

socket.addEventListener('error', error => {
  console.error('WebSocket error:', error);
});