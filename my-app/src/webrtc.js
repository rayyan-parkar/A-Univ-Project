import express from 'express';
import { spawn } from 'child_process';

const app = express();

let rtmpProcess = null;

// Start simple RTMP server with FFMPEG
function startRTMPServer() {
    console.log('Starting RTMP server...');

    rtmpProcess = spawn('ffmpeg', [
        '-f', 'flv',
        '-listen', '1',
        '-i', 'rtmp://0.0.0.0:1935/stream',
        '-c', 'copy',
        '-f', 'null',  // Fixed: was missing '-'
        '-'
    ]);

    rtmpProcess.stdout.on('data', (data)=> {
        console.log('FFmpeg stdout:', data.toString());  // Fixed typo
    });

    rtmpProcess.stderr.on('data', (data)=>{
        console.log('FFmpeg error:', data.toString());
    });

    rtmpProcess.on('close', (code)=> {
        console.log(`RTMP server closed with code ${code}`);
    });

    rtmpProcess.on('error', (error)=> {
        console.error('RTMP server error:',error);
    });

    console.log('RTMP server listening on rtmp://localhost:1935/stream');
}

app.get('/status', (req,res)=> {
    res.json({
        rtmpServerRunning: !!rtmpProcess,  // Fixed: convert to boolean
        message: 'RTMP server is ' + (rtmpProcess ? 'running' : 'stopped')  // Fixed: proper check
    })
});

startRTMPServer();

app.listen(3000, ()=> {  // Fixed: use different port (3000) since FFmpeg uses 1935
    console.log('Status server running on http://localhost:3000/status');
    console.log('RTMP endpoint: rtmp://localhost:1935/stream');
});

process.on('SIGTERM', ()=> {
    if (rtmpProcess) rtmpProcess.kill();
    process.exit(0);
});

process.on('SIGINT', ()=> {
    if (rtmpProcess) rtmpProcess.kill();
    process.exit(0);
});