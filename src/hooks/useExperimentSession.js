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
            // Use explicit IPv4 loopback to avoid IPv6 resolution issues on NixOS
            const socket = new WebSocket(`ws://127.0.0.1:8181`);
            socketRef.current = socket;

            socket.onopen = () => {
                setConnectionStatus('Connected to Server');
            };

            socket.onmessage = (event) => {
                let parsed;
                try {
                    parsed = JSON.parse(event.data);
                } catch(e) { return; }

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
                    if (parsed.data.length === 2) {
                        setVibrationValue(parseFloat(parsed.data[0]));
                        setVibrationFPGA(parseFloat(parsed.data[1]));
                    }
                }
                else if (parsed.type === 'vector') {
                    const colors = ['#ff4500', '#009908', '#8a2be2'];
                    const createGraphData = (startIdx) => {
                        const vectors = [];
                        for (let i = startIdx; i < startIdx + 3; i++) {
                            vectors.push({
                                x: parsed.data[i][0],
                                y: parsed.data[i][1],
                                z: parsed.data[i][2],
                                color: colors[i - startIdx]
                            });
                        }
                        return vectors;
                    };
                    setVectorData1(createGraphData(0));
                    setVectorData2(createGraphData(3));
                    setVectorData3(createGraphData(6));
                }
                else if (parsed.type === 'communication') {
                    setCommunicationData(parsed.data);
                }
            };

            socket.onerror = (error) => {
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
        senderConnected,
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
