import { useState, useRef, useEffect, useCallback } from 'react';

export const REQUIRED_FILES = [
  'VibrationData.txt',
  'VibrationData_FPGA.txt',
  'SphericalData_low.txt',
  'SphericalData_medium.txt',
  'SphericalData_high.txt',
  'CommunicationData_low.txt',
  'CommunicationData_medium.txt',
  'CommunicationData_high.txt'
];

export function useDataBroadcaster(socketRef, onLocalData) {
  const [broadcastMode, setBroadcastMode] = useState('debug'); // 'debug' or 'live'
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [liveDir, setLiveDir] = useState('./test_experiment_data');
  const [statusMessage, setStatusMessage] = useState('Ready to broadcast');

  const stepRef = useRef(0);
  const intervalRef = useRef(null);

  // Synthetic Debug Generator (In-Memory, 0 disk space)
  const generateDebugPayloads = (t) => {
    // 1. Vibration Waveform
    const vibration = Math.sin(t * 0.05);
    const vibrationFPGA = Math.round(Math.sin(t * 0.05) * 4) / 4 + (Math.random() - 0.5) * 0.04;
    const waveformData = [parseFloat(vibration.toFixed(3)), parseFloat(vibrationFPGA.toFixed(3))];

    // 2. SOP Vectors (Low, Med, High precision Poincaré sphere)
    const angle = t * 0.03;
    const highVec = [Math.cos(angle), Math.sin(angle), Math.sin(angle * 2) * 0.5];
    const medVec = [
      Math.round(Math.cos(angle) * 8) / 8,
      Math.round(Math.sin(angle) * 8) / 8,
      Math.round(Math.sin(angle * 2) * 4) / 8
    ];
    const lowVec = [
      Math.round(Math.cos(angle) * 3) / 3,
      Math.round(Math.sin(angle) * 3) / 3,
      Math.round(Math.sin(angle * 2) * 2) / 3
    ];

    const formatVec = (v, offset = 0) => [
      parseFloat((v[0] + offset).toFixed(3)),
      parseFloat((v[1] + offset).toFixed(3)),
      parseFloat((v[2] + offset).toFixed(3))
    ];

    const vectorData = [
      formatVec(lowVec, 0), formatVec(lowVec, 0.05), formatVec(lowVec, -0.05),
      formatVec(medVec, 0), formatVec(medVec, 0.03), formatVec(medVec, -0.03),
      formatVec(highVec, 0), formatVec(highVec, 0.01), formatVec(highVec, -0.01),
    ];

    // 3. Communication Constellation Scatter Points (Low, Med, High precision noise)
    const constellationCenters = [[0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];
    const center = constellationCenters[Math.floor(Math.random() * constellationCenters.length)];
    const gaussianNoise = (std) => (Math.random() + Math.random() + Math.random() - 1.5) * std;

    const commData = [
      [parseFloat((center[0] + gaussianNoise(0.25)).toFixed(3)), parseFloat((center[1] + gaussianNoise(0.25)).toFixed(3))],
      [parseFloat((center[0] + gaussianNoise(0.12)).toFixed(3)), parseFloat((center[1] + gaussianNoise(0.12)).toFixed(3))],
      [parseFloat((center[0] + gaussianNoise(0.04)).toFixed(3)), parseFloat((center[1] + gaussianNoise(0.04)).toFixed(3))],
    ];

    return { waveformData, vectorData, commData };
  };

  const startBroadcasting = useCallback(() => {
    const socket = socketRef?.current;
    const isSocketOpen = socket && socket.readyState === 1;

    setIsBroadcasting(true);

    if (broadcastMode === 'live') {
      setStatusMessage(`Streaming Live Files from ${liveDir}`);
      if (isSocketOpen) {
        socket.send(JSON.stringify({
          type: 'start-live-ingest',
          dir: liveDir
        }));
      }
    } else {
      setStatusMessage('Broadcasting Synthetic Data (60 FPS)');
      stepRef.current = 0;
      if (intervalRef.current) clearInterval(intervalRef.current);

      intervalRef.current = setInterval(() => {
        stepRef.current += 1;
        const step = stepRef.current;
        const payloads = generateDebugPayloads(step);

        if (onLocalData) {
          onLocalData(payloads);
        }

        if (isSocketOpen) {
          if (payloads.waveformData) {
            socket.send(JSON.stringify({ type: 'waveform', data: payloads.waveformData }));
          }
          if (payloads.vectorData) {
            socket.send(JSON.stringify({ type: 'vector', data: payloads.vectorData }));
          }
          if (payloads.commData) {
            socket.send(JSON.stringify({ type: 'communication', data: payloads.commData }));
          }
        }
      }, 16);
    }
  }, [broadcastMode, liveDir, onLocalData, socketRef]);

  const stopBroadcasting = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const socket = socketRef?.current;
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'stop-live-ingest' }));
    }

    setIsBroadcasting(false);
    setStatusMessage('Broadcast stopped');
  }, [socketRef]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    broadcastMode,
    setBroadcastMode,
    isBroadcasting,
    startBroadcasting,
    stopBroadcasting,
    liveDir,
    setLiveDir,
    statusMessage
  };
}
