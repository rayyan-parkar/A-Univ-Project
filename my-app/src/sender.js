import { WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config()

const key = process.env.VITE_SENDER_KEY;

// Creates a new WebSocket connection to the specified URL.
const socket = new WebSocket(`ws://localhost:8080?role=sender&token=${key}`);
const data = ['Hello', 'World', 'This', 'Is', 'A', 'Test']
let currentIndex = 0;

// Executes when the connection is successfully established.
// Sends data every 16 ms to the server.
socket.addEventListener('open', event => {
  console.log('WebSocket connection established!');
  
  const interval = setInterval(()=> {
      if (currentIndex<data.length) {
        socket.send(data[currentIndex]);
        console.log(`Sent: ${data[currentIndex]}`)
        currentIndex++
      }

      else {
        clearInterval(interval);
        console.log("All Data Succesfully Sent, closing connection.")
        socket.close();
      }
    }, 16);

  });

// Executes when the connection is closed, providing the close code and reason.
socket.addEventListener('close', event => {
  console.log('WebSocket connection closed:', event.code, event.reason);
});

// Executes if an error occurs during the WebSocket communication.
socket.addEventListener('error', error => {
  console.error('WebSocket error:', error);
});