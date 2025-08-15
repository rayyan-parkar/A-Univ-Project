import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({port: 8080})
console.log('Server started!');

//Set of clients
const clients = new Set();

wss.on('connection', function connection(ws) {
    console.log('New Client Connected!');
    clients.add(ws);

    //Logs received data from sender.
    ws.on('message', function message(data) {
        console.log('received: %s', data);

        //Sends message to every client other than current. 
        clients.forEach(client => {
            if (client!==ws && client.readyState === 1) {
                client.send(data.toString());
            }
        });
    });


    //Deals with client disconnecting.
    wss.on('close', () => {
        clients.delete(ws);
        console.log('Client disconnected')
    });
});
