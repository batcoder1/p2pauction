# P2P Auction System

This is a peer-to-peer auction system built using hypercore, hyperbee, hyperswarm, and @hyperswarm/rpc. The system allows users to connect as clients and perform various actions like creating auctions, bidding on images, and closing auctions.


## Requirements
### Dependencies

This project requires the following Node.js dependencies:

* hypercore: Manages an append-only log for storage.
* hyperbee: A B-tree database engine for storing and retrieving auction data.
* hyperdht: Manages the DHT (Distributed Hash Table) network.
* @hyperswarm/rpc: Handles RPC communications between nodes.
* uuid: Generates unique identifiers for auctions.

## Instalation

### 1. Install Dependencies

   ```bash
   npm install
   ```
### 2. Run your first and boostrap node:

   ```bash
    hyperdht --bootstrap --host 127.0.0.1 --port 30002
   ```
### 3. Run
  #### a. Run peer without connection to another peer (run server only)
   ```bash
    npm start
   ```

## Project Structure
The project consists of the following main files:

* **server.js**: Runs the server, listens for client requests, and manages the auctions.
* **client.js**: Runs the client, connects to the server to interact with auctions.
* **main.js**: Start server and client in the peer.
* **database**: Managed via hyperbee and hypercore, where auction data is stored.

## System Overview
### Server (server.js)

The server is the core of the auction system. It uses hyperbee to manage the database and @hyperswarm/rpc to allow multiple clients to connect and participate in auctions.

	1.	Auction Creation: The server can open new auctions when requested by a client. Each auction is stored in the database using a UUID v4 as a unique identifier.
	2.	Client Notifications: The server can send notifications to all connected clients through the notifyAllClients function to inform them about the state of the auctions (e.g., when an auction closes or a new bid is placed).

### Client (client.js)

Clients can connect to the server and perform various actions, such as:

	1.	Create an Auction: A client can start an auction by providing a description and a starting price.
	2.	Place a Bid: Clients can participate in active auctions by bidding on images.
	3.	Close an Auction: A client can close an auction, ending the bidding process.
	4.	Receive Notifications: Clients receive real-time notifications about the auctions they are connected to.

### RPC Communication

* We use @hyperswarm/rpc to manage communication between clients and the server. Each client connects to the server using its public key (publicKey) and can send requests to perform actions related to auctions.
* When clients send requests (such as to create an auction or place a bid), a temporary connection is established with the server, and then closed after receiving the response.

### Auction Validation

To ensure auctions have a valid unique identifier, we use uuidv4. When a client creates an auction, the server generates a UUID v4 as its ID. This guarantees that there are no collisions between different auctions.

### Database with Hyperbee

All auctions are stored in hyperbee, which operates on top of hypercore. The unique IDs (UUIDs) are used as keys to identify each auction in the database. To retrieve all active auctions, the server reads all entries from the database and sends them to the clients upon request.

### Closing the Client

When the client selects option 0 to exit, the Node.js process is terminated using process.exit(0) to ensure that the client shuts down properly:
```bash
case 0:
    console.log("Exiting the auction client.");
    process.exit(0);
```

### Notifications

The server can notify all connected clients using the notifyAllClients method. This function broadcasts notifications about auction-related events (e.g., new bids, auction closure) to all clients:
```bash
async notifyAllClients(type, message) {
    const notificationPayload = JSON.stringify({ type, message });
    for (const conn of this.connections) {
        conn.write(Buffer.from(notificationPayload));
    }
}
```

### Next Steps

* Improve the security of the auction system, such as by adding encryption to the communication.
* Implement a client authentication system to verify user identities before allowing them to interact with the server.
* Add a graphical user interface (GUI) to enhance the user experience.

