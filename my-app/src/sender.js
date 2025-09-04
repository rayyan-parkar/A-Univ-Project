import { WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config()

const key = process.env.VITE_SENDER_KEY;

// Creates a new WebSocket connection
const socket = new WebSocket(`wss://ws.rayyanparkar.com?role=sender&token=${key}`);
//const socket = new WebSocket(`ws://localhost:8080?role=sender&token=${key}`);

function createWaveformData() {
  const data = [];
  
  for (let i = 0; i<500; i++) {
    const baseWave = Math.sin(i*0.3)*2;
    const noise = (Math.random()-0.5)*0.5;
    const highFrequency = Math.sin(i*1.5)*0.3;

    const waveValue = baseWave + noise + highFrequency;
    data.push(waveValue.toFixed(2));
  }
  
  return data;
}

function createVectorData() {

  const data = [];

  for (let i = 0; i<500; i++) {
    const time = i*0.1;
    const vectors = [ //Creating three vectors
      {
        x: Math.cos(time * 0.8) * (0.6 + Math.sin(time * 0.3) * 0.3), 
        y: Math.sin(time * 1.2) * (0.7 + Math.cos(time * 0.5) * 0.2), 
        z: Math.sin(time * 0.9) * (0.5 + Math.sin(time * 0.7) * 0.4), 
        color: '#ff4500',
      },

      {
        x: Math.sin(time * 1.3) * (0.4 + Math.cos(time * 0.4) * 0.4), 
        y: Math.cos(time * 0.9) * (0.8 + Math.sin(time * 0.6) * 0.3), 
        z: Math.cos(time * 1.5) * (0.3 + Math.cos(time * 0.8) * 0.5), 
        color: '#00ff00'
      },

      {
        x: Math.cos(time * 1.7) * (0.5 + Math.sin(time * 0.9) * 0.4), 
        y: Math.sin(time * 0.6) * (0.6 + Math.cos(time * 1.1) * 0.4), 
        z: Math.sin(time * 2.1) * (0.4 + Math.sin(time * 0.5) * 0.3),
        color: '#8a2be2'
      }
    ]; 
    data.push(vectors);

  }

  return data;
}

function createCommunicationData() {
  const data = [];
  
  for (let i = 0; i < 500; i++) {
    const time = i * 0.02;
    
    // Create multiple patterns that cover the full range
    const patterns = [
      // Circular pattern
      {
        x: Math.cos(time * 3) * (0.8 + Math.sin(time * 0.5) * 0.6),
        y: Math.sin(time * 3) * (0.8 + Math.cos(time * 0.7) * 0.6)
      },
      // Figure-8 pattern
      {
        x: Math.sin(time * 2) * 1.2,
        y: Math.sin(time * 4) * 1.0
      },
      // Diagonal sweep
      {
        x: Math.sin(time * 1.5) * 1.3,
        y: Math.cos(time * 2.5) * 1.2
      },
      // Random scatter in quadrants
      {
        x: (Math.random() - 0.5) * 2.8, // Full -1.4 to 1.4 range
        y: (Math.random() - 0.5) * 2.8
      }
    ];
    
    // Pick a random pattern or combine them
    const patternIndex = Math.floor(Math.random() * patterns.length);
    const point = patterns[patternIndex];
    
    // Clamp to ensure we stay within bounds
    point.x = Math.max(-1.4, Math.min(1.4, point.x));
    point.y = Math.max(-1.4, Math.min(1.4, point.y));
    
    data.push([point]);
  }
  
  return data;
}

const waveformData = createWaveformData();
const vectorData = createVectorData();
const communicationData = createCommunicationData();

let waveformIndex = 0
let vectorIndex = 0;
let communicationIndex = 0;
let currentType = 0; // 0 = waveform, 1 = vector, 2 = communication

// Executes when the connection is successfully established.
// Sends data every 16 ms to the server.
socket.addEventListener('open', event => {
  console.log('WebSocket connection established!');

  const interval = setInterval(()=> {

  if (socket.readyState!==WebSocket.OPEN) {
    console.log('Connection lost.');
    clearInterval(interval);
    return;
  }

  if (waveformIndex < waveformData.length || vectorIndex < vectorData.length || communicationIndex<communicationData.length) {
      
      if (currentType === 0 && waveformIndex < waveformData.length) {
      const waveformMessage = {
        type: 'waveform',
        data: waveformData[waveformIndex],
      };
      
      socket.send(JSON.stringify(waveformMessage));
      console.log(`Sent waveform: ${waveformData[waveformIndex]}`);
      waveformIndex++;
    }

    else if (currentType === 1 && vectorIndex < vectorData.length) {
      const vectorMessage = {
        type: 'vector',
        data: vectorData[vectorIndex],
      };
      
      socket.send(JSON.stringify(vectorMessage));
      console.log(`Sent vector: ${JSON.stringify(vectorData[vectorIndex])}`);
      vectorIndex++;
    }

    else if (currentType === 2 && communicationIndex < communicationData.length) {
      const communicationMessage = {
        type: 'communication',
        data: communicationData[communicationIndex],
      };
      
      socket.send(JSON.stringify(communicationMessage));
      console.log(`Sent communication: ${JSON.stringify(communicationData[communicationIndex])}`);
      communicationIndex++;
    }

      // Toggle for next iteration (alternate between waveform and vector and communication)
      currentType= (currentType+1)%3;
      
    } 
    
    else {
      // All data sent, close connection
      clearInterval(interval);
      console.log("All Data Successfully Sent, closing connection.");
      socket.close();
    }

  }, 0);
});

// Executes when the connection is closed, providing the close code and reason.
socket.addEventListener('close', event => {
  console.log('WebSocket connection closed:', event.code, event.reason);
});

// Executes if an error occurs during the WebSocket communication.
socket.addEventListener('error', error => {
  console.error('WebSocket error:', error);
});