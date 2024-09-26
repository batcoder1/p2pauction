"use strict";

const crypto = require("crypto");
const Hypercore = require("hypercore");
const Hyperbee = require("hyperbee");
const DHT = require("hyperdht");
const RPC = require("@hyperswarm/rpc");
const readline = require("readline");
const b4a = require("b4a");
const { v4: uuidv4 } = require("uuid");
const AuctionServer = require("./server");

const BOOTSTRAP_PORT = 30002;
const SEED_LENGTH = 32;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Function to ask questions in the terminal
const askQuestion = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

class Client {
  constructor(server, serverId) {
    this.core = null;
    this.bee = null;
    this.dht = null;
    this.rpc = null;
    this.connected = false;
    this.client = null;
    this.port = 50001;
    this.server = server;
    this.dbPath = `./db/${serverId}/client`;
  }
  async initializeHyperbee() {
    this.core = new Hypercore(this.dbPath);
    this.bee = new Hyperbee(this.core, {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });
    await this.bee.ready();
  }

  async initializeDHT() {
    let dhtSeed = (await this.bee.get("dht-seed"))?.value;
    if (!dhtSeed) {
      dhtSeed = crypto.randomBytes(SEED_LENGTH);
      await this.bee.put("dht-seed", dhtSeed);
    }

    this.dht = new DHT({
      port: this.port,
      keyPair: DHT.keyPair(dhtSeed),
      bootstrap: [{ host: "127.0.0.1", port: BOOTSTRAP_PORT }],
    });

    await new Promise((resolve) => {
      this.dht.once("ready", () => {
        console.log("[Client] DHT Connection ready");
        resolve();
      });
    });
  }

  async initializeRPC() {
    this.rpc = new RPC({ dht: this.dht });
    console.log("[Client] RPC initialized");

    const peerPublicKeyBuffer =this.server.getPublicKeyBuffer()
    this.client = this.rpc.connect(peerPublicKeyBuffer);

  }

  async run() {
    try {
      let clientName;
      while(!clientName){
        clientName = await askQuestion("Enter your name: ");
      }

      while (true) {
        const action = await askQuestion(
          "SERVER PUBLICKEY: " + this.server.getPublicKeyHex() +"\n"+
          "Choose option:\n" +
            "1 - Create an auction\n" +
            "2 - Bid for a pic\n" +
            "3 - Close auction\n" +
            "4 - List open auctions\n" +
            "0 - Exit\n"
        );

        switch (Number(action)) {
          case 1:
            await this.createAuction();
            break;
          case 2:
            await this.bidForPic(clientName);
            break;
          case 3:
            await this.closeAuction();
            break;
          case 4:
            await this.listOpenAuctions();
            break;
          case 0:

            this.rpc.destroy(this.server.getPublicKeyBuffer());
            this.peerPublicKeyBuffer = null;
            console.log("Exiting the auction client.");
            return;
          default:
            console.log("Invalid option. Please choose again.");
        }
      }
    } catch (error) {
      console.error("Error during RPC operations:", error);
    } finally {
      await this.rpc.destroy();
      await this.dht.destroy();
      rl.close();
      process.exit(0);
    }
  }

  async connectAndRequest(peerPublicKeyBuffer,action, payload){
    this.client = this.rpc.connect(peerPublicKeyBuffer); //Connect before request

    return await this.rpc.request(
      peerPublicKeyBuffer,
      action,
      Buffer.from(JSON.stringify(payload), "utf-8")
    );
  }


  async createAuction() {
    const auctionId = uuidv4().toString();
    const peerPublicKeyBuffer =this.server.getPublicKeyBuffer()

    let picName;
    let priceInit;

    while(!picName){
      picName = await askQuestion("Enter the pic name: ");

    }
    while(!priceInit){
     priceInit = await askQuestion(
        "Enter the starting price: "
      );
    }
    const openAuctionPayload = {
      id: auctionId,
      description: picName,
      priceInit: parseFloat(priceInit),
    };

    try {
      const resp = await this.connectAndRequest(
        peerPublicKeyBuffer,
        "openAuction",
        openAuctionPayload
      );
      console.log("Open Auction Response:",JSON.parse(resp.toString("utf-8")));
    } catch (error) {
      console.error("Error opening auction, please try again", error);
    }
  }

