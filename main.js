const Server = require('./server');
const Client = require('./client');
const { v4: uuidv4 } = require("uuid");

async function main() {

    const serverId = uuidv4();
    const server = new Server(serverId);
    await server.start();

    const client = new Client(server, serverId);
    await client.start();


}

main();