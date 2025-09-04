import { useState, useEffect, useRef } from 'react';
import VibrationSensor from './VibrationSensor';
import SphericalGraph from './SphericalGraph';
import CommunicationData from './CommunicationData'
import './App.css';

function App() {

  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [vibrationValue, setVibrationValue] = useState(null);
  const [vectorData, setVectorData] = useState([]);
  const [countdown, setCountdown] = useState(0);
  const reconnectTimeoutRef = useRef(null);
  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const countdownIntervalRef = useRef(null);
  const [communicationData, setCommunicationData] = useState([]);

  // const playerRef = useRef(null); Will be added back when livestream support is added

  useEffect(()=> {
  const connectWebSocket = () => {
    const key = import.meta.env.VITE_RECEIVER_KEY;
    //const socket = new WebSocket(`ws://localhost:8080?role=receiver&token=${key}`);
    const socket = new WebSocket(`wss://ws.rayyanparkar.com?role=receiver&token=${key}`);
    socketRef.current = socket;

    socket.onopen = ()=> {
      setConnectionStatus('🟢 Connected!');
      console.log('Websocket Connected!');
      reconnectAttemptsRef.current = 0; // Reset attempts on successful connection
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }

    socket.onmessage = (event)=> {
      const message = event.data;
      
      try {
        const parsedMessage = JSON.parse(message);

        if (parsedMessage.type === 'waveform') {
          const parsedValue = parseFloat(parsedMessage.data);
          if (!isNaN(parsedValue)) {
            setVibrationValue(parsedValue);
          }
        }
        else if (parsedMessage.type === 'vector') {
          setVectorData(parsedMessage.data);
        }

        else if (parsedMessage.type== 'communication') {
          console.log(parsedMessage.data);
          setCommunicationData(parsedMessage.data);
        }
      }
      catch (error) {
        console.warn('Failed to parse message as JSON, skipping:', message);
      }
    };

    socket.onerror = (error)=> {
      console.log('Websocket Error:', error);
      setConnectionStatus('🟡 Error!');
    }

    socket.onclose = (event)=> {
  console.log('Websocket closed:', event.code, event.reason);
  
  if (event.code === 1013 || event.reason === 'Server capacity exceeded') {
    setConnectionStatus('🟡 Max receivers already connected, cannot connect.');
    console.log('Connection rejected: Max receivers reached.');
    return; // Don't attempt to reconnect
  }

  if (reconnectAttemptsRef.current < 3) {
    reconnectAttemptsRef.current++;
    
    // Start countdown from 5 seconds
    setCountdown(5);
    setConnectionStatus(`🔴 Disconnected! (Attempt ${reconnectAttemptsRef.current}/3)`);
    
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    // Update countdown every second
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      console.log(`Reconnection attempt ${reconnectAttemptsRef.current}/3...`);
      setCountdown(0);
      connectWebSocket();
    }, 5000);
  } else {
    setConnectionStatus('🔴 Connection Failed! Max attempts reached.');
    console.log('Max reconnection attempts reached. Stopping.');
  }
  }
}

  connectWebSocket();

  return() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (socketRef.current) {
      socketRef.current.close();
    }

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
    }
  };
}, []);

  /*useEffect(()=> {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/nodeplayer.js@latest/dist/nodeplayer.min.js';
    script.onload = () => {
      const player = new window.NodePlayer();
      player.setView('webrtc-player');
      player.start('wss://rtmc')
    }
  });*/


  const getStatusClass = () => {
  if (connectionStatus.includes('🟢')) return 'status-connected';
  if (connectionStatus.includes('🟡')) return 'status-error';
  return 'status-disconnected';
  };

  return (
    <div className="app-container">
      <div className="app-header">
        <h1 className="app-title">Real-Time Data Visualization</h1>
        <div className={`connection-status ${getStatusClass()}`}>
          Connection Status: {connectionStatus}
          {countdown > 0 && ` (${countdown}s...)`}
        </div>
      </div>

      <div className="graphs-container">
        <div className="graph-wrapper">
          <h3 className="graph-title">Vibration Analysis</h3>
          <VibrationSensor latestData={vibrationValue} />
        </div>

        <div className="graph-wrapper">
          <h3 className="graph-title">Vector Analysis</h3>
          <SphericalGraph
            vectorData={vectorData}
            title=""
            enableRotation={true}
            enableCameraControls={false}
          />
        </div>

        <div className="graph-wrapper">
        <h3 className="graph-title">Communication Data</h3>
        <CommunicationData latestData={communicationData} />
      </div>

      </div>
    </div>
  )
}

export default App
