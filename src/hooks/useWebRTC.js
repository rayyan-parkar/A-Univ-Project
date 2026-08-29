import { useState, useEffect, useRef } from 'react';

export function useWebRTC(socketRef, role) {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [isHostStreaming, setIsHostStreaming] = useState(false);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const pendingCandidatesRef = useRef([]);

    // Keep localStreamRef up to date
    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    // WebSocket message handling for WebRTC
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        const handleMessage = async (event) => {
            let parsed;
            try {
                parsed = JSON.parse(event.data);
            } catch { return; }

            if (parsed.type === 'stream-status') {
                const active = Boolean(parsed.active);
                setIsHostStreaming(active);
                if (!active) {
                    setRemoteStream(null);
                    if (role === 'viewer' && pcRef.current) {
                        pcRef.current.close();
                        pcRef.current = null;
                    }
                }
            } else if (parsed.type === 'webrtc-offer') {
                if (role === 'viewer') {
                    if (pcRef.current) {
                        pcRef.current.close();
                        pcRef.current = null;
                    }

                    const pc = new RTCPeerConnection({
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                    });
                    pcRef.current = pc;
                    pendingCandidatesRef.current = [];

                    pc.ontrack = (e) => {
                        console.log('Viewer received remote track:', e.track.kind);
                        if (e.streams && e.streams[0]) {
                            setRemoteStream(e.streams[0]);
                        } else {
                            setRemoteStream(new MediaStream([e.track]));
                        }
                        setIsHostStreaming(true);
                    };

                    pc.onicecandidate = (e) => {
                        if (e.candidate && socketRef.current && socketRef.current.readyState === 1) {
                            socketRef.current.send(JSON.stringify({ type: 'webrtc-ice', candidate: e.candidate }));
                        }
                    };

                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(parsed.sdp));

                        while (pendingCandidatesRef.current.length > 0) {
                            const cand = pendingCandidatesRef.current.shift();
                            try {
                                await pc.addIceCandidate(new RTCIceCandidate(cand));
                            } catch (err) {
                                console.error('Error adding queued ICE candidate:', err);
                            }
                        }

                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);

                        if (socketRef.current && socketRef.current.readyState === 1) {
                            socketRef.current.send(JSON.stringify({ type: 'webrtc-answer', sdp: pc.localDescription }));
                        }
                    } catch (err) {
                        console.error('Error handling WebRTC offer on viewer:', err);
                    }
                }
            } else if (parsed.type === 'webrtc-answer') {
                if (role === 'host' && pcRef.current) {
                    try {
                        await pcRef.current.setRemoteDescription(new RTCSessionDescription(parsed.sdp));

                        while (pendingCandidatesRef.current.length > 0) {
                            const cand = pendingCandidatesRef.current.shift();
                            try {
                                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
                            } catch (err) {
                                console.error('Error adding queued host ICE candidate:', err);
                            }
                        }
                    } catch (err) {
                        console.error('Error handling WebRTC answer on host:', err);
                    }
                }
            } else if (parsed.type === 'webrtc-ice') {
                const candidate = parsed.candidate;
                if (!candidate) return;

                if (pcRef.current && pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
                    pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error('Error adding ICE candidate:', e));
                } else {
                    pendingCandidatesRef.current.push(candidate);
                }
            }
        };

        socket.addEventListener('message', handleMessage);

        return () => {
            socket.removeEventListener('message', handleMessage);
        };
    }, [socketRef, role]);

    // Unmount cleanup ONLY on actual component unmount
    useEffect(() => {
        return () => {
            if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
        };
    }, []);

    const startHostStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, 
                audio: false 
            });
            setLocalStream(stream);
            localStreamRef.current = stream;
            setIsHostStreaming(true);
            
            if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
            }

            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });
            pcRef.current = pc;
            pendingCandidatesRef.current = [];

            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
            });

            pc.onicecandidate = (e) => {
                if (e.candidate && socketRef.current && socketRef.current.readyState === 1) {
                    socketRef.current.send(JSON.stringify({ type: 'webrtc-ice', candidate: e.candidate }));
                }
            };

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            if (socketRef.current && socketRef.current.readyState === 1) {
                socketRef.current.send(JSON.stringify({ type: 'webrtc-offer', sdp: pc.localDescription }));
            }

        } catch(err) {
            console.error('Error starting camera stream:', err);
        }
    };

    return { localStream, remoteStream, isHostStreaming, startHostStream };
}
