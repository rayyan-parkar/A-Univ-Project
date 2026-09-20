import { useState, useEffect, useRef, useCallback } from 'react';
import { isTelemetryFrame } from '../telemetryProtocol.js';
import {
    addClockSample,
    captureTimeToEpoch,
    clockEstimate,
    createClockEstimator,
    createSyncState,
    enqueueSyncPacket,
    fallbackSyncFrame,
    presentVideoFrame,
    presentVideoReceiveTime,
    receiveTimeToEpoch,
    resetClockEstimator,
    resetSyncState,
} from '../avSync.js';

export const RECONNECT_BASE_MS = 250;
export const RECONNECT_MAX_MS = 8000;

export function reconnectDelay(attempt, random = Math.random()) {
    const exponent = Math.min(Math.max(0, attempt), 8);
    const capped = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** exponent));
    return Math.round(capped * (0.75 + Math.min(1, Math.max(0, random)) * 0.5));
}

const HOST_TOKEN_KEY = 'sfu-host-token';
const HOST_CONFIG_KEY = 'sfu-host-config';

function readSessionJson(key) {
    try {
        return JSON.parse(window.sessionStorage.getItem(key) || 'null');
    } catch {
        return null;
    }
}

function writeSessionJson(key, value) {
    try {
        window.sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
        // Storage is restricted or disabled
    }
}

function removeSessionItem(key) {
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // Storage is restricted or disabled
    }
}

