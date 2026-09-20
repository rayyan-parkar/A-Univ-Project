import { useState, useEffect, useRef, useCallback } from 'react';

const MAX_PENDING_CANDIDATES = 64;
export const VIEWER_RECOVERY_MAX_ATTEMPTS = 4;
export const VIEWER_RECOVERY_BASE_MS = 600;
export const VIEWER_DISCONNECTED_GRACE_MS = 300;
export const VIEWER_RECOVERY_MAX_DELAY_MS = 4800;

export function viewerRecoveryDelay(attempt) {
    const normalizedAttempt = Number.isFinite(attempt) ? Math.floor(attempt) : 0;
    const exponent = Math.min(Math.max(0, normalizedAttempt), VIEWER_RECOVERY_MAX_ATTEMPTS - 1);
    return Math.min(VIEWER_RECOVERY_MAX_DELAY_MS, VIEWER_RECOVERY_BASE_MS * (2 ** exponent));
}

function stopMediaTracks(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
        try {
            track.stop();
        } catch {
            // Track already ended
        }
    }
}

async function applyIceCandidate(pc, candidate) {
    if (!pc || !candidate) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
        // Peer connection closed or candidate expired
    }
}

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
    const viewerRecoveryTimerRef = useRef(null);
    const viewerRecoveryAttemptRef = useRef(0);
    const viewerRecoveryGenerationRef = useRef(0);
    const scheduleViewerRecoveryRef = useRef(null);

    const send = useCallback((payload, socket = socketRef.current) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        try {
            socket.send(JSON.stringify(payload));
            return true;
        } catch {
            return false;
        }
    }, [socketRef]);

    const closePeer = useCallback(() => {
        const pc = pcRef.current;
        pcRef.current = null;
        pendingCandidatesRef.current = [];
        if (pc) {
            try {
                pc.close();
            } catch {
                // Already closed
            }
        }
    }, []);

    const cancelViewerRecovery = useCallback((resetAttempts = true) => {
        viewerRecoveryGenerationRef.current += 1;
        if (viewerRecoveryTimerRef.current) {
            clearTimeout(viewerRecoveryTimerRef.current);
            viewerRecoveryTimerRef.current = null;
        }
        if (resetAttempts) viewerRecoveryAttemptRef.current = 0;
    }, []);

    const scheduleViewerRecovery = useCallback((delay = VIEWER_RECOVERY_BASE_MS) => {
        const socket = socketRef.current;
        if (role !== 'viewer' || !socket || socket.readyState !== WebSocket.OPEN || viewerRecoveryTimerRef.current) return;
        if (viewerRecoveryAttemptRef.current >= VIEWER_RECOVERY_MAX_ATTEMPTS) {
            setStreamError('Camera stream could not reconnect automatically.');
            return;
        }

        const generation = ++viewerRecoveryGenerationRef.current;
        const timer = setTimeout(() => {
            if (viewerRecoveryTimerRef.current === timer) viewerRecoveryTimerRef.current = null;
            if (generation !== viewerRecoveryGenerationRef.current || role !== 'viewer' || socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return;

            const attempt = viewerRecoveryAttemptRef.current;
            if (attempt >= VIEWER_RECOVERY_MAX_ATTEMPTS) {
                setStreamError('Camera stream could not reconnect automatically.');
                return;
            }

            viewerRecoveryAttemptRef.current = attempt + 1;
            setStreamError(`Camera stream reconnecting automatically (${attempt + 1}/${VIEWER_RECOVERY_MAX_ATTEMPTS})...`);
            send({ type: 'webrtc-restart-request' }, socket);

            const nextDelay = viewerRecoveryDelay(attempt + 1);
            const finalGeneration = viewerRecoveryGenerationRef.current;
            const nextTimer = setTimeout(() => {
                if (viewerRecoveryTimerRef.current === nextTimer) viewerRecoveryTimerRef.current = null;
                if (finalGeneration !== viewerRecoveryGenerationRef.current || socketRef.current !== socket || role !== 'viewer') return;
                if (viewerRecoveryAttemptRef.current >= VIEWER_RECOVERY_MAX_ATTEMPTS) {
                    setStreamError('Camera stream could not reconnect automatically.');
                } else {
                    scheduleViewerRecoveryRef.current?.(0);
                }
            }, nextDelay);
            viewerRecoveryTimerRef.current = nextTimer;
        }, Math.max(0, delay));
        viewerRecoveryTimerRef.current = timer;
    }, [role, send, socketRef]);
    scheduleViewerRecoveryRef.current = scheduleViewerRecovery;

    const createHostPeer = useCallback(async (stream, socket) => {
        if (!stream || !socket || socket.readyState !== WebSocket.OPEN) return false;

        const generation = ++offerGenerationRef.current;
        closePeer();

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;
        pendingCandidatesRef.current = [];

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const pendingLocalCandidates = [];
        let offerSent = false;

        pc.onicecandidate = (event) => {
            if (!event.candidate || offerGenerationRef.current !== generation || pcRef.current !== pc || socketRef.current !== socket) {
                return;
            }
            if (!offerSent) {
                pendingLocalCandidates.push(event.candidate);
            } else {
                send({ type: 'webrtc-ice', candidate: event.candidate }, socket);
            }
        };

        pc.onconnectionstatechange = () => {
            if (['failed', 'closed'].includes(pc.connectionState) && pcRef.current === pc) {
                reofferSocketRef.current = null;
                setStreamError('Camera connection failed; check the host camera.');
            }
        };

        try {
            const offer = await pc.createOffer();
            if (pcRef.current !== pc || socket.readyState !== WebSocket.OPEN) return false;

            await pc.setLocalDescription(offer);
            if (pcRef.current !== pc || socket.readyState !== WebSocket.OPEN) return false;

            const sent = send({ type: 'webrtc-offer', sdp: pc.localDescription }, socket);
            if (sent) {
                offerSent = true;
                reofferSocketRef.current = socket;
                for (const candidate of pendingLocalCandidates.splice(0)) {
                    send({ type: 'webrtc-ice', candidate }, socket);
                }
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
            if (disposed || role !== 'host' || !localStreamRef.current || socket.readyState !== WebSocket.OPEN) {
                return;
            }
            if (reofferSocketRef.current === socket || reofferInFlightRef.current === socket) {
                return;
            }

            let count = 0;
            const retry = async () => {
                if (disposed || !localStreamRef.current || socketRef.current !== socket || reofferSocketRef.current === socket || count >= 5) {
                    return;
                }
                count += 1;
                reofferInFlightRef.current = socket;
                let sent = false;
                try {
                    sent = await createHostPeer(localStreamRef.current, socket);
                } finally {
                    if (reofferInFlightRef.current === socket) {
                        reofferInFlightRef.current = null;
                    }
                }
                if (sent || disposed || socketRef.current !== socket || count >= 5) return;

                const timer = setTimeout(() => {
                    retryTimers.delete(timer);
                    void retry();
                }, 250 * count);
                retryTimers.add(timer);
            };
            void retry();
        };

        const handleOpen = () => {};

        const handleMessage = async (event) => {
            if (disposed || socketRef.current !== socket) return;

            let parsed;
            try {
                parsed = JSON.parse(event.data);
            } catch {
                return;
            }

            if (parsed.type === 'server-state' && parsed.role === 'host' && parsed.state === 'ACTIVE') {
                retryReoffer();
            } else if (parsed.type === 'config-success' && role === 'host') {
                retryReoffer();
            } else if (parsed.type === 'protocol-error' && role === 'viewer' && parsed.code === 'invalid-webrtc') {
                setRemoteStream(null);
                setIsHostStreaming(false);
                closePeer();
                cancelViewerRecovery(false);
                setStreamError('Camera signaling failed; reconnecting automatically.');
                scheduleViewerRecovery();
            } else if (parsed.type === 'stream-status') {
                const active = Boolean(parsed.active);
                setIsHostStreaming(active);
                if (role === 'viewer') {
                    if (active) {
                        cancelViewerRecovery(false);
                        setStreamError('');
                    } else if (parsed.recoverable === true) {
                        setRemoteStream(null);
                        closePeer();
                        cancelViewerRecovery(false);
                        scheduleViewerRecovery();
                    } else {
                        cancelViewerRecovery();
                        setRemoteStream(null);
                        closePeer();
                        setStreamError('');
                    }
                }
            } else if (parsed.type === 'webrtc-offer' && role === 'viewer') {
                closePeer();
                const pc = new RTCPeerConnection({
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
                });
                pcRef.current = pc;
                pendingCandidatesRef.current = [];

                pc.ontrack = (eventTrack) => {
                    if (pcRef.current !== pc || socketRef.current !== socket) return;
                    setRemoteStream(eventTrack.streams?.[0] || new MediaStream([eventTrack.track]));
                    setIsHostStreaming(true);
                    cancelViewerRecovery();
                    setStreamError('');
                };

                pc.onconnectionstatechange = () => {
                    if (pcRef.current !== pc) return;
                    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                        setRemoteStream(null);
                        setIsHostStreaming(false);
                        closePeer();
                        cancelViewerRecovery(false);
                        scheduleViewerRecovery();
                    } else if (pc.connectionState === 'disconnected') {
                        setStreamError('Camera stream reconnecting automatically...');
                        scheduleViewerRecovery(VIEWER_DISCONNECTED_GRACE_MS);
                    } else if (pc.connectionState === 'connected') {
                        cancelViewerRecovery();
                        setStreamError('');
                    }
                };

                pc.onicecandidate = (candidateEvent) => {
                    if (candidateEvent.candidate && pcRef.current === pc && socketRef.current === socket) {
                        send({ type: 'webrtc-ice', candidate: candidateEvent.candidate }, socket);
                    }
                };

                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
                    if (pcRef.current !== pc || socketRef.current !== socket) return;

                    for (const candidate of pendingCandidatesRef.current.splice(0)) {
                        await applyIceCandidate(pc, candidate);
                    }

                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);

                    if (pcRef.current === pc && socketRef.current === socket) {
                        send({ type: 'webrtc-answer', sdp: pc.localDescription }, socket);
                    }
                } catch (error) {
                    if (pcRef.current !== pc || socketRef.current !== socket) return;
                    if (pcRef.current === pc) closePeer();
                    setRemoteStream(null);
                    setIsHostStreaming(false);
                    cancelViewerRecovery(false);
                    setStreamError(`Camera signaling failed; reconnecting automatically: ${error.message || 'unknown error'}`);
                    scheduleViewerRecovery();
                }
            } else if (parsed.type === 'webrtc-answer' && role === 'host' && pcRef.current) {
                const pc = pcRef.current;
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
                    if (pcRef.current !== pc || socketRef.current !== socket) return;

                    for (const candidate of pendingCandidatesRef.current.splice(0)) {
                        if (pcRef.current === pc) {
                            await applyIceCandidate(pc, candidate);
                        }
                    }
                } catch (error) {
                    setStreamError(`Camera answer failed: ${error.message || 'unknown error'}`);
                }
            } else if (parsed.type === 'webrtc-ice' && parsed.candidate) {
                const pc = pcRef.current;
                if (pc?.remoteDescription?.type && pcRef.current === pc) {
                    await applyIceCandidate(pc, parsed.candidate);
                } else if (pendingCandidatesRef.current.length < MAX_PENDING_CANDIDATES) {
                    pendingCandidatesRef.current.push(parsed.candidate);
                }
            }
        };

        socket.addEventListener('message', handleMessage);
        if (socket.readyState === WebSocket.OPEN) {
            handleOpen();
        } else {
            socket.addEventListener('open', handleOpen);
        }

        return () => {
            disposed = true;
            socket.removeEventListener('message', handleMessage);
            socket.removeEventListener('open', handleOpen);
            for (const timer of retryTimers) clearTimeout(timer);
            retryTimers.clear();
            cancelViewerRecovery();
            closePeer();
            reofferSocketRef.current = null;
            reofferInFlightRef.current = null;
            if (role === 'viewer') {
                setRemoteStream(null);
                setIsHostStreaming(false);
            }
        };
    }, [cancelViewerRecovery, closePeer, createHostPeer, role, scheduleViewerRecovery, send, socketEpoch, socketRef]);

    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    useEffect(() => () => {
        cancelViewerRecovery();
        closePeer();
        stopMediaTracks(localStreamRef.current);
    }, [cancelViewerRecovery, closePeer]);

    const startHostStream = useCallback(async () => {
        setStreamError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
                audio: false,
            });

            stream.getTracks().forEach((track) => {
                track.onended = () => {
                    if (localStreamRef.current !== stream) return;
                    setIsHostStreaming(false);
                    setLocalStream(null);
                    closePeer();
                    setStreamError('Camera stopped. Start the camera again to resume.');
                };
            });

            localStreamRef.current = stream;
            setLocalStream(stream);
            setIsHostStreaming(true);
            reofferSocketRef.current = null;

            const socket = socketRef.current;
            if (socket?.readyState === WebSocket.OPEN) {
                await createHostPeer(stream, socket);
            }
        } catch (error) {
            setIsHostStreaming(false);
            setStreamError(`Unable to start camera: ${error.message || 'permission denied'}`);
        }
    }, [closePeer, createHostPeer, socketRef]);

    const stopHostStream = useCallback(() => {
        send({ type: 'stop-webrtc-stream' });
        closePeer();
        stopMediaTracks(localStreamRef.current);
        localStreamRef.current = null;
        reofferSocketRef.current = null;
        setLocalStream(null);
        setIsHostStreaming(false);
        setRemoteStream(null);
        setStreamError('');
    }, [closePeer, send]);

    return {
        localStream,
        remoteStream,
        isHostStreaming,
        streamError,
        startHostStream,
        stopHostStream,
    };
}
