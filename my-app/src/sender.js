import { WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config()

const key = process.env.VITE_SENDER_KEY;

// Creates a new WebSocket connection
const socket = new WebSocket(`wss://ws.rayyanparkar.com?role=sender&token=${key}`);

function createWaveformData() {
  const data = [];
  for (let j =0; j<25; j++) {
    data.push(0);
  }
  for (let i = 0; i<100; i++) {
    const baseWave = Math.sin(i*0.3)*2;
    const noise = (Math.random()-0.5)*0.5;
    const highFrequency = Math.sin(i*1.5)*0.3;

    const waveValue = baseWave + noise + highFrequency;
    data.push(waveValue.toFixed(2));
  }

  for (let k =0; k<25; k++) {
    data.push(0);
  }
  return data;
}
const data = createWaveformData();

let currentIndex = 0;

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
      if (currentIndex<data.length) {
        socket.send(data[currentIndex]);
        console.log(`Sent: ${data[currentIndex]}`);
        currentIndex++;
      }

      else {
        clearInterval(interval);
        console.log("All Data Succesfully Sent, closing connection.");
        socket.close();
      }
    }, 16);

  });

// Executes when the connection is closed, providing the close code and reason.
socket.addEventListener('close', event => {
  console.log('WebSocket connection closed:', event.code, event.reason);

  if (currentIndex < data.length) {
    console.log('Connection closed early.');
  }
});

// Executes if an error occurs during the WebSocket communication.
socket.addEventListener('error', error => {
  console.error('WebSocket error:', error);
});