import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { parse } from 'url';
 
// Configure environment variables
dotenv.config();

// Start a new websocket server at port 8080 (Standard for Websockets)
const wss = new WebSocketServer({port: 8080})
console.log('Server started!');

// Get the Sender Key and Receiver Key to ensure token validation
const validTokens = {
    'sender': process.env.VITE_SENDER_KEY,
    'receiver': process.env.VITE_RECEIVER_KEY
};

//Create a new map to store clients
const clients = new Map();
let totalReceivers = 0;

wss.on('connection', function connection(ws, req) {

    ws.on('error', (error)=> {
        console.log(`ERROR: ${error.message}`);
        ws.close(1008, 'Violated message rules.')
    });

    // Parse string connecting to the server to find client role and the provided key
    const {query} = parse(req.url, true);
    const clientRole = query.role;

    //If Tokens are invalid, refuse connection.
    if (!(query.role==='sender' && query.token===validTokens['sender']) && !(query.role==='receiver' && query.token===validTokens['receiver'])) {
        console.log('Tokens are invalid, closing connection.')
        ws.close(1008, 'Invalid authentication');
        return;
    }

    // If 2 clients are already connected, refuse all further connections (Can be increased or disabled as required.)
    if (totalReceivers===2 && query.role==='receiver') {
        console.log('Max receivers present, connection blocked!');
        ws.close(1013, 'Receiver limit reached!');
        return
    }

    // Update Receiver count
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

        //Sends messages received from sender to receiver
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
