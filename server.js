"use strict";
const crypto = require("crypto");
const Hypercore = require("hypercore");
const Hyperbee = require("hyperbee");
const DHT = require("hyperdht");
const RPC = require("@hyperswarm/rpc");
const b4a = require("b4a");
const { validate, v4: uuidv4 } = require("uuid");

const BOOTSTRAP_PORT = 30002;
const SEED_LENGTH = 32;

class Server {
  constructor(nodeId) {
    this.core = null;
    this.bee = null;
    this.dht = null;
    this.rpc = null;
    this.rpcServer = null;
    this.connections = [];
    this.port = 40001;
    this.dbPath = `./db/${nodeId}/server`;
  }

  async initializeHyperbee() {
    this.core = new Hypercore(this.dbPath, { valueEncoding: "json" });
    this.bee = new Hyperbee(this.core, {
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });
    await this.bee.ready();
  }

  async initializeDHT() {
    let dhtSeed = (await this.bee.get("dht-seed"))?.value;
    if (!dhtSeed) {
      dhtSeed = crypto.randomBytes(SEED_LENGTH);
      await this.bee.put("dht-seed", dhtSeed);
    } else {
      dhtSeed = b4a.from(dhtSeed, "hex");
      dhtSeed = dhtSeed.slice(0, SEED_LENGTH);
    }

    const keyPair= DHT.keyPair(dhtSeed);

    this.dht = new DHT({
      port: this.port,
      keyPair,
      bootstrap: [{ host: "127.0.0.1", port: BOOTSTRAP_PORT }],
    });



    await new Promise((resolve) => {
      this.dht.once("ready", () => {
        console.log("[Server] DHT Connection ready");
        resolve();
      });
    });
  }

  async initializeRPC() {
    let rpcSeed = (await this.bee.get("rpc-seed"))?.value;
    if (!rpcSeed) {
      rpcSeed = crypto.randomBytes(SEED_LENGTH);
      await this.bee.put("dht-seed", rpcSeed);
    } else {
      rpcSeed = b4a.from(rpcSeed, "hex");
      if (rpcSeed.length !== SEED_LENGTH) {
        throw new Error(`RPC seed must be ${SEED_LENGTH} bytes long.`);
      }
    }

    this.rpc = new RPC({ seed: Uint8Array.from(rpcSeed), dht: this.dht });
    this.rpcServer = this.rpc.createServer();
    this.rpcServer.on("close", () => {
      console.log("[Server] RPC connection closed");
    });

    this.rpcServer.on("connection", (conn) => {
      // add client to connected clients list
      console.log(`[Server]: client connected`);

      this.connections.push(conn);
      console.log(`[Server] Total clients: ${this.connections.length}`);

      //Remove client form connected clients list
      conn.stream.on("close", () => {
        console.log(`[Server]: client disconnected`);
        this.connections = this.connections.filter((c) => c !== conn);
      });
    });

    await this.rpcServer.listen();
    console.log(`[Server] RPC listening`);
    console.log(`************************* PUBLICKEY ******************************`);
    console.log(`${b4a.toString(this.rpcServer.publicKey, "hex")}`);
    console.log(`******************************************************************`);

    // Announce the server under the topic
    const topic = Buffer.from("RPC_SERVER_TOPIC");
    this.dht.announce(topic, this.rpcServer._server._keyPair);

    // Announce periodically
    setInterval(() => {
      this.dht.announce(topic,  this.rpcServer._server._keyPair);
    }, 60000); // Announce every 60 seconds
}

  getPublicKeyHex() {
    return b4a.toString(this.rpcServer.publicKey, "hex");
  }
  getPublicKeyBuffer() {
    return this.rpcServer.publicKey;
  }

