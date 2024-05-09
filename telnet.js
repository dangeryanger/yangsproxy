//
// Telnet/Socket
//
const net = require('net');

class TelnetProxy {
    #server;
    #listener;
    #incoming;
    #outgoing;
    #clientDisconnect;
    #msgFormat = '\u001B[1;37;44m';
    #reset = '\u001B[0m';
    #serverWrite;
    #clientWrite;
    #connectTimeout;
    
    set onIncoming(callback) { this.#incoming = callback; }
    set onOutgoing(callback) { this.#outgoing = callback; }
    set onClientsDisconnected(callback) { this.#clientDisconnect = callback; }
    set onServerWrite(callback) { this.#serverWrite = callback; }
    set onClientWrite(callback) { this.#clientWrite = callback; }
    
    constructor(listenPort, host, port) {
        console.log(listenPort, host, port);
        this.listenPort = listenPort;
        this.host = host;
        this.port = port;
        this.#listener = net.createServer();
        this.#listener.connections = [];

        this.#listener.on('connection', (socket) => {
            socket.setNoDelay(true);
            
            if (this.#listener.connections.length == 0) {
                this.#connectServer();
            }
            
            this.#listener.connections.push(socket);

            socket.on('data', (data) => {
                let processed;

                // some clients like linux terminal add a 0x00 at the end
                if (data && data[data.length - 1] == 0x00) {
                    data = data.subarray(0, -1);
                }

                /*
                if (processed = this.#handleOutgoing(data)) {
                    this.#writeServer(processed);
                }
                */

                for (let processed of this.#handleOutgoing(data)) {
                    if (processed) this.#writeServer(processed);
                }
            });
            
            socket.on('error', (err) => {
                console.error('Client connection error: ', err);
                socket.end();
            });
            
            socket.on('end', () => {
                console.log('Client disconnected.');
                this.#closeClient(socket);
            });
            
            socket.on('close', (hadError) => {
                this.#closeClient(socket);
            });
        });
        
        this.#listener.listen(this.listenPort, () => {
            console.log(`Server listening on port ${this.listenPort}`);
        });
    }
    
    #closeClient(socket) {
        this.#listener.connections = this.#listener.connections.filter((conn) => conn !== socket);
                
        if (this.#listener.connections.length == 0 && this.#server) {
            this.#server.destroy();
            this.#server = null;

            if (this.#clientDisconnect) {
                this.#clientDisconnect();
            }
        }
    }
    
    #connectServer() {
        this.#server = new net.Socket();
        this.#server.setNoDelay(true);

        clearTimeout(this.#connectTimeout);

        try
        {
            this.#server.connect(this.port, this.host, () => {
                console.log(`Connected to telnet server ${this.host}:${this.port}`);
            });
        } catch(e) {
            this.writeMessage(e);
            this.#retryConnection();
        }
        
        this.#server.on('data', (data) => {
            for (let processed of this.#handleIncoming(data)) {
                this.#writeClients(processed);
            }
        });
        
        this.#server.on('error', (error) => {
            console.error('Connection error:', error);
            this.#server = null;
            this.#disconnectClients();
            this.#retryConnection();
        });
        
        this.#server.on('connectionError', (error)=> {
            this.#server = null;
            this.#disconnectClients();
            this.#retryConnection();
        });
    }
    
    #retryConnection() {
        this.#connectTimeout = setTimeout(() => {
            this.#connectServer();
        }, 5000);
    }
    
    #disconnectClients() {
        this.#listener.connections.forEach((conn) => {
            conn.destroy();
        });
    }
    
    *#handleIncoming(data) {
        if (this.#incoming) {
            for (let each of this.#incoming(data)) {
                yield each;
            }
        } else {
            yield data;
        }
    }
    
    *#handleOutgoing(data) {
        if (this.#outgoing) {
            for (let each of this.#outgoing(data)) {
                yield each;
                //data = this.#outgoing(data);
            }
        } else {
            yield data;
        }

    }
    
    #writeServer(data) {
        if (this.#serverWrite) {
            data = this.#serverWrite(data);
        }
        
        if (this.#server && data) {
            this.#server.write(data);
        }
    }
    
    #writeClients(data) {
        if (this.#clientWrite) {
            data = this.#clientWrite(data);
        }
        
        if (data) {
            this.#listener.connections.forEach((client) => {
                client.write(data);
            });
        }
    }
    
    writeServerLine(data) {
        this.#writeServer(data + '\r\n');
    }

    writeServer(data) {
        this.#writeServer(data);
    }
    
    writeClients(data) {
        this.#writeClients(data);
    }

    writeMessage(msg) {
        let output = Array.isArray(msg) ? msg : [msg];
        
        this.writeClients('\r\n');
        output.forEach((line) => {
            this.#writeClients(this.#msgFormat + '[' + line + ']' + this.#reset + '\r\n');
        });
    }
}

if (require.main === module) {
    console.log('telnet running directly');
    var proxy = new TelnetProxy(30000, 'mud.paramud.com', 2427);
}

module.exports = TelnetProxy;