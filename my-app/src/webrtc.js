import NodeMediaServer from 'node-media-server';

const config = {
    rtmp: {
        port: 1935, // Default port for rtmp
        chunk_size: 60000, // Leave default unless necessary later
        gop_cache: true, // group of pictures (related to compression), allows better rewind and skip and easier for users to join
        ping: 30, // (pings user every 30s)
        ping_timeout: 90, // times user out if no response in 90s
    },

    https: {
        port: 8443,
        key: './key.pem',
        cert: './cert.pem',
    },

    webrtc: {
        port: 8443,// runs on the same port as https
        api: true,
        allow_origin: '*',
    }
};

const nms = new NodeMediaServer(config);
nms.run();