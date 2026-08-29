import { useState, useEffect, useRef } from 'react';

export function useExperimentSession() {
    const [connectionStatus, setConnectionStatus] = useState('Connecting...');
    const [sessionState, setSessionState] = useState('CONNECTING'); // CONNECTING, CONFIGURING, AUTH_REQUIRED, ACTIVE
    const [role, setRole] = useState(null); // 'host', 'waiting', 'viewer'
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [senderConnected, setSenderConnected] = useState(false);

    // Graph Data States
    const [vibrationValue, setVibrationValue] = useState(null);
    const [vibrationFPGA, setVibrationFPGA] = useState(null);
    const [vectorData1, setVectorData1] = useState([]);
    const [vectorData2, setVectorData2] = useState([]);
    const [vectorData3, setVectorData3] = useState([]);
    const [communicationData, setCommunicationData] = useState([]);

    const socketRef = useRef(null);

    useEffect(() => {
        const connectWebSocket = () => {
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const defaultWsUrl = isLocal
                ? 'ws://127.0.0.1:8181'
                : `wss://${window.location.hostname}:8181`;

            const wsUrl = import.meta.env.VITE_WS_URL || defaultWsUrl;
            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                setConnectionStatus('Connected to Server');
            };

            socket.onmessage = (event) => {
                let parsed;
                try {
                    parsed = JSON.parse(event.data);
                } catch (e) { return; }

                if (parsed.type === 'waveform' || parsed.type === 'vector') {
                    console.log(`[Frontend] Received ${parsed.type} data:`, parsed.data);
                }

                if (parsed.type === 'server-state') {
                    setSessionState(parsed.state);
                    setRole(parsed.role);
                    if (parsed.role === 'viewer-auth-required') {
                        setSessionState('AUTH_REQUIRED');
                    }
                }
                else if (parsed.type === 'config-success') {
                    setGeneratedPassword(parsed.password);
                    setSessionState('ACTIVE');
                }
                else if (parsed.type === 'auth-success') {
                    setSessionState('ACTIVE');
                    setRole('viewer');
                }
                else if (parsed.type === 'auth-fail') {
                    setAuthError(parsed.message);
                }
                else if (parsed.type === 'sender-status') {
                    setSenderConnected(parsed.connected);
                }
                else if (parsed.type === 'server-reset') {
                    alert('Session was reset by server (Host disconnected).');
                    window.location.reload();
                }

                // Data Parsers
                else if (parsed.type === 'waveform') {
                    if (Array.isArray(parsed.data) && parsed.data.length >= 2) {
                        setVibrationValue(parseFloat(parsed.data[0]));
                        setVibrationFPGA(parseFloat(parsed.data[1]));
                    }
                }
                else if (parsed.type === 'vector') {
                    if (Array.isArray(parsed.data) && parsed.data.length >= 9) {
                        const colors = ['#ff4500', '#009908', '#8a2be2'];
                        const createGraphData = (startIdx) => {
                            const vectors = [];
                            for (let i = startIdx; i < startIdx + 3; i++) {
                                if (parsed.data[i]) {
                                    vectors.push({
                                        x: parsed.data[i][0],
                                        y: parsed.data[i][1],
                                        z: parsed.data[i][2],
                                        color: colors[i - startIdx]
                                    });
                                }
                            }
                            return vectors;
                        };
                        setVectorData1(createGraphData(0));
                        setVectorData2(createGraphData(3));
                        setVectorData3(createGraphData(6));
                    }
                }
                else if (parsed.type === 'communication') {
                    setCommunicationData(parsed.data);
                }
            };

            socket.onerror = () => {
                setConnectionStatus('Error connecting to server.');
            };

            socket.onclose = () => {
                setConnectionStatus('Disconnected');
                setSessionState('DISCONNECTED');
            };
        };

        connectWebSocket();

        return () => {
            if (socketRef.current) socketRef.current.close();
        };
    }, []);

    const updateGraphData = (payloads) => {
        if (!payloads) return;
        if (payloads.waveformData && payloads.waveformData.length >= 2) {
            setVibrationValue(parseFloat(payloads.waveformData[0]));
            setVibrationFPGA(parseFloat(payloads.waveformData[1]));
        }
        if (payloads.vectorData && payloads.vectorData.length >= 9) {
            const colors = ['#ff4500', '#009908', '#8a2be2'];
            const createGraphData = (startIdx) => {
                const vectors = [];
                for (let i = startIdx; i < startIdx + 3; i++) {
                    if (payloads.vectorData[i]) {
                        vectors.push({
                            x: payloads.vectorData[i][0],
                            y: payloads.vectorData[i][1],
                            z: payloads.vectorData[i][2],
                            color: colors[i - startIdx]
                        });
                    }
                }
                return vectors;
            };
            setVectorData1(createGraphData(0));
            setVectorData2(createGraphData(3));
            setVectorData3(createGraphData(6));
        }
        if (payloads.commData) {
            setCommunicationData(payloads.commData);
        }
    };

    const configureSession = (maxClients, password, whitelist) => {
        if (socketRef.current) {
            socketRef.current.send(JSON.stringify({
                type: 'configure',
                maxClients,
                password,
                whitelist
            }));
        }
    };

    const authenticate = (password) => {
        setAuthError('');
        if (socketRef.current) {
            socketRef.current.send(JSON.stringify({
                type: 'auth',
                password
            }));
        }
    };

    return {
        socketRef,
        connectionStatus,
        sessionState,
        role,
        generatedPassword,
        authError,
        configureSession,
        authenticate,
        updateGraphData,
        graphData: {
            vibrationValue,
            vibrationFPGA,
            vectorData1,
            vectorData2,
            vectorData3,
            communicationData
        }
    };
}
