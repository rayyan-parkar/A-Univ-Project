import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { parse } from 'url';

dotenv.config();

const wss = new WebSocketServer({port: 8080})
console.log('Server started!');

const validTokens = {
    'sender': process.env.VITE_SENDER_KEY,
    'receiver': process.env.VITE_RECEIVER_KEY
};

//Map of clients
const clients = new Map();
let totalReceivers = 0;
const allowed_IPs = new Set([
    '::1',
    '::ffff:127.0.0.1'
]);

wss.on('connection', function connection(ws, req) {

    //console.log(!req.socket.remoteAddress in allowed_IPs);
    if (!(allowed_IPs.has(req.socket.remoteAddress))) {
        console.log(`${req.socket.remoteAddress} tried to connect.`);
        ws.close(1008, 'IP NOT WHITELISTED!');
        return;
    }

    ws.on('error', (error)=> {
        console.log(`ERROR: ${error.message}`);
        ws.close(1008, 'Violated message rules.')
    });

    const {query} = parse(req.url, true);
    const clientRole = query.role;

    //If Tokens are invalid, refuse connection.
    if (!(query.role==='sender' && query.token===validTokens['sender']) && !(query.role==='receiver' && query.token===validTokens['receiver'])) {
        console.log('Tokens are invalid, closing connection.')
        ws.close(1008, 'Invalid authentication');
        return;
    }

    if (totalReceivers===2 && query.role==='receiver') {
        console.log('Max receivers present, connection blocked!');
        ws.close(1008, 'Receiver limit reached!');
        return
    }

    if (query.role==='receiver') {
        totalReceivers+=1;
    }
    console.log('Current Receivers:', totalReceivers);

    //If tokens are valid, allow client to connect and add to map.
    console.log(`${clientRole} Connected!`);
    clients.set(ws, {role: clientRole, token: query.token});

    //Logs received data from sender.
    ws.on('message', function message(data) {

        const senderInfo = clients.get(ws);
        console.log('received: %s', data);

        //Sends message to sender.
        if (senderInfo.role==='sender') {
            clients.forEach((clientInfo, clientSocket)=> {
                if (clientInfo.role==='receiver' && clientSocket.readyState === 1) {
                    clientSocket.send(data.toString());
                    console.log('Sent to receiver:', data.toString());
                }
            });
        }
    });


    //Deals with client disconnecting.
    ws.on('close', () => {
        const clientInfo = clients.get(ws);
        clients.delete(ws);
        console.log(`${clientInfo?.role || 'Unknown'} disconnected`);

        if (clientRole==='receiver') {
            totalReceivers-=1;
            console.log('Current Receivers, after stopping connection:', totalReceivers);
        }
    });
});
