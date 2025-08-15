import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { parse } from 'url';

dotenv.config();

const wss = new WebSocketServer({
    port: 8080,
    verifyClient: (info)=> {
    const {query} = parse(info.req.url, true);
    
    // Debug logging
    console.log('Connection attempt:');
    console.log('  Role:', query.role);
    console.log('  Token:', query.token ? query.token.substring(0, 10) + '...' : 'undefined');
    console.log('  Expected sender token:', process.env.VITE_SENDER_KEY ? process.env.VITE_SENDER_KEY.substring(0, 10) + '...' : 'undefined');
    console.log('  Expected receiver token:', process.env.VITE_RECEIVER_KEY ? process.env.VITE_RECEIVER_KEY.substring(0, 10) + '...' : 'undefined');

    const validTokens = {
        'sender': process.env.VITE_SENDER_KEY,
        'receiver': process.env.VITE_RECEIVER_KEY
    };

    const isValid = (query.role==='sender' && query.token===validTokens['sender']) ||
                   (query.role==='receiver' && query.token===validTokens['receiver']);
    
    console.log('  Authentication result:', isValid);
    
    return isValid;
}
});
console.log('Server started!');

//Set of clients
const clients = new Map();

wss.on('connection', function connection(ws, req) {
    const {query} = parse(req.url, true);
    const clientRole = query.role;

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
