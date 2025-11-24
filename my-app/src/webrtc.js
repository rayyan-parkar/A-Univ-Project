import express from 'express';
import { spawn } from 'child_process';

const app = express();

let rtmpProcess = null;

// Start simple RTMP server with FFMPEG
function startRTMPServer() {
    console.log('Starting RTMP server...');

    //Spawn an FFmpeg process
    rtmpProcess = spawn('ffmpeg', [
        '-f', 'flv', // Tell FFmpeg that input format is flash video (flv).
        '-listen', '1', // Puts FFmpeg in server mode
        '-i', 'rtmp://0.0.0.0:1935/stream', // Input source
        '-c', 'copy', // Copy codec mode, is the fastest option
        '-f', 'null', // Output format is null.
        '-' // Output to stdout, but null here for testing
    ]);

    rtmpProcess.stdout.on('data', (data)=> {
        console.log('FFmpeg stdout:', data.toString());
    });

    rtmpProcess.stderr.on('data', (data)=>{
        console.log(data.toString());
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
        rtmpServerRunning: !!rtmpProcess,
        message: 'RTMP server is ' + (rtmpProcess ? 'running' : 'stopped')
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