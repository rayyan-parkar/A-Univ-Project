import { useState, useEffect } from 'react'
import './App.css'

function App() {

  const[serverMessage, setServerMessage] = useState('');

  useEffect(()=> {
    //Connect to server using websocket
    const socket = new WebSocket('ws://localhost:8080');

    socket.onmessage = (event)=> {
      setServerMessage(event.data);
    }

    return() => socket.close();
    
  }, []);
  return (
    <div>
      <h1>Server says: {serverMessage}</h1>
    </div>
  )
}

export default App
