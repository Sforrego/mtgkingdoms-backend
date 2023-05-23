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

let rolesCache = [];

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

// app.use(checkJwt);

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
let users = {};

io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('login', ({ userId, username }) => {
    // If the user is already logged in, update their socket ID
    if (users[userId]) {
      users[userId].socketId = socket.id;
      users[userId].username = username;
    } else {
      // Otherwise, add the user to the users object
      users[userId] = { socketId: socket.id, username: username };
    }
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.id} disconnected`);

    // Iterate over each room
    for (let roomCode in rooms) {
      let room = rooms[roomCode];

      // Iterate over each user in the room
      for (let userId in room.users) {
        // If the disconnected socket was this user
        if (room.users[userId].socketId === socket.id) {
          
          // Remove the user from the room
          delete room.users[userId];

          // Inform other clients in the room that this client has left
          socket.to(roomCode).emit('userLeftRoom', { roomCode, users: room.users });

          // If there are no users left in the room, delete the room
          if (Object.keys(room.users).length === 0) {
            delete rooms[roomCode];
          }

          break;
        }
      }
    }

    // Remove the user from the global users list
    let userId = Object.keys(users).find(userId => users[userId].socketId === socket.id);
    if (userId) {
      delete users[userId];
    }
});


  socket.on('error', (error) => {
    console.log('Socket error:', error);
  });

  socket.on('getRoles', async () => {
    // send the roles back to the client
    socket.emit('rolesData', rolesCache);
  });

  // Implement 'create' event
  socket.on('create', ({ userId }) => {
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (rooms[roomCode]);
    socket.join(roomCode);
    let user = users[userId];
    rooms[roomCode] = {
      users: {
        [userId]: {
          socketId: user.socketId,
          username: user.username,
          role: null,
          isRevealed: false
        }
      },
      hasStarted: false,
      lastGameRoles: [],
      lastMonarchUserId: null
    };
    socket.emit('roomCreated', { roomCode, users: rooms[roomCode].users }); // Send the room code back to the client
    console.log(`User ${userId} has created the room ${roomCode}`)
  });

  socket.on('join', ({ userId, roomCode }) => {
    if(rooms[roomCode]) {
      if(rooms[roomCode].hasStarted){
        socket.emit('error', 'Game has already started')
      }
      socket.join(roomCode);
      let user = users[userId];
      rooms[roomCode].users[userId] = {
        socketId: user.socketId,
        username: user.username,
        role: null,
        isRevealed: false
      };
      socket.emit('joinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users, userId) }); // Confirm the join event to the joining client
      socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users, null) }); // Inform all other clients in the room
      console.log(`User ${userId} has joined the room ${roomCode}`);
    } else {
      socket.emit('error', 'Room does not exist.'); // Send an error message back to the client
    }
  });

  // Implement 'leave' event
  socket.on('leave', ({ userId, roomCode }) => {
    if (rooms[roomCode]) {
      // Remove the user from the room
      delete rooms[roomCode].users[userId];

      // Leave the room in socket.io
      socket.leave(roomCode);

      // Inform the client they've left the room
      socket.emit('leftRoom', { roomCode, userId });

      // Inform other clients in the room that this client has left
      socket.to(roomCode).emit('userLeftRoom', { roomCode, users: rooms[roomCode].users });
    }
  });

  socket.on('startGame', ({ roomCode }) => {
    if(rooms[roomCode] && Object.keys(rooms[roomCode].users).length >= 4) {
      let gameRoles = assignRoles(Object.keys(rooms[roomCode].users).length, roomCode);
      let shuffledUsers = shuffleUsers([...Object.keys(rooms[roomCode].users)]); // Create a copy and shuffle users excluding lastMonarchUserId
      shuffledUsers.forEach((userId, index) => {
        users[userId].role = gameRoles[index];
        io.to(users[userId].socketId).emit('roleAssigned', { role: gameRoles[index] });
        if(gameRoles[index].roleType === "Monarch") {
          rooms[roomCode].lastMonarchUserId = userId;
        }
      });
      rooms[roomCode].hasStarted = true;
      io.to(roomCode).emit('gameStarted', { users: sanitizeUserData(rooms[roomCode].users, null) });
    } else {
      socket.emit('error', 'Not enough players to start a game.'); 
    }
  });
});

function sanitizeUserData(users, userId) {
  return Object.keys(users).map(id => {
    const { role, ...sanitizedUser } = users[id];
    if (id === userId) {
      sanitizedUser.role = role;
    }
    else if (isRevealed){
      sanitizedUser.role = role;
    }
    return sanitizedUser;
  });
}

function shuffleUsers(users) {
  let otherUsers = users.filter(userId => userId !== lastMonarchUserId);
  let shuffledOtherUsers = shuffleArray([...otherUsers]);
  if(lastMonarchUserId !== null && users.includes(lastMonarchUserId)) {
    shuffledOtherUsers.push(lastMonarchUserId);
  }
  return shuffledOtherUsers;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function assignRoles(numPlayers, roomCode) {
  // Define the order of role assignments based on the number of players
  const roleOrder = ["Monarch", "Bandit", "Bandit", "Knight", "Renegade", "Noble", "Noble", "Bandit"];
  
  // Get the roles needed for the current game
  let neededRoles = roleOrder.slice(0, numPlayers);

  // Create an array to hold the assigned roles
  let assignedRoles = [];

  // Assign the roles
  for (let roleType of neededRoles) {
    // Get the potential roles of the current type that weren't used in the last game
    let potentialRoles = roleCache
      .filter(role => role.Type === roleType && !rooms[roomCode].lastGameRoles.includes(role.Name))
      .map(role => role.Name);

    // If there are no potential roles, then allow roles from the last game
    if (potentialRoles.length === 0) {
      potentialRoles = roleCache
        .filter(role => role.Type === roleType)
        .map(role => role.Name);
    }

    // Choose a random role from the potential roles
    let chosenRole = potentialRoles[Math.floor(Math.random() * potentialRoles.length)];
    
    // Add the role to the assigned roles
    assignedRoles.push({roleName: chosenRole, roleType: roleType});
  }

  // Save the assigned roles for the next game
  lastGameRoles = assignedRoles.map(role => role.roleName);

  return assignedRoles;
}

// Function to generate a room code
const generateRoomCode = () =>
  Math.random().toString(36).substring(6).toUpperCase();

  async function loadRoles() {
    try {
      const client = TableClient.fromConnectionString(storageConnectionString, "Roles");
      const entities = client.listEntities();
      rolesCache = []; // Empty the cache
  
      for await (const entity of entities) {
        const role = {
          Name: entity.partitionKey,
          Type: entity.rowKey,
          Image: entity.ImageUrl,
          Ability: entity.Ability
        };
        rolesCache.push(role);
      }
  
      rolesCache.sort((a, b) => {
        const specificOrder = ["Monarch", "Knight", "Bandit", "Renegade", "Noble", "SubRole"];
        return specificOrder.indexOf(a.Type) - specificOrder.indexOf(b.Type);
      });
  
      console.log('Roles loaded into cache');
    } catch (error) {
      console.log('Error occurred while loading roles: ', error);
    }
  }

loadRoles()

server.listen(port, () => console.log(`Listening on port ${port}`));

