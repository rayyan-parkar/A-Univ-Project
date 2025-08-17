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

wss.on('connection', function connection(ws, req) {
    const {query} = parse(req.url, true);
    const clientRole = query.role;

    //If Tokens are invalid, refuse connection.
    if (!(query.role==='sender' && query.token===validTokens['sender']) && !(query.role==='receiver' && query.token===validTokens['receiver'])) {
        console.log('Tokens are invalid, closing connection.')
        ws.close(1008, 'Invalid authentication');
        return;
    }

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
    });
});
