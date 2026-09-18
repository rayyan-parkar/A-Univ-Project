import { useState, useEffect, useRef, useCallback } from 'react';

const MAX_PENDING_CANDIDATES = 64;

export function useWebRTC(socketRef, role, socketEpoch = 0) {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [isHostStreaming, setIsHostStreaming] = useState(false);
    const [streamError, setStreamError] = useState('');
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const pendingCandidatesRef = useRef([]);
    const offerGenerationRef = useRef(0);
    const retryTimersRef = useRef(new Set());
    const reofferSocketRef = useRef(null);
    const reofferInFlightRef = useRef(null);

    const send = useCallback((payload, socket = socketRef.current) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try { socket.send(JSON.stringify(payload)); return true; } catch { return false; }
    }, [socketRef]);
    const closePeer = useCallback(() => {
        const pc = pcRef.current; pcRef.current = null; pendingCandidatesRef.current = [];
        if (pc) { try { pc.close(); } catch { /* already closed */ } }
    }, []);

    const createHostPeer = useCallback(async (stream, socket) => {
        if (!stream || !socket || socket.readyState !== WebSocket.OPEN) return false;
        const generation = ++offerGenerationRef.current;
        closePeer();
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pcRef.current = pc; pendingCandidatesRef.current = [];
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        const pendingLocalCandidates = [];
        let offerSent = false;
        pc.onicecandidate = event => {
            if (!event.candidate || offerGenerationRef.current !== generation || pcRef.current !== pc || socketRef.current !== socket) return;
            if (!offerSent) pendingLocalCandidates.push(event.candidate);
            else send({ type: 'webrtc-ice', candidate: event.candidate }, socket);
        };
        pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && pcRef.current === pc) { reofferSocketRef.current = null; setStreamError('Camera connection failed. Try restarting the camera.'); } };
        try {
            const offer = await pc.createOffer();
            if (pcRef.current !== pc || socket.readyState !== WebSocket.OPEN) return false;
            await pc.setLocalDescription(offer);
            if (pcRef.current !== pc || socket.readyState !== WebSocket.OPEN) return false;
            const sent = send({ type: 'webrtc-offer', sdp: pc.localDescription }, socket);
            if (sent) {
                offerSent = true; reofferSocketRef.current = socket;
                for (const candidate of pendingLocalCandidates.splice(0)) send({ type: 'webrtc-ice', candidate }, socket);
            }
            return sent;
        } catch (error) {
            if (pcRef.current === pc) closePeer();
            setStreamError(`Camera signaling failed: ${error.message || 'unknown error'}`);
            return false;
        }
    }, [closePeer, send, socketRef]);

    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return undefined;
        let disposed = false;
        const retryTimers = retryTimersRef.current;
        const retryReoffer = () => {
            if (disposed || role !== 'host' || !localStreamRef.current || socket.readyState !== WebSocket.OPEN || reofferSocketRef.current === socket || reofferInFlightRef.current === socket) return;
            let count = 0;
            const retry = async () => {
                if (disposed || !localStreamRef.current || socketRef.current !== socket || reofferSocketRef.current === socket || count >= 5) return;
                count += 1; reofferInFlightRef.current = socket;
                let sent = false;
                try { sent = await createHostPeer(localStreamRef.current, socket); }
                finally { if (reofferInFlightRef.current === socket) reofferInFlightRef.current = null; }
                if (sent || disposed || socketRef.current !== socket || count >= 5) return;
                const timer = setTimeout(() => { retryTimers.delete(timer); void retry(); }, 250 * count);
                retryTimers.add(timer);
            };
            void retry();
        };
        const handleOpen = () => { /* server-state/config-success starts host renegotiation after reclaim */ };
        const handleMessage = async event => {
            if (disposed || socketRef.current !== socket) return;
            let parsed; try { parsed = JSON.parse(event.data); } catch { return; }
            if (parsed.type === 'server-state' && parsed.role === 'host' && parsed.state === 'ACTIVE') {
                retryReoffer();
            } else if (parsed.type === 'config-success' && role === 'host') {
                retryReoffer();
            } else if (parsed.type === 'stream-status') {
                const active = Boolean(parsed.active); setIsHostStreaming(active);
                if (!active && role === 'viewer') { setRemoteStream(null); closePeer(); }
            } else if (parsed.type === 'webrtc-offer' && role === 'viewer') {
                closePeer();
                const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); pcRef.current = pc; pendingCandidatesRef.current = [];
                pc.ontrack = eventTrack => { setRemoteStream(eventTrack.streams?.[0] || new MediaStream([eventTrack.track])); setIsHostStreaming(true); setStreamError(''); };
                pc.onconnectionstatechange = () => {
                    if (pcRef.current !== pc) return;
                    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                        setRemoteStream(null); setIsHostStreaming(false); setStreamError('Viewer stream connection failed. Use Restart Camera Stream.'); closePeer();
                    } else if (pc.connectionState === 'disconnected') setStreamError('Viewer stream is reconnecting...');
                    else if (pc.connectionState === 'connected') setStreamError('');
                };
                pc.onicecandidate = candidateEvent => { if (candidateEvent.candidate && pcRef.current === pc && socketRef.current === socket) send({ type: 'webrtc-ice', candidate: candidateEvent.candidate }, socket); };
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
                    if (pcRef.current !== pc || socketRef.current !== socket) return;
                    for (const candidate of pendingCandidatesRef.current.splice(0)) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* stale candidate */ } }
                    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
                    if (pcRef.current === pc && socketRef.current === socket) send({ type: 'webrtc-answer', sdp: pc.localDescription }, socket);
                } catch (error) {
                    if (pcRef.current === pc) closePeer();
                    setRemoteStream(null); setIsHostStreaming(false);
                    setStreamError(`Viewer signaling failed: ${error.message || 'unknown error'}`);
                }
            } else if (parsed.type === 'webrtc-answer' && role === 'host' && pcRef.current) {
                const pc = pcRef.current;
                try { await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp)); if (pcRef.current !== pc || socketRef.current !== socket) return; for (const candidate of pendingCandidatesRef.current.splice(0)) { try { if (pcRef.current === pc) await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* stale candidate */ } } } catch (error) { setStreamError(`Camera answer failed: ${error.message || 'unknown error'}`); }
            } else if (parsed.type === 'webrtc-ice' && parsed.candidate) {
                const pc = pcRef.current;
                if (pc?.remoteDescription?.type && pcRef.current === pc) { try { await pc.addIceCandidate(new RTCIceCandidate(parsed.candidate)); } catch { /* peer may have rotated */ } }
                else if (pendingCandidatesRef.current.length < MAX_PENDING_CANDIDATES) pendingCandidatesRef.current.push(parsed.candidate);
            }
        };
        socket.addEventListener('message', handleMessage);
        if (socket.readyState === WebSocket.OPEN) handleOpen(); else socket.addEventListener('open', handleOpen);
        return () => {
            disposed = true; socket.removeEventListener('message', handleMessage); socket.removeEventListener('open', handleOpen); for (const timer of retryTimers) clearTimeout(timer); retryTimers.clear();
            closePeer();
            reofferSocketRef.current = null;
            reofferInFlightRef.current = null;
            if (role === 'viewer') { setRemoteStream(null); setIsHostStreaming(false); }
        };
    }, [closePeer, createHostPeer, role, send, socketEpoch, socketRef]);

    useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
    useEffect(() => () => {
        closePeer();
        if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => { try { track.stop(); } catch { /* already stopped */ } });
    }, [closePeer]);

    const startHostStream = useCallback(async () => {
        setStreamError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
            stream.getTracks().forEach(track => { track.onended = () => { if (localStreamRef.current !== stream) return; setIsHostStreaming(false); setLocalStream(null); closePeer(); setStreamError('Camera stopped. Start the camera again to resume.'); }; });
            localStreamRef.current = stream; setLocalStream(stream); setIsHostStreaming(true);
            reofferSocketRef.current = null;
            const socket = socketRef.current; if (socket?.readyState === WebSocket.OPEN) await createHostPeer(stream, socket);
        } catch (error) { setIsHostStreaming(false); setStreamError(`Unable to start camera: ${error.message || 'permission denied'}`); }
    }, [closePeer, createHostPeer, socketRef]);
    const stopHostStream = useCallback(() => {
        send({ type: 'stop-webrtc-stream' }); closePeer();
        if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => { try { track.stop(); } catch { /* already stopped */ } });
        localStreamRef.current = null; reofferSocketRef.current = null; setLocalStream(null); setIsHostStreaming(false); setRemoteStream(null); setStreamError('');
    }, [closePeer, send]);
    const restartViewerStream = useCallback(() => { setStreamError(''); return send({ type: 'webrtc-restart-request' }); }, [send]);

    return { localStream, remoteStream, isHostStreaming, streamError, startHostStream, stopHostStream, restartViewerStream };
}
