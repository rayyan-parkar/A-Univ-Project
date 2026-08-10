import { useState, useEffect, useRef } from 'react';

export function useWebRTC(socketRef, role) {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const pcRef = useRef(null);

    useEffect(() => {
        if (!socketRef.current) return;

        const handleMessage = async (event) => {
            let parsed;
            try {
                parsed = JSON.parse(event.data);
            } catch(e) { return; }

            if (parsed.type === 'webrtc-offer') {
                if (role === 'viewer') {
                    pcRef.current = new RTCPeerConnection({
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                    });

                    pcRef.current.ontrack = (e) => {
                        console.log('Received remote track', e.track.kind);
                        if (e.streams && e.streams[0]) {
                            setRemoteStream(e.streams[0]);
                        } else {
                            setRemoteStream(new MediaStream([e.track]));
                        }
                    };

                    pcRef.current.onicecandidate = (e) => {
                        if (e.candidate) {
                            socketRef.current.send(JSON.stringify({ type: 'webrtc-ice', candidate: e.candidate }));
                        }
                    };

                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
                    const answer = await pcRef.current.createAnswer();
                    await pcRef.current.setLocalDescription(answer);

                    socketRef.current.send(JSON.stringify({ type: 'webrtc-answer', sdp: pcRef.current.localDescription }));
                }
            } else if (parsed.type === 'webrtc-answer') {
                if (role === 'host' && pcRef.current) {
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(parsed.sdp));
                }
            } else if (parsed.type === 'webrtc-ice') {
                if (pcRef.current && parsed.candidate) {
                    pcRef.current.addIceCandidate(new RTCIceCandidate(parsed.candidate)).catch(e => console.error('Error adding ICE candidate', e));
                }
            }
        };

        const currentSocket = socketRef.current;
        currentSocket.addEventListener('message', handleMessage);

        return () => {
            currentSocket.removeEventListener('message', handleMessage);
        };
    }, [socketRef.current, role]);

    const startHostStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            setLocalStream(stream);
            
            pcRef.current = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            stream.getTracks().forEach(track => {
                pcRef.current.addTrack(track, stream);
            });

            pcRef.current.onicecandidate = (e) => {
                if (e.candidate) {
                    socketRef.current.send(JSON.stringify({ type: 'webrtc-ice', candidate: e.candidate }));
                }
            };

            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);

            socketRef.current.send(JSON.stringify({ type: 'webrtc-offer', sdp: pcRef.current.localDescription }));

        } catch(err) {
            console.error('Error starting camera stream', err);
        }
    };

    return { localStream, remoteStream, startHostStream };
}
