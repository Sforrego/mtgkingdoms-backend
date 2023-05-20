require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');

const app = express();

const clientId = process.env.MTGKINGDOMS_CLIENT_ID;
const tenantId = process.env.MTGKINGDOMS_TENANT_ID;

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
       origin: "http://localhost:3000",
       methods: ["GET", "POST"],
       allowedHeaders: ["my-custom-header"],
       credentials: true
    }
});

let rooms = {};

io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
    const roomCode = Object.keys(socket.rooms)[0];
    if(rooms[roomCode]) {
    rooms[roomCode] = rooms[roomCode].filter(id => id !== socket.id);
    if (rooms[roomCode].length === 0) {
      delete rooms[roomCode];
    }}
  });

  socket.on('error', (error) => {
    console.log('Socket error:', error);
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
    if (rooms[roomCode] && rooms[roomCode].length < 8) {
      socket.join(roomCode);
      rooms[roomCode].push(userId);
      socket.emit('joinedRoom', { roomCode, users: rooms[roomCode] }); 
      console.log(`User ${userId} has joined the room ${roomCode}`);
    } else if (rooms[roomCode] && rooms[roomCode].length >= 8) {
      socket.emit('error', 'Room is full');
    } else {
      socket.emit('error', 'Room does not exist.');
    }
  });
});

// Function to generate a room code
function generateRoomCode() {
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let result = '';
for (let i = 0; i < 6; i++) {
  result += characters.charAt(Math.floor(Math.random() * characters.length));
}
return result;
}

server.listen(9998, () => console.log('Listening on port 9998'));

