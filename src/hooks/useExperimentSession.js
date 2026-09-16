import { useState, useEffect, useRef, useCallback } from 'react';

export function useExperimentSession() {
    const [connectionStatus, setConnectionStatus] = useState('Connecting...');
    const [sessionState, setSessionState] = useState('CONNECTING'); // CONNECTING, CONFIGURING, AUTH_REQUIRED, ACTIVE
    const [role, setRole] = useState(null); // 'host', 'waiting', 'viewer'
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [authError, setAuthError] = useState('');

    // Graph Data States
    const [vibrationValue, setVibrationValue] = useState(null);
    const [vibrationFPGA, setVibrationFPGA] = useState(null);
    const [vectorData1, setVectorData1] = useState([]);
    const [vectorData2, setVectorData2] = useState([]);
    const [vectorData3, setVectorData3] = useState([]);
    const [communicationData, setCommunicationData] = useState([]);

    // Telemetry A/V Sync Delay Buffer State
    const [syncDelayMs, setSyncDelayMs] = useState(100);
    const syncDelayRef = useRef(100);
    const queueRef = useRef([]);

    const socketRef = useRef(null);

    useEffect(() => {
        syncDelayRef.current = syncDelayMs;
    }, [syncDelayMs]);

    const applyPacket = useCallback((parsed) => {
        if (!parsed) return;

        if (parsed.type === 'waveform') {
            if (Array.isArray(parsed.data) && parsed.data.length >= 2) {
                setVibrationValue(parseFloat(parsed.data[0]));
                setVibrationFPGA(parseFloat(parsed.data[1]));
            }
        } else if (parsed.type === 'vector') {
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
        } else if (parsed.type === 'communication') {
            setCommunicationData(parsed.data);
        }
    }, []);

    // Telemetry Sync Playback Loop
    useEffect(() => {
        let animId;
        const flushQueue = () => {
            const now = Date.now();
            const queue = queueRef.current;
            while (queue.length > 0 && now >= queue[0].targetRenderTime) {
                const item = queue.shift();
                applyPacket(item.packet);
            }
            if (queue.length > 200) {
                queueRef.current = queue.slice(-50);
            }
            animId = requestAnimationFrame(flushQueue);
        };
        animId = requestAnimationFrame(flushQueue);
        return () => cancelAnimationFrame(animId);
    }, [applyPacket]);

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
                setConnectionStatus('Connected to server.');
            };

            socket.onmessage = (event) => {
                let parsed;
                try {
                    parsed = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (parsed.type === 'server-state') {
                    if (parsed.state === 'CONFIGURING' && parsed.role === 'host') {
                        setRole('host');
                        setSessionState('CONFIGURING');
                    } else if (parsed.state === 'CONFIGURING' && parsed.role === 'waiting') {
                        setRole('waiting');
                        setSessionState('WAITING_FOR_HOST');
                    } else if (parsed.state === 'ACTIVE' && parsed.role === 'viewer-auth-required') {
                        setRole('viewer');
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
                else if (parsed.type === 'server-reset') {
                    alert('Session was reset by server (Host disconnected).');
                    window.location.reload();
                }

                // Data Parsers (Route through Sync Delay Queue)
                else if (parsed.type === 'waveform' || parsed.type === 'vector' || parsed.type === 'communication') {
                    if (syncDelayRef.current <= 0) {
                        applyPacket(parsed);
                    } else {
                        queueRef.current.push({
                            packet: parsed,
                            targetRenderTime: Date.now() + syncDelayRef.current
                        });
                    }
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
    }, [applyPacket]);

    const updateGraphData = (payloads) => {
        if (!payloads) return;
        if (payloads.waveformData) {
            applyPacket({ type: 'waveform', data: payloads.waveformData });
        }
        if (payloads.vectorData) {
            applyPacket({ type: 'vector', data: payloads.vectorData });
        }
        if (payloads.commData) {
            applyPacket({ type: 'communication', data: payloads.commData });
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
        syncDelayMs,
        setSyncDelayMs,
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
