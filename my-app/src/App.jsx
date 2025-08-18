import { useState, useEffect } from 'react';
import VibrationSensor from './VibrationSensor';
import './App.css';

function App() {

  const[serverMessage, setServerMessage] = useState('');
  const [vibrationValue, setVibrationValue] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  useEffect(()=> {
    const key = import.meta.env.VITE_RECEIVER_KEY;

    //Connect to server using websocket
    const socket = new WebSocket(`ws://localhost:8080?role=receiver&token=${key}`);

    socket.onopen = ()=> {
      setConnectionStatus('Connected');
      console.log('Websocket Connected!');
    }

    socket.onmessage = (event)=> {
      const message = event.data;
      
      setServerMessage(message);
      
      const parsedValue = parseFloat(message);
      
      if (!isNaN(parsedValue)) {
          setVibrationValue(parsedValue);
    }
    };

    socket.onerror = (error)=> {
      console.log('Websocket Error:', error);
      setConnectionStatus('Error');
    }

    socket.onclose = (event)=> {
      console.log('Websocket closed:', event.code, event.reason);
      setConnectionStatus('Disconnected');
    }

    //Close socket right after opening it
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
      <VibrationSensor latestData = {vibrationValue}/>
    </div>
  )
}

export default App