  async bidForPic(clientName) {
    const peerPublicKey = await askQuestion("Enter the node publicKey: ");
    const peerPublicKeyBuffer = b4a.from(peerPublicKey, 'hex')
    const auctionId = await askQuestion("Enter the auctionId: ");
    const bidAmount = await askQuestion("Enter your bid amount: ");
    const placeBidPayload = {
      id: auctionId,
      bidder: clientName,
      amount: parseFloat(bidAmount),
    };

    try {
      const resp = await this.connectAndRequest(
        peerPublicKeyBuffer,
        "placeBid",
        placeBidPayload
      );

      console.log(
        "Place Bid Response:",
        JSON.parse(resp.toString("utf-8"))
      );
    } catch (error) {
      console.error("Error placing bid, trying again in 2 seconds");
      setTimeout(async () => {
        try {
          const resp = await this.connectAndRequest(
            peerPublicKeyBuffer,
            "closeAuction",
            placeBidPayload
          );
          console.log("Close Auction Response:",JSON.parse(resp.toString("utf-8")));
        } catch (error) {
          console.error("Error closing auction");
        }
      }, 2000);
    }
  }

  async closeAuction() {
    const peerPublicKeyBuffer = this.server.getPublicKeyBuffer();
    let auctionId;
    while(!auctionId){
      auctionId = await askQuestion("Enter the auctionId: ");
    }
    const closeAuctionPayload = { id: auctionId };
    try {

      const resp = await this.connectAndRequest(
        peerPublicKeyBuffer,
        "closeAuction",
        closeAuctionPayload
      );
      console.log("Close Auction Response:",JSON.parse(resp.toString("utf-8")));
    } catch (error) {
      console.error("Error closing auction, trying again in 2 seconds");
      setTimeout(async () => {
        try {
          const resp = await this.connectAndRequest(
            peerPublicKeyBuffer,
            "closeAuction",
            closeAuctionPayload
          );
          console.log("Close Auction Response:",JSON.parse(resp.toString("utf-8")));
        } catch (error) {
          console.error("Error closing auction");
        }
      }, 2000);

    }
  }

  async listOpenAuctions() {
    try {
      const peerPublicKey = await askQuestion("Enter the node publicKey: ");
      const peerPublicKeyBuffer = b4a.from(peerPublicKey, 'hex')

      const responseRaw = await this.connectAndRequest(
        peerPublicKeyBuffer,
        "getOpenAuctions",
        ""
      );
      const response = JSON.parse(responseRaw.toString("utf-8"));
      if (response.success) {
        console.log('AUCTIONS');
        let highestBid = null;

        response.auctions.forEach((auction) => {
          console.log(auction.data.bids)
          if (auction.data.bids && auction.data.bids.length > 0) {
            highestBid = auction.data.bids.reduce((max, bid) => bid.amount > max.amount ? bid : max, auction.data.bids[0]);
          }
          console.log('highest', highestBid)
          const auctionDetails = {
            Id: auction.id,
            Description: auction.data.description,
            'Initial Price': `${auction.data.priceInit} USDt`,
            'Highest Bid': highestBid ? highestBid.amount : 'N/A',
            'Highest Bidder': highestBid ? highestBid.bidder : 'N/A',
          };

          console.table([auctionDetails]);
        });
      } else {
        console.log("Error fetching auctions:", response.error);
      }
    } catch (error) {
      console.error("Error fetching open auctions, please wait and try again", error);
    }
  }

  async listenForAuctions()  {
    const auctionTopic = Buffer.from("NEW_AUCTION");

    const lookupStream = this.dht.lookup(auctionTopic);

    lookupStream.on("data", (info) => {
        console.log("********** Auction notification ****************");
      console.log(info)
        for (const peer of info.peers) {
            console.log(`New auction notification from: ${b4a.toString(peer.publicKey, 'hex')}`);
        }
    });
};



  handleNotification(type, message) {
    switch (type) {
      case "auctionOpen":
        console.log(`[Client] Notification: Auction Open - ${message}`);
        break;
      case "newBid":
        console.log(`[Client] Notification: New Bid - ${message}`);
        break;
      case "auctionClosed":
        console.log(`[Client] Notification: Auction Closed - ${message}`);
        break;
      default:
        console.log(`[Client] Unknown Notification Type: ${type}`);
    }
  }

  async start() {
    try {
      console.log("[Client] Starting...");
      await this.initializeHyperbee();
      await this.initializeDHT();
      await this.initializeRPC();
      await this.listenForAuctions();
      await this.run();
    } catch (error) {
      console.error("[Server] Error starting client:", error);
    }
  }
}
module.exports = Client;
