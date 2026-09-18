import { useState, useRef, useEffect, useCallback } from 'react';
import { REQUIRED_FILES } from '../dataFiles';
import { createTelemetryFrame } from '../telemetryProtocol';

export { REQUIRED_FILES } from '../dataFiles';
export const TELEMETRY_HIGH_WATER_BYTES = 512 * 1024;

export function useDataBroadcaster(socketRef, onLocalData, socketEpoch = 0, sessionReady = true, liveStatus = null) {
  const [broadcastMode, setBroadcastMode] = useState('debug'); // 'debug' or 'live'
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [liveDir, setLiveDir] = useState('./src/data');
  const [statusMessage, setStatusMessage] = useState('Ready to broadcast');

  const stepRef = useRef(0);
  const intervalRef = useRef(null);
  const liveSocketRef = useRef(null);
  const sessionReadyRef = useRef(sessionReady);

  useEffect(() => {
    sessionReadyRef.current = sessionReady;
  }, [sessionReady]);

  useEffect(() => {
    if (!liveStatus || broadcastMode !== 'live') return;
    if (liveStatus.status === 'Error') {
      setStatusMessage(typeof liveStatus.detail === 'string' ? liveStatus.detail : 'Live ingest failed');
      setIsStarting(false);
      setIsBroadcasting(false);
      liveSocketRef.current = null;
    } else if (liveStatus.status === 'Running') { setIsStarting(false); setIsBroadcasting(true); setStatusMessage(`Streaming Live Files from ${liveDir}`); }
    else if (liveStatus.status === 'Paused') setStatusMessage('Live ingest paused while reconnecting');
    else if (liveStatus.status === 'Stopped') { setIsStarting(false); setIsBroadcasting(false); setStatusMessage('Live ingest stopped'); liveSocketRef.current = null; }
  }, [broadcastMode, liveDir, liveStatus]);

  const sendLiveStart = useCallback(() => {
    const socket = socketRef?.current;
    if (sessionReady && socket && socket.readyState === 1 && socket !== liveSocketRef.current) {
      try { socket.send(JSON.stringify({ type: 'start-live-ingest', dir: liveDir })); liveSocketRef.current = socket; } catch { /* reconnect will retry */ }
    }
  }, [liveDir, sessionReady, socketRef]);

  useEffect(() => {
    if (broadcastMode === 'live' && (isBroadcasting || isStarting) && sessionReady) sendLiveStart();
  }, [broadcastMode, isBroadcasting, isStarting, sendLiveStart, sessionReady, socketEpoch]);

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
        if (broadcastMode === 'live') {
      setIsStarting(true);
      setStatusMessage(`Starting live ingest from ${liveDir}`);
      sendLiveStart();
    } else {
      setIsStarting(false);
      setIsBroadcasting(true);
      setStatusMessage('Broadcasting Synthetic Data (60 FPS)');
      stepRef.current = 0;
      if (intervalRef.current) clearInterval(intervalRef.current);

      intervalRef.current = setInterval(() => {
        stepRef.current += 1;
        const step = stepRef.current;
        const payloads = generateDebugPayloads(step);
        const frame = createTelemetryFrame({ frameId: step - 1, waveform: payloads.waveformData, vector: payloads.vectorData, communication: payloads.commData });

        if (onLocalData) {
          onLocalData(frame);
        }

        const socket = socketRef?.current;
        if (sessionReadyRef.current && socket && socket.readyState === 1 && socket.bufferedAmount <= TELEMETRY_HIGH_WATER_BYTES) {
          try { socket.send(JSON.stringify(frame)); } catch { /* reconnect will resume */ }
        }
      }, 16);
    }
  }, [broadcastMode, liveDir, onLocalData, sendLiveStart, socketRef]);

  const stopBroadcasting = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const socket = socketRef?.current;
    if (socket && socket.readyState === 1) {
      try { socket.send(JSON.stringify({ type: 'stop-live-ingest' })); } catch { /* socket is reconnecting */ }
    }

    setIsStarting(false);
    setIsBroadcasting(false);
    liveSocketRef.current = null;
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
    isStarting,
    startBroadcasting,
    stopBroadcasting,
    liveDir,
    setLiveDir,
    statusMessage
  };
}
