require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');
const { TableClient } = require("@azure/data-tables");

const app = express();

const clientId = process.env.MTGKINGDOMS_CLIENT_ID;
const tenantId = process.env.MTGKINGDOMS_TENANT_ID;
const storageConnectionString = process.env.MTGKINGDOMS_STORAGE_CONNECTION_STRING;
const port = process.env.PORT || 9998; // for local development

console.log(storageConnectionString);
// Middleware for validating JWTs
const checkJwt = jwt({
    // Provide a signing key based on the key identifier in the header and the signing keys provided by your Azure AD B2C endpoint.
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://MTGKingdoms.b2clogin.com/MTGKingdoms.onmicrosoft.com/B2C_1_signupsignin/discovery/v2.0/keys`,
    }),
    // Validate the audience (your application ID) and the issuer.
    audience: clientId,
    issuer: `https://MTGKingdoms.b2clogin.com/${tenantId}/v2.0/`,
    algorithms: ['RS256'],
});

app.use(checkJwt);

const server = http.createServer(app);
const io = socketIo(server, {
    cors:{
       origin: ["http://localhost:3000", "https://agreeable-river-08f60e510.3.azurestaticapps.net"],
       methods: ["GET", "POST"],
       allowedHeaders: ["my-custom-header"],
       credentials: true
    }
});

let rooms = {};

io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Modify the 'disconnect' event
  socket.on('disconnect', () => {
    console.log(`User ${socket.id} disconnected`);

    // Iterate over each room
    for (let roomCode in rooms) {
      // If the disconnected socket was in this room
      if (rooms[roomCode].includes(socket.id)) {
        // Remove the socket from the room
        rooms[roomCode] = rooms[roomCode].filter(id => id !== socket.id);

        // Inform other clients in the room that this client has left
        socket.to(roomCode).emit('userLeftRoom', { roomCode, users: rooms[roomCode] });
      }
    }
  });

  socket.on('error', (error) => {
    console.log('Socket error:', error);
  });

  socket.on('getRoles', async () => {
    let roles = [];
    let specificOrder = ["Monarch", "Knight", "Bandit", "Renegade", "Noble", "SubRole"];

    console.log("Getting roles");
    try {
      client = TableClient.fromConnectionString(storageConnectionString, "Roles");
      const entities = client.listEntities();
    
      for await (const entity of entities) {
        const role = {
          Name: entity.partitionKey,
          Type: entity.rowKey,
          Image: entity.ImageUrl,
          Ability: entity.Ability
        };
        // console.log(role);
        roles.push(role);
      }

      roles.sort((a, b) => {
        return specificOrder.indexOf(a.Type) - specificOrder.indexOf(b.Type);
      });
    } catch (error) {
      console.log('Error occurred: ', error);
      return;
    }

    // send the roles back to the client
    socket.emit('rolesData', roles);
  });

  // Implement 'create' event
  socket.on('create', ({ userId }) => {
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (rooms[roomCode]);
    socket.join(roomCode);
    rooms[roomCode] = [userId];
    socket.emit('roomCreated', { roomCode, users: rooms[roomCode]}); // Send the room code back to the client
    console.log(`User ${userId} has created the room ${roomCode}`)
  });
  
  socket.on('join', ({ userId, roomCode }) => {
    if(rooms[roomCode]) {
      rooms[roomCode].push(userId);
      socket.join(roomCode);
      socket.emit('joinedRoom', { roomCode, users: rooms[roomCode] }); // Confirm the join event to the joining client
      socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: rooms[roomCode] }); // Inform all other clients in the room
      console.log(`User ${userId} has joined the room ${roomCode}`);
    } else {
      socket.emit('error', 'Room does not exist.'); // Send an error message back to the client
    }
  });

  // Implement 'leave' event
  socket.on('leave', ({ userId, roomCode }) => {
    if (rooms[roomCode]) {
      // Remove the user from the room
      rooms[roomCode] = rooms[roomCode].filter(id => id !== userId);

      // Leave the room in socket.io
      socket.leave(roomCode);

      // Inform the client they've left the room
      socket.emit('leftRoom', { roomCode, userId });

      // Inform other clients in the room that this client has left
      socket.to(roomCode).emit('userLeftRoom', { roomCode, users: rooms[roomCode] });
    }
  });
});

// Function to generate a room code
const generateRoomCode = () =>
  Math.random().toString(36).substring(6).toUpperCase();

server.listen(port, () => console.log(`Listening on port ${port}`));

