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
  const [fileMap, setFileMap] = useState({});
  const [statusMessage, setStatusMessage] = useState('Ready to broadcast');

  const stepRef = useRef(0);
  const intervalRef = useRef(null);
  const fileLinesRef = useRef({});
  const lineIndicesRef = useRef({ spherical: 0, vibration: 0, communication: 0 });

  // Compute matched and missing files
  const matchedFiles = REQUIRED_FILES.filter(name => Boolean(fileMap[name]));
  const missingFiles = REQUIRED_FILES.filter(name => !fileMap[name]);
  const isAllFilesMatched = matchedFiles.length === REQUIRED_FILES.length;

  // Handle file / folder selection
  const handleFilesSelected = async (fileList) => {
    const newMap = {};
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (REQUIRED_FILES.includes(file.name)) {
        newMap[file.name] = file;
      }
    }
    setFileMap(newMap);

    // Read and parse lines into memory cache
    const parsedLines = {};
    for (const [name, file] of Object.entries(newMap)) {
      try {
        const text = await file.text();
        parsedLines[name] = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      } catch (err) {
        console.error(`Error reading ${name}:`, err);
        parsedLines[name] = [];
      }
    }
    fileLinesRef.current = parsedLines;
    lineIndicesRef.current = { spherical: 0, vibration: 0, communication: 0 };
  };

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

  // Live File Ingest Generator
  const generateLivePayloads = () => {
    const lines = fileLinesRef.current;
    const indices = lineIndicesRef.current;

    // Helper to safely parse floats
    const parseFloats = (line) => {
      if (!line) return [];
      return line.split(/\s+/).map(parseFloat).filter(v => !isNaN(v));
    };

    // 1. Vibration
    let waveformData = null;
    const vibLines = lines['VibrationData.txt'] || [];
    const fpgaLines = lines['VibrationData_FPGA.txt'] || [];
    const vibLen = Math.min(vibLines.length, fpgaLines.length);
    if (vibLen > 0) {
      if (indices.vibration >= vibLen) indices.vibration = 0;
      const v = parseFloats(vibLines[indices.vibration]);
      const f = parseFloats(fpgaLines[indices.vibration]);
      if (v.length > 0 && f.length > 0) {
        waveformData = [v[0], f[0]];
      }
      indices.vibration++;
    }

    // 2. Spherical SOP
    let vectorData = null;
    const sLow = lines['SphericalData_low.txt'] || [];
    const sMed = lines['SphericalData_medium.txt'] || [];
    const sHigh = lines['SphericalData_high.txt'] || [];
    const sLen = Math.min(sLow.length, sMed.length, sHigh.length);
    if (sLen > 0) {
      if (indices.spherical >= sLen) indices.spherical = 0;
      const l = parseFloats(sLow[indices.spherical]);
      const m = parseFloats(sMed[indices.spherical]);
      const h = parseFloats(sHigh[indices.spherical]);
      if (l.length >= 9 && m.length >= 9 && h.length >= 9) {
        vectorData = [
          [l[0], l[1], l[2]], [l[3], l[4], l[5]], [l[6], l[7], l[8]],
          [m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]],
          [h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]],
        ];
      }
      indices.spherical++;
    }

    // 3. Communication
    let commData = null;
    const cLow = lines['CommunicationData_low.txt'] || [];
    const cMed = lines['CommunicationData_medium.txt'] || [];
    const cHigh = lines['CommunicationData_high.txt'] || [];
    const cLen = Math.min(cLow.length, cMed.length, cHigh.length);
    if (cLen > 0) {
      if (indices.communication >= cLen) indices.communication = 0;
      const l = parseFloats(cLow[indices.communication]);
      const m = parseFloats(cMed[indices.communication]);
      const h = parseFloats(cHigh[indices.communication]);
      if (l.length >= 2 && m.length >= 2 && h.length >= 2) {
        commData = [
          [l[0], l[1]],
          [m[0], m[1]],
          [h[0], h[1]],
        ];
      }
      indices.communication++;
    }

    return { waveformData, vectorData, commData };
  };

  const startBroadcasting = useCallback(() => {
    if (broadcastMode === 'live' && !isAllFilesMatched) {
      alert(`Please select all 8 required experiment files. Missing: ${missingFiles.join(', ')}`);
      return;
    }

    setIsBroadcasting(true);
    setStatusMessage(broadcastMode === 'debug' ? 'Broadcasting Synthetic Data (60 FPS)' : 'Streaming Live Files');

    stepRef.current = 0;
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      stepRef.current += 1;
      const step = stepRef.current;

      const payloads = broadcastMode === 'debug'
        ? generateDebugPayloads(step)
        : generateLivePayloads();

      const socket = socketRef?.current;
      const isSocketOpen = socket && socket.readyState === 1;

      // Update local state directly on Host
      if (onLocalData) {
        onLocalData(payloads);
      }

      // Transmit to Server (which relays to all Viewers)
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
  }, [broadcastMode, isAllFilesMatched, missingFiles, onLocalData, socketRef]);

  const stopBroadcasting = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsBroadcasting(false);
    setStatusMessage('Broadcast stopped');
  }, []);

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
    handleFilesSelected,
    matchedFiles,
    missingFiles,
    isAllFilesMatched,
    statusMessage
  };
}
