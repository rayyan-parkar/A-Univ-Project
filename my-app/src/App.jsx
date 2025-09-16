import { useState, useEffect, useRef } from 'react';
import VibrationSensor from './VibrationSensor';
import SphericalGraph from './SphericalGraph';
import CommunicationData from './CommunicationData'
import logo from '/logo.png';
import rightLogo from '/right-logo.jpg';
import videoUnavailable from '/video-unavailable.jpg';
import './App.css';

function App() {

  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [vibrationValue, setVibrationValue] = useState(null);
  const [vectorData1, setVectorData1] = useState([]);
  const [vectorData2, setVectorData2] = useState([]);
  const [vectorData3, setVectorData3] = useState([]);
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
    const colors = ['#ff4500', '#009908', '#8a2be2'];
    
    // Graph 1: First 3 vectors (indices 0, 1, 2)
    const graph1Vectors = [];
    for (let i = 0; i < 3; i++) {
        graph1Vectors.push({
            x: parsedMessage.data[i][0],
            y: parsedMessage.data[i][1],
            z: parsedMessage.data[i][2],
            color: colors[i]
        });
    }
    
    // Graph 2: Second 3 vectors (indices 3, 4, 5)
    const graph2Vectors = [];
    for (let i = 3; i < 6; i++) {
        graph2Vectors.push({
            x: parsedMessage.data[i][0],
            y: parsedMessage.data[i][1],
            z: parsedMessage.data[i][2],
            color: colors[i - 3] // Reset color index
        });
    }
    
    // Graph 3: Last 3 vectors (indices 6, 7, 8)
    const graph3Vectors = [];
    for (let i = 6; i < 9; i++) {
        graph3Vectors.push({
            x: parsedMessage.data[i][0],
            y: parsedMessage.data[i][1],
            z: parsedMessage.data[i][2],
            color: colors[i - 6] // Reset color index
        });
    }
    
    setVectorData1(graph1Vectors);   // Vectors 0, 1, 2
    setVectorData2(graph2Vectors);   // Vectors 3, 4, 5
    setVectorData3(graph3Vectors);   // Vectors 6, 7, 8
    } 

        else if (parsedMessage.type== 'communication') {
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
      <div className="top-container">
        <div className="logo">
          <img src={logo} alt="UNAVAILABLE" />
        </div>

        <h1>Fixed Precision Impact on  State-of-Polarization Sensing using Coherent Transceivers</h1>

        <div className="logo">
          <img src={rightLogo} alt="UNAVAILABLE" />
        </div>
      </div>
      
      <div className="body-container">
        <h2>
          Aston Institute of Photonics Technologies Aston University, 
          Birmingham, UK Geraldo Gomes, Rafael Vieira, Pedro Freire, 
          Yaroslav Prylepskiy, Sergei Turitsyn
        </h2>

        <div className={`connection-status ${getStatusClass()}`}>
          Connection Status: {connectionStatus}
          {countdown > 0 && ` (${countdown}s...)`}
        </div>

        <div className="grid-container">
          <div className="top">
          <div className="video-container">
            <img src={videoUnavailable} alt="ERROR"/>
          </div>
          <div className="spherical-container">
            <SphericalGraph vectorData={vectorData1} enableCameraControls={false} enableRotation={true}/>
            <SphericalGraph vectorData={vectorData2} enableCameraControls={false} enableRotation={true}/>
            <SphericalGraph vectorData={vectorData3} enableCameraControls={false} enableRotation={true}/>
          </div>
          </div>
          <div className="bottom">

          <div className="vibration-container">
            <VibrationSensor latestData={vibrationValue}/>
            <VibrationSensor latestData={vibrationValue}/>
          </div>
          <div>
          <h2>Communication Data</h2>
          <div className="comms-container">
            <CommunicationData latestData={communicationData}/>
            <CommunicationData latestData={communicationData}/>
            <CommunicationData latestData={communicationData}/>
          </div>
          </div>
          </div>
        </div>
        
      </div>
    </div>
  )
}

export default App