export function useExperimentSession() {
    const [connectionStatus, setConnectionStatus] = useState('Connecting...');
    const [sessionState, setSessionState] = useState('CONNECTING');
    const [role, setRole] = useState(null);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [socketEpoch, setSocketEpoch] = useState(0);

    const [graphData, setGraphData] = useState({
        vibrationValue: null,
        vibrationFPGA: null,
        vectorData1: [],
        vectorData2: [],
        vectorData3: [],
        communicationData: [],
    });

    const [latestFrame, setLatestFrame] = useState(null);
    const [liveIngestStatus, setLiveIngestStatus] = useState(null);
    const [syncStatus, setSyncStatus] = useState('Fallback');

    const syncStateRef = useRef(createSyncState());
    const clockEstimatorRef = useRef(createClockEstimator());
    const clockRequestRef = useRef(0);
    const clockRequestsRef = useRef(new Map());
    const videoCleanupRef = useRef(null);
    const clockTimerRef = useRef(null);
    const socketRef = useRef(null);
    const mountedRef = useRef(false);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const socketGenerationRef = useRef(0);
    const viewerPasswordRef = useRef('');
    const hostConfigRef = useRef(readSessionJson(HOST_CONFIG_KEY));
    const hostTokenRef = useRef('');

    useEffect(() => {
        try {
            hostTokenRef.current = window.sessionStorage.getItem(HOST_TOKEN_KEY) || '';
        } catch {
            hostTokenRef.current = '';
        }
    }, []);

    const resetSynchronization = useCallback((status = 'Fallback') => {
        resetSyncState(syncStateRef.current);
        resetClockEstimator(clockEstimatorRef.current);
        clockRequestsRef.current.clear();
        setSyncStatus(status);
    }, []);

    const resetPresentationSynchronization = useCallback(() => {
        resetSyncState(syncStateRef.current);
        setSyncStatus('Fallback');
    }, []);

    const applyPacket = useCallback((parsed) => {
        if (!parsed) return;

        if (isTelemetryFrame(parsed)) {
            setLatestFrame({ frameId: parsed.frameId, timestamp: parsed.timestamp });
            const colors = ['#ff4500', '#009908', '#8a2be2'];
            const formatVectors = (startIdx) =>
                parsed.vector.slice(startIdx, startIdx + 3).map((item, index) => ({
                    x: item[0],
                    y: item[1],
                    z: item[2],
                    color: colors[index],
                }));

            setGraphData({
                vibrationValue: parsed.waveform[0],
                vibrationFPGA: parsed.waveform[1],
                vectorData1: formatVectors(0),
                vectorData2: formatVectors(3),
                vectorData3: formatVectors(6),
                communicationData: parsed.communication,
            });
        } else if (parsed.type === 'waveform' && Array.isArray(parsed.data) && parsed.data.length >= 2) {
            setGraphData((prev) => ({
                ...prev,
                vibrationValue: Number.parseFloat(parsed.data[0]),
                vibrationFPGA: Number.parseFloat(parsed.data[1]),
            }));
        } else if (parsed.type === 'vector' && Array.isArray(parsed.data) && parsed.data.length >= 9) {
            const colors = ['#ff4500', '#009908', '#8a2be2'];
            const formatVectors = (startIdx) =>
                parsed.data.slice(startIdx, startIdx + 3).map((item, index) => ({
                    x: item[0],
                    y: item[1],
                    z: item[2],
                    color: colors[index],
                }));

            setGraphData((prev) => ({
                ...prev,
                vectorData1: formatVectors(0),
                vectorData2: formatVectors(3),
                vectorData3: formatVectors(6),
            }));
        } else if (parsed.type === 'communication' && Array.isArray(parsed.data)) {
            setGraphData((prev) => ({
                ...prev,
                communicationData: parsed.data,
            }));
        }
    }, []);

    const queueTelemetry = useCallback((packet) => {
        if (!packet) return;
        enqueueSyncPacket(syncStateRef.current, packet, Date.now());
    }, []);

    const send = useCallback((message) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try {
            socket.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }, []);

    const requestClockSync = useCallback(() => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        const requestId = ++clockRequestRef.current;
        const clientSend = Date.now();
        clockRequestsRef.current.set(requestId, clientSend);
        // Keep outstanding requests bounded if a browser/network silently
        // loses a response.
        if (clockRequestsRef.current.size > 8) {
            const oldest = clockRequestsRef.current.keys().next().value;
            clockRequestsRef.current.delete(oldest);
        }
        return send({ type: 'clock-sync-request', requestId, clientSend });
    }, [send]);

    const handlePresentedVideoFrame = useCallback((metadata) => {
        const now = Date.now();
        let timeOrigin = null;
        try {
            timeOrigin = Number(window.performance?.timeOrigin);
        } catch {
            timeOrigin = null;
        }
        const captureEpoch = captureTimeToEpoch(metadata, { timeOrigin, now });
        if (captureEpoch !== null) {
            const packet = presentVideoFrame(
                syncStateRef.current,
                captureEpoch,
                now,
                clockEstimate(clockEstimatorRef.current),
            );
            if (packet) applyPacket(packet);
            setSyncStatus(syncStateRef.current.mode === 'auto' ? 'Auto' : 'Fallback');
            return;
        }
        const receiveEpoch = receiveTimeToEpoch(metadata, { timeOrigin, now });
        if (receiveEpoch === null) {
            syncStateRef.current.lastVideoAt = null;
            setSyncStatus('Fallback');
            return;
        }
        const packet = presentVideoReceiveTime(
            syncStateRef.current,
            receiveEpoch,
            now,
        );
        if (packet) applyPacket(packet);
        setSyncStatus(syncStateRef.current.mode === 'estimated' ? 'Estimated' : 'Fallback');
    }, [applyPacket]);

    const registerVideoElement = useCallback((video) => {
        videoCleanupRef.current?.();
        videoCleanupRef.current = null;
        resetPresentationSynchronization();
        if (!video) return;

        const requestFrame = video.requestVideoFrameCallback?.bind(video);
        const cancelFrame = video.cancelVideoFrameCallback?.bind(video);
        if (!requestFrame) {
            setSyncStatus('Fallback');
            return;
        }

        let active = true;
        let callbackId = null;
        const onFrame = (_now, metadata) => {
            if (!active) return;
            handlePresentedVideoFrame(metadata);
            try {
                callbackId = requestFrame(onFrame);
            } catch {
                active = false;
                setSyncStatus('Fallback');
            }
        };
        try {
            callbackId = requestFrame(onFrame);
        } catch {
            setSyncStatus('Fallback');
            return;
        }
        videoCleanupRef.current = () => {
            active = false;
            if (callbackId !== null && cancelFrame) {
                try { cancelFrame(callbackId); } catch { /* already cancelled */ }
            }
        };
    }, [handlePresentedVideoFrame, resetPresentationSynchronization]);

    useEffect(() => {
        let animationId;
        const flushFallback = () => {
            const packet = fallbackSyncFrame(syncStateRef.current, Date.now());
            if (packet) applyPacket(packet);
            animationId = requestAnimationFrame(flushFallback);
        };
        animationId = requestAnimationFrame(flushFallback);
        return () => cancelAnimationFrame(animationId);
    }, [applyPacket]);

    const configureSession = useCallback((maxClients, password, whitelist) => {
        setAuthError('');
        const config = {
            maxClients: Number(maxClients),
            password: password || '',
            whitelist: Array.isArray(whitelist) ? whitelist : [],
        };
        hostConfigRef.current = config;
        writeSessionJson(HOST_CONFIG_KEY, config);
        return send({ type: 'configure', ...config });
    }, [send]);

    const claimHost = useCallback((token) => {
        if (typeof token !== 'string' || token.length < 16) return false;
        setAuthError('');
        hostTokenRef.current = token;
        writeSessionJson(HOST_TOKEN_KEY, token);
        return send({ type: 'claim-host', token });
    }, [send]);

    const authenticate = useCallback((password) => {
        viewerPasswordRef.current = password;
        setAuthError('');
        return send({ type: 'auth', password });
    }, [send]);

    useEffect(() => {
        mountedRef.current = true;
        const pageProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = import.meta.env.VITE_WS_URL || `${pageProtocol}//${window.location.host}/ws`;

        const clearReconnect = () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };

        const scheduleReconnect = () => {
            if (!mountedRef.current || reconnectTimerRef.current) return;
            const attempt = reconnectAttemptRef.current++;
            setConnectionStatus(`Reconnecting (attempt ${attempt + 1})...`);
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                connect();
            }, reconnectDelay(attempt));
        };

        const startClockSync = () => {
            clearInterval(clockTimerRef.current);
            requestClockSync();
            clockTimerRef.current = setInterval(requestClockSync, 10000);
        };

        const connect = () => {
            if (!mountedRef.current || socketRef.current) return;
            const generation = ++socketGenerationRef.current;
            let socket;

            try {
                socket = new WebSocket(wsUrl);
            } catch {
                scheduleReconnect();
                return;
            }

            socketRef.current = socket;
            setSocketEpoch((epoch) => epoch + 1);

            socket.onopen = () => {
                if (!mountedRef.current || socketGenerationRef.current !== generation) return;
                reconnectAttemptRef.current = 0;
                setConnectionStatus('Connected to server.');
                setSocketEpoch((epoch) => epoch + 1);
                clearInterval(clockTimerRef.current);
                clockTimerRef.current = null;
                if (hostTokenRef.current) {
                    send({ type: 'claim-host', token: hostTokenRef.current });
                }
            };

            socket.onmessage = (event) => {
                if (!mountedRef.current || socketGenerationRef.current !== generation) return;

                let parsed;
                try {
                    parsed = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (parsed.type === 'clock-sync-response') {
                    const clientSend = clockRequestsRef.current.get(parsed.requestId);
                    clockRequestsRef.current.delete(parsed.requestId);
                    if (Number.isFinite(clientSend)) {
                        addClockSample(clockEstimatorRef.current, {
                            clientSend,
                            serverReceive: parsed.serverReceive,
                            serverSend: parsed.serverSend,
                            clientReceive: Date.now(),
                        });
                    }
                } else if (parsed.type === 'server-state') {
                    if (parsed.role === 'host') {
                        setRole('host');
                        setSessionState(parsed.state === 'ACTIVE' ? 'ACTIVE' : 'CONFIGURING');
                        if (hostConfigRef.current && parsed.state !== 'IDLE') {
                            configureSession(
                                hostConfigRef.current.maxClients,
                                hostConfigRef.current.password,
                                hostConfigRef.current.whitelist
                            );
                        }
                    } else if (parsed.state === 'ACTIVE' && parsed.role === 'viewer-auth-required') {
                        setRole('viewer');
                        setSessionState('AUTH_REQUIRED');
                        if (viewerPasswordRef.current) {
                            send({ type: 'auth', password: viewerPasswordRef.current });
                        }
                    } else {
                        setRole('waiting');
                        setSessionState(parsed.state === 'CONFIGURING' ? 'WAITING_FOR_HOST' : parsed.state);
                    }
                } else if (parsed.type === 'protocol-error') {
                    if (parsed.code === 'invalid-host-token' || parsed.code === 'host-claim-locked') {
                        hostTokenRef.current = '';
                        removeSessionItem(HOST_TOKEN_KEY);
                    }
                    setAuthError(parsed.message || 'The server rejected that request.');
                } else if (parsed.type === 'config-success') {
                    startClockSync();
                    setGeneratedPassword(parsed.password);
                    setSessionState('ACTIVE');
                    setRole('host');
                    setAuthError('');
                    if (hostConfigRef.current) {
                        hostConfigRef.current = { ...hostConfigRef.current, password: parsed.password };
                        writeSessionJson(HOST_CONFIG_KEY, hostConfigRef.current);
                    }
                } else if (parsed.type === 'auth-success') {
                    startClockSync();
                    setAuthError('');
                    setSessionState('ACTIVE');
                    setRole('viewer');
                } else if (parsed.type === 'auth-fail') {
                    setAuthError(parsed.message || 'Authentication failed');
                } else if (parsed.type === 'server-reset') {
                    clearInterval(clockTimerRef.current);
                    clockTimerRef.current = null;
                    resetSynchronization();
                    setLiveIngestStatus(null);
                    setRole('waiting');
                    setSessionState('IDLE');
                    setAuthError('The session ended. Waiting for a host.');
                } else if (parsed.type === 'live-ingest-status') {
                    setLiveIngestStatus(parsed);
                } else if (
                    isTelemetryFrame(parsed) ||
                    parsed.type === 'waveform' ||
                    parsed.type === 'vector' ||
                    parsed.type === 'communication'
                ) {
                    if (isTelemetryFrame(parsed)) queueTelemetry(parsed);
                    else applyPacket(parsed); // legacy component messages
                }
            };

            socket.onerror = () => {
                if (socketGenerationRef.current === generation) {
                    setConnectionStatus('Connection error; retrying...');
                }
            };

            socket.onclose = () => {
                if (socketGenerationRef.current !== generation) return;
                socketRef.current = null;
                clearInterval(clockTimerRef.current);
                clockTimerRef.current = null;
                resetSynchronization();
                setLiveIngestStatus(null);
                setSocketEpoch((epoch) => epoch + 1);
                setSessionState('DISCONNECTED');
                scheduleReconnect();
            };
        };

        connect();

        return () => {
            mountedRef.current = false;
            clearReconnect();
            clearInterval(clockTimerRef.current);
            clockTimerRef.current = null;
            videoCleanupRef.current?.();
            videoCleanupRef.current = null;
            resetSynchronization();
            socketGenerationRef.current += 1;
            const socket = socketRef.current;
            socketRef.current = null;
            if (socket) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, [applyPacket, configureSession, queueTelemetry, requestClockSync, resetSynchronization, send]);

    const updateGraphData = useCallback((payloads) => {
        if (!payloads) return;
        if (isTelemetryFrame(payloads)) {
            queueTelemetry(payloads);
        } else {
            if (payloads.waveformData) applyPacket({ type: 'waveform', data: payloads.waveformData });
            if (payloads.vectorData) applyPacket({ type: 'vector', data: payloads.vectorData });
            if (payloads.commData) applyPacket({ type: 'communication', data: payloads.commData });
        }
    }, [applyPacket, queueTelemetry]);

    return {
        socketRef,
        socketEpoch,
        connectionStatus,
        sessionState,
        role,
        generatedPassword,
        authError,
        configureSession,
        claimHost,
        authenticate,
        send,
        updateGraphData,
        registerVideoElement,
        syncStatus,
        latestFrame,
        liveIngestStatus,
        graphData,
    };
}