  eventsHandler() {
    // Event: open auction
    this.rpcServer.respond("openAuction", async (data) => {
        console.log('openAuction **************')
      try {
        const { id, description, priceInit } = JSON.parse(
          data.toString("utf-8")
        );
        console.log(id, description, priceInit);

        const auctionDetails = {
            description,
            priceInit,
            bids: [],
            createdAt: Date.now(),
        }
        await this.bee.put(id, auctionDetails);
        console.log(`[Server] Auction open ${description}: ${id}`);

        const auctionNotification = {
          id,
          description: description,
          startingPrice: priceInit,
          createdAt: auctionDetails.createdAt
      };

      // Announce open auction
        const auctionTopic = Buffer.from("NEW_AUCTION");
        await this.dht.announce(auctionTopic, Buffer.from(JSON.stringify(auctionNotification)));

        return Buffer.from(JSON.stringify({ success: true }), "utf-8");
      } catch (error) {
        console.error("[Server] Error openAuction:", error);
        return Buffer.from(
          JSON.stringify({ success: false, error: error.message }),
          "utf-8"
        );
      }
    });

    // Event: place bid
    this.rpcServer.respond("placeBid", async (data) => {
      try {
        const { id, bidder, amount } = JSON.parse(data.toString("utf-8"));
        const register = await this.bee.get(id);

        console.log(register)
        if (!register) {
          return Buffer.from(
            JSON.stringify({ success: false, error: "Auction not found" }),
            "utf-8"
          );
        }

        const highestBid = register.value.bids.reduce(
          (prev, curr) => (curr.amount > prev.amount ? curr : prev),
          { amount: register.value.priceInit }
        );

        if (amount <= highestBid.amount) {
          return Buffer.from(
            JSON.stringify({
              success: false,
              error: "The bid must be greater than current bid",
            }),
            "utf-8"
          );
        }

        register.value.bids.push({ bidder, amount, timestamp: Date.now() });

        await this.bee.put(id, register.value);

        console.log(
          `[Server] New bid: ${amount} by ${bidder} in auction ${id}`
        );

        return Buffer.from(JSON.stringify({ success: true }), "utf-8");
      } catch (error) {
        console.error("[Server] Error en placeBid:", error);
        return Buffer.from(
          JSON.stringify({ success: false, error: error.message }),
          "utf-8"
        );
      }
    });

    // Event: close auction
    this.rpcServer.respond("closeAuction", async (data) => {
      try {
        const { id } = JSON.parse(data.toString("utf-8"));
        const register = await this.bee.get(id);
        if (!register) {
          return Buffer.from(
            JSON.stringify({ success: false, error: "Auction not found" }),
            "utf-8"
          );
        }

        const highestBid = register.value.bids.reduce(
          (prev, curr) => (curr.amount > prev.amount ? curr : prev),
          { amount: 0 }
        );
        await this.bee.del(id);

        console.log(
          `[Server] Auction ${id} closed. Winner: ${highestBid.bidder} con ${highestBid.amount} USDt`
        );


        return Buffer.from(
          JSON.stringify({
            success: true,
            winner: highestBid.bidder,
            amount: highestBid.amount,
          }),
          "utf-8"
        );
      } catch (error) {
        console.error("[Server] Error closeAuction:", error);
        return Buffer.from(
          JSON.stringify({ success: false, error: error.message }),
          "utf-8"
        );
      }
    });

    this.rpcServer.respond("getOpenAuctions", async () => {
      try {
        const auctions = [];
        for await (const { key, value } of this.bee.createReadStream()) {
          if (validate(key.toString("utf-8")))
            auctions.push({ id: key.toString("utf-8"), data: value });
        }
        return Buffer.from(
          JSON.stringify({ success: true, auctions }),
          "utf-8"
        );
      } catch (error) {
        console.error("[Server] Error fetching open auctions:", error);
        return Buffer.from(
          JSON.stringify({ success: false, error: error.message }),
          "utf-8"
        );
      }
    });
  }


  async start() {
    try {
      console.log("[Server] Starting...");
      await this.initializeHyperbee();
      await this.initializeDHT();
      await this.initializeRPC();
      this.eventsHandler();
      console.log("[Server]: Started successfully!");
    } catch (error) {
      console.error("[Server] Error starting server:", error);
    }
  }
}
module.exports = Server;
