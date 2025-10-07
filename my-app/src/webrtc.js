import express from 'express';
import wrtc from '@roamhq/wrtc';

const { RTCPeerConnection } = wrtc;

// Create New Express App (web-server object)
const app = express();

// Parse incoming HTTP requests as plain text for SDP
app.use(express.text( {type: 'application/sdp'} ));

// Parse JSON as Object
app.use(express.json());

// Create publisher (source) and list of viewers

let publisherConnection = null;
const viewers = [];

app.post('/whip', async (req, res) => {
    try {
        publisherConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            encodedInsertableStreams: false,
            forceEncodedAudioInsertableStreams: false,
            forceEncodedVideoInsertableStreams: false,
        });

        // Add some logging to see what OBS is offering
        console.log('--- Received Offer from OBS ---');
        console.log(req.body);
        console.log('---------------------------------');

        // Attach all informational event handlers first
        publisherConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate generated:', event.candidate.candidate);
            } else {
                console.log('ICE gathering complete');
            }
        };
        publisherConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', publisherConnection.iceGatheringState);
        };
        publisherConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', publisherConnection.iceConnectionState);
        };
        publisherConnection.onconnectionstatechange = () => {
            console.log('Publisher connection state:', publisherConnection.connectionState);
        };

        // STEP 1: Set the remote description from OBS first.
        // This allows the peer connection to create the necessary transceivers.
        await publisherConnection.setRemoteDescription({
            type: 'offer',
            sdp: req.body,
        });

        // STEP 2: NOW attach the ontrack handler.
        // This ensures it's attached to the transceivers created by the offer.
        publisherConnection.ontrack = (trackEvent) => {
            console.log('Received track from OBS:', trackEvent.track.kind);

            // Forward to all viewers
            viewers.forEach(viewer => {
                if (viewer.connectionState === 'connected') {
                    viewer.addTrack(trackEvent.track, trackEvent.streams[0]);
                }
            });
        };

        console.log('Creating answer...');
        const answer = await publisherConnection.createAnswer();
        
        // Add logging to see the answer we are generating
        console.log('--- Generated Answer for OBS ---');
        console.log(answer.sdp);
        console.log('----------------------------------');

        console.log('Setting local description...');
        await publisherConnection.setLocalDescription(answer);

        if (publisherConnection.iceGatheringState !== 'complete') {
            await new Promise(resolve => {
                publisherConnection.addEventListener('icegatheringstatechange', () => {
                    if (publisherConnection.iceGatheringState === 'complete') {
                        resolve();
                    }
                });
            });
        }

        // Send answer back to OBS
        res.setHeader('Content-Type', 'application/sdp');
        res.send(publisherConnection.localDescription.sdp); // Send the final description
    }
    catch (error) {
        console.error('WHIP error:', error);
        res.status(500).send('Internal Server Error')
    }
});

app.get('/whip', async(req,res)=> {
    res.json({
        hasPublisher: !!publisherConnection,
        publisherState: publisherConnection?.connectionState || 'none',
        viewerCount: viewers.length,
    })
});

// Listen on specified port
app.listen(1935, ()=> {
    console.log('WHIP Server running on http://localhost:1935/whip')
});