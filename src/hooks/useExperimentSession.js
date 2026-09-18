import { useState, useEffect, useRef, useCallback } from 'react';
import { isTelemetryFrame } from '../telemetryProtocol';

export const RECONNECT_BASE_MS = 250;
export const RECONNECT_MAX_MS = 8000;
// At the maximum 400ms delay this is several seconds of latest-state history;
// insertion is capped so background tabs cannot accumulate unbounded frames.
export const MAX_DELAY_QUEUE = 240;
export function reconnectDelay(attempt, random = Math.random()) {
    const exponent = Math.min(Math.max(0, attempt), 8);
    const capped = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** exponent));
    return Math.round(capped * (0.75 + Math.min(1, Math.max(0, random)) * 0.5));
}

const HOST_TOKEN_KEY = 'sfu-host-token';
const HOST_CONFIG_KEY = 'sfu-host-config';

function readSessionJson(key) {
    try { return JSON.parse(window.sessionStorage.getItem(key) || 'null'); } catch { return null; }
}

export function useExperimentSession() {
    const [connectionStatus, setConnectionStatus] = useState('Connecting...');
    const [sessionState, setSessionState] = useState('CONNECTING');
    const [role, setRole] = useState(null);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [socketEpoch, setSocketEpoch] = useState(0);
    const [vibrationValue, setVibrationValue] = useState(null);
    const [vibrationFPGA, setVibrationFPGA] = useState(null);
    const [vectorData1, setVectorData1] = useState([]);
    const [vectorData2, setVectorData2] = useState([]);
    const [vectorData3, setVectorData3] = useState([]);
    const [communicationData, setCommunicationData] = useState([]);
    const [latestFrame, setLatestFrame] = useState(null);
    const [liveIngestStatus, setLiveIngestStatus] = useState(null);
    const [syncDelayMs, setSyncDelayMs] = useState(100);
    const syncDelayRef = useRef(100);
    const queueRef = useRef([]);
    const socketRef = useRef(null);
    const mountedRef = useRef(false);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const socketGenerationRef = useRef(0);
    const viewerPasswordRef = useRef('');
    const hostConfigRef = useRef(readSessionJson(HOST_CONFIG_KEY));
    const hostTokenRef = useRef(() => {
        try { return window.sessionStorage.getItem(HOST_TOKEN_KEY) || ''; } catch { return ''; }
    });
    // The lazy initializer above is intentionally resolved once for this page lifetime.
    if (typeof hostTokenRef.current === 'function') hostTokenRef.current = hostTokenRef.current();

    useEffect(() => { syncDelayRef.current = syncDelayMs; queueRef.current = []; }, [syncDelayMs]);

    const applyPacket = useCallback((parsed) => {
        if (!parsed) return;
        if (isTelemetryFrame(parsed)) {
            setLatestFrame({ frameId: parsed.frameId, timestamp: parsed.timestamp });
            setVibrationValue(parsed.waveform[0]); setVibrationFPGA(parsed.waveform[1]);
            const colors = ['#ff4500', '#009908', '#8a2be2'];
            const createGraphData = startIdx => parsed.vector.slice(startIdx, startIdx + 3).map((item, index) => ({ x: item[0], y: item[1], z: item[2], color: colors[index] }));
            setVectorData1(createGraphData(0)); setVectorData2(createGraphData(3)); setVectorData3(createGraphData(6));
            setCommunicationData(parsed.communication);
        } else if (parsed.type === 'waveform' && Array.isArray(parsed.data) && parsed.data.length >= 2) {
            setVibrationValue(Number.parseFloat(parsed.data[0])); setVibrationFPGA(Number.parseFloat(parsed.data[1]));
        } else if (parsed.type === 'vector' && Array.isArray(parsed.data) && parsed.data.length >= 9) {
            const colors = ['#ff4500', '#009908', '#8a2be2'];
            const createGraphData = startIdx => parsed.data.slice(startIdx, startIdx + 3).map((item, index) => ({ x: item[0], y: item[1], z: item[2], color: colors[index] }));
            setVectorData1(createGraphData(0)); setVectorData2(createGraphData(3)); setVectorData3(createGraphData(6));
        } else if (parsed.type === 'communication' && Array.isArray(parsed.data)) setCommunicationData(parsed.data);
    }, []);

    useEffect(() => {
        let animId;
        const flushQueue = () => {
            const now = Date.now(); const queue = queueRef.current;
            let latestDue = null;
            while (queue.length > 0 && now >= queue[0].targetRenderTime) latestDue = queue.shift().packet;
            if (latestDue) applyPacket(latestDue);
            animId = requestAnimationFrame(flushQueue);
        };
        animId = requestAnimationFrame(flushQueue);
        return () => cancelAnimationFrame(animId);
    }, [applyPacket]);

    const send = useCallback((message) => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
    }, []);

    const configureSession = useCallback((maxClients, password, whitelist) => {
        setAuthError('');
        const config = { maxClients: Number(maxClients), password: password || '', whitelist: Array.isArray(whitelist) ? whitelist : [] };
        hostConfigRef.current = config;
        try { window.sessionStorage.setItem(HOST_CONFIG_KEY, JSON.stringify(config)); } catch { /* storage is optional */ }
        return send({ type: 'configure', ...config });
    }, [send]);
    const claimHost = useCallback((token) => {
        if (typeof token !== 'string' || token.length < 16) return false;
        setAuthError('');
        hostTokenRef.current = token;
        try { window.sessionStorage.setItem(HOST_TOKEN_KEY, token); } catch { /* storage is optional */ }
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
        const clearReconnect = () => { if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; } };
        const scheduleReconnect = () => {
            if (!mountedRef.current || reconnectTimerRef.current) return;
            const attempt = reconnectAttemptRef.current++;
            setConnectionStatus(`Reconnecting (attempt ${attempt + 1})...`);
            reconnectTimerRef.current = setTimeout(() => { reconnectTimerRef.current = null; connect(); }, reconnectDelay(attempt));
        };
        const connect = () => {
            if (!mountedRef.current || socketRef.current) return;
            const generation = ++socketGenerationRef.current;
            let socket;
            try { socket = new WebSocket(wsUrl); } catch { scheduleReconnect(); return; }
            socketRef.current = socket;
            setSocketEpoch(epoch => epoch + 1);
            socket.onopen = () => {
                if (!mountedRef.current || socketGenerationRef.current !== generation) return;
                reconnectAttemptRef.current = 0; setConnectionStatus('Connected to server.'); setSocketEpoch(epoch => epoch + 1);
                if (hostTokenRef.current) send({ type: 'claim-host', token: hostTokenRef.current });
            };
            socket.onmessage = event => {
                if (!mountedRef.current || socketGenerationRef.current !== generation) return;
                let parsed; try { parsed = JSON.parse(event.data); } catch { return; }
                if (parsed.type === 'server-state') {
                    if (parsed.role === 'host') {
                        setRole('host'); setSessionState(parsed.state === 'ACTIVE' ? 'ACTIVE' : 'CONFIGURING');
                        if (hostConfigRef.current && parsed.state !== 'IDLE') configureSession(hostConfigRef.current.maxClients, hostConfigRef.current.password, hostConfigRef.current.whitelist);
                    } else if (parsed.state === 'ACTIVE' && parsed.role === 'viewer-auth-required') { setRole('viewer'); setSessionState('AUTH_REQUIRED'); if (viewerPasswordRef.current) send({ type: 'auth', password: viewerPasswordRef.current }); }
                    else { setRole('waiting'); setSessionState(parsed.state === 'CONFIGURING' ? 'WAITING_FOR_HOST' : parsed.state); }
                } else if (parsed.type === 'protocol-error') {
                    if (parsed.code === 'invalid-host-token' || parsed.code === 'host-claim-locked') {
                        hostTokenRef.current = '';
                        try { window.sessionStorage.removeItem(HOST_TOKEN_KEY); } catch { /* storage is optional */ }
                    }
                    setAuthError(parsed.message || 'The server rejected that request.');
                } else if (parsed.type === 'config-success') {
                    setGeneratedPassword(parsed.password); setSessionState('ACTIVE'); setRole('host');
                    setAuthError('');
                    if (hostConfigRef.current) {
                        hostConfigRef.current = { ...hostConfigRef.current, password: parsed.password };
                        try { window.sessionStorage.setItem(HOST_CONFIG_KEY, JSON.stringify(hostConfigRef.current)); } catch { /* storage is optional */ }
                    }
                }
                else if (parsed.type === 'auth-success') { setAuthError(''); setSessionState('ACTIVE'); setRole('viewer'); }
                else if (parsed.type === 'auth-fail') setAuthError(parsed.message || 'Authentication failed');
                else if (parsed.type === 'server-reset') { queueRef.current = []; setLiveIngestStatus(null); setRole('waiting'); setSessionState('IDLE'); setAuthError('The session ended. Waiting for a host.'); }
                else if (parsed.type === 'live-ingest-status') setLiveIngestStatus(parsed);
                else if (isTelemetryFrame(parsed) || parsed.type === 'waveform' || parsed.type === 'vector' || parsed.type === 'communication') {
                    if (syncDelayRef.current <= 0) applyPacket(parsed);
                    else {
                        if (queueRef.current.length >= MAX_DELAY_QUEUE) queueRef.current.splice(0, Math.ceil(MAX_DELAY_QUEUE / 4));
                        queueRef.current.push({ packet: parsed, targetRenderTime: Date.now() + syncDelayRef.current });
                    }
                }
            };
            socket.onerror = () => { if (socketGenerationRef.current === generation) setConnectionStatus('Connection error; retrying...'); };
            socket.onclose = () => {
                if (socketGenerationRef.current !== generation) return;
                socketRef.current = null; queueRef.current = []; setLiveIngestStatus(null); setSocketEpoch(epoch => epoch + 1); setSessionState('DISCONNECTED'); scheduleReconnect();
            };
        };
        connect();
        return () => { mountedRef.current = false; clearReconnect(); socketGenerationRef.current += 1; const socket = socketRef.current; socketRef.current = null; if (socket) { socket.onclose = null; socket.close(); } };
    }, [applyPacket, configureSession, send]);

    const updateGraphData = useCallback((payloads) => {
        if (!payloads) return;
        if (isTelemetryFrame(payloads)) applyPacket(payloads);
        else {
            if (payloads.waveformData) applyPacket({ type: 'waveform', data: payloads.waveformData });
            if (payloads.vectorData) applyPacket({ type: 'vector', data: payloads.vectorData });
            if (payloads.commData) applyPacket({ type: 'communication', data: payloads.commData });
        }
    }, [applyPacket]);

    return {
        socketRef, socketEpoch, connectionStatus, sessionState, role, generatedPassword, authError,
        configureSession, claimHost, authenticate, send, updateGraphData, syncDelayMs, setSyncDelayMs, latestFrame, liveIngestStatus,
        graphData: { vibrationValue, vibrationFPGA, vectorData1, vectorData2, vectorData3, communicationData }
    };
}
