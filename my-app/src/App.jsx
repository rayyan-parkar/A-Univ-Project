import { useState, useEffect } from 'react'
import './App.css'

function App() {

  const[serverMessage, setServerMessage] = useState('');

  useEffect(()=> {
    const key = import.meta.env.VITE_RECEIVER_KEY;

    //Connect to server using websocket
    const socket = new WebSocket(`ws://localhost:8080?role=receiver&token=${key}`);

    socket.onmessage = (event)=> {
      setServerMessage(event.data);
    }

    return() => {
      if (socket.readyState===WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      }

      else if (socket.readyState ===WebSocket.OPEN) {
        socket.close()
      }
    };
  }, []);
  
  return (
    <div>
      <h1>Server says: {serverMessage}</h1>
    </div>
  )
}

export default App
