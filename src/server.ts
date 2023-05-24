import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import {Server} from 'socket.io';
import jwksRsa from 'jwks-rsa';
import { expressjwt as jwt } from 'express-jwt';
import { TableClient } from '@azure/data-tables';

dotenv.config();
const app = express();

const clientId = process.env.MTGKINGDOMS_CLIENT_ID;
const tenantId = process.env.MTGKINGDOMS_TENANT_ID;
const storageConnectionString: string = process.env.MTGKINGDOMS_STORAGE_CONNECTION_STRING!;
const port = process.env.PORT || 9998; // for local development

interface Role {
  name?: string;
  type?: string;
  ability?: string;
  image?: string;
}

interface User {
  socketId: string;
  userId: string;
  username: string;
  role?: Role;
  isRevealed?: boolean;
  isConnected: boolean;
  roomCode?: string;
}

interface SanitizedUser extends Omit<User, 'role'> {
  role?: Role;
}

interface Room {
  users: { [userId: string]: User };
  hasActiveGame: boolean;
  previousMonarchUserId?: string;
  previousGameRoles?: Role[];
  gameStartedAt?: Date;
}

let rolesCache: Role[] = [];
let rooms: { [roomCode: string]: Room } = {};
let users: { [userId: string]: User } = {};

console.log(storageConnectionString);
// Middleware for validating JWTs
// const checkJwt = jwt({
//     // Provide a signing key based on the key identifier in the header and the signing keys provided by your Azure AD B2C endpoint.
//     secret: jwksRsa.expressJwtSecret({
//       cache: true,
//       rateLimit: true,
//       jwksRequestsPerMinute: 5,
//       jwksUri: `https://MTGKingdoms.b2clogin.com/MTGKingdoms.onmicrosoft.com/B2C_1_signupsignin/discovery/v2.0/keys`,
//     }),
//     // Validate the audience (your application ID) and the issuer.
//     audience: clientId,
//     issuer: `https://MTGKingdoms.b2clogin.com/${tenantId}/v2.0/`,
//     algorithms: ['RS256'],
// });

// app.use(checkJwt);

const server = http.createServer(app);
const io = new Server(server, {
    cors:{
       origin: ["http://localhost:3000", "https://agreeable-river-08f60e510.3.azurestaticapps.net"],
       methods: ["GET", "POST"],
       allowedHeaders: ["my-custom-header"],
       credentials: true
    }
});

io.on('connection', (socket) => {
  console.log('New client connected');


  socket.on('login', ({ userId, username }) => {
    console.log(`User ${userId} with socketId ${socket.id} logged in`)
    // If the user had previously logged in, update their socket ID
    console.log(users);
    if (users[userId]) {
      console.log("in users");
      let user: User = users[userId];
      user.socketId = socket.id;
      user.username = username;
      user.isConnected = true;
      if (user.roomCode && rooms[user.roomCode]){
        if (!rooms[user.roomCode].hasActiveGame){
          rooms[user.roomCode].users[user.userId] = user;
        }
        socket.join(user.roomCode);
        socket.emit('reconnectedToRoom', {user: rooms[user.roomCode].users[user.userId], usersInRoom: sanitizeUserData(rooms[user.roomCode].users),
           activeGame: rooms[user.roomCode].hasActiveGame, roomCode: user.roomCode});
      }
    } else {
      // Otherwise, add the user to the users object
      users[userId] = { userId: userId, socketId: socket.id, username: username, isConnected: true };
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
          if (room.hasActiveGame){
            room.users[userId].isConnected = false;
          } else {
            delete room.users[userId];
          }

          // Inform other clients in the room that this client has left
          socket.to(roomCode).emit('userDisconnected', { roomCode, users: room.users });

          // If there are no users left in the room, delete the room
          if (Object.keys(room.users).length === 0) {
            delete rooms[roomCode];
          }

          break;
        }
      }
    }

    let userId = Object.keys(users).find(userId => users[userId].socketId === socket.id);
    if (userId) {
      users[userId].isConnected = false;
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
    let user: User = users[userId];
    user.roomCode = roomCode;
    rooms[roomCode] = {
      users: {
        [userId]: user
      },
      hasActiveGame: false,
    };
    socket.emit('roomCreated', { roomCode, users: sanitizeUserData(rooms[roomCode].users) }); // Send the room code back to the client
    console.log(`User ${userId} has created the room ${roomCode}`)
  });

  socket.on('join', ({ userId, roomCode }) => {
    if(rooms[roomCode]) {
      if(rooms[roomCode].hasActiveGame){
        socket.emit('error', 'Game has already started')
      }
      socket.join(roomCode);
      let user: User = users[userId];
      user.roomCode = roomCode;
      rooms[roomCode].users[userId] = user
      socket.emit('joinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users, userId) }); // Confirm the join event to the joining client
      socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users) }); // Inform all other clients in the room
      console.log(`User ${userId} has joined the room ${roomCode}`);
    } else {
      socket.emit('error', 'Room does not exist.'); // Send an error message back to the client
    }
  });

  // Implement 'leave' event
  socket.on('leaveRoom', ({ userId, roomCode }) => {
    console.log(`${userId} left room ${roomCode}`)
    if (rooms[roomCode]) {
      // Remove the user from the room
      delete rooms[roomCode].users[userId];

      // Leave the room in socket.io
      socket.leave(roomCode);

      // Inform the client they've left the room
      socket.emit('leftRoom', { roomCode, userId });

      // Inform other clients in the room that this client has left
      socket.to(roomCode).emit('userLeftRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users)});
    }
  });

  socket.on('startGame', ({ roomCode }) => {
    if(rooms[roomCode] && Object.keys(rooms[roomCode].users).length >= 2) {
      let gameRoles: Role[] = assignRoles(Object.keys(rooms[roomCode].users).length, roomCode);
      let shuffledUsers: User[] = shuffleUsers([...Object.values(rooms[roomCode].users)], rooms[roomCode].previousMonarchUserId); // Create a copy and shuffle users excluding previousMonarchUserId
      console.log(gameRoles);
      shuffledUsers.forEach((user, index) => {
        let currentUser: User = rooms[roomCode].users[user.userId];
        currentUser.role = gameRoles[index];
        io.to(currentUser.socketId).emit('gameStarted', { userRole: gameRoles[index], teammates: null });
        if(gameRoles[index].type === "Monarch") {
          rooms[roomCode].previousMonarchUserId = user.userId;
          currentUser.isRevealed = true;
        }
      });
      rooms[roomCode].hasActiveGame = true;
      rooms[roomCode].gameStartedAt = new Date();
      io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(rooms[roomCode].users) });
    } else {
      socket.emit('error', 'Not enough players to start a game.'); 
    }
  });

  socket.on('revealRole', ({ userId, roomCode }) => {
    console.log(userId);
    console.log("REVEALED");
    rooms[roomCode].users[userId].isRevealed = true;
    console.log(sanitizeUserData(rooms[roomCode].users));
    io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(rooms[roomCode].users) });
  });

});

function sanitizeUserData(users: {[userId: string]: User}, userId?: string): SanitizedUser[] {
  return Object.keys(users).map(id => {
    const { role, ...rest } = users[id];
    const sanitizedUser: SanitizedUser = rest;
    if (id === userId) {
      sanitizedUser.role = role;
    }
    else if (sanitizedUser.isRevealed){
      sanitizedUser.role = role;
    }
    return sanitizedUser;
  });
}

function shuffleUsers(users: User[], previousMonarchUserId?: string): User[] {
  let otherUsers: User[] = users.filter(user => user.userId !== previousMonarchUserId);
  let shuffledOtherUsers: User[] = shuffleArray([...otherUsers]);
  if(previousMonarchUserId !== null) {
    let previousMonarchUser = users.find(user => user.userId === previousMonarchUserId);
    if(previousMonarchUser !== undefined) {
      shuffledOtherUsers.push(previousMonarchUser);
    }
  }
  return shuffledOtherUsers;
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function assignRoles(numPlayers: number, roomCode: string) {
  // Define the order of role assignments based on the number of players
  const roleOrder = ["Monarch", "Bandit", "Bandit", "Knight", "Renegade", "Noble", "Noble", "Bandit"];
  
  // Get the roles needed for the current game
  let neededRoles = roleOrder.slice(0, numPlayers);

  // Create an array to hold the assigned roles
  let assignedRoles: Role[] = [];

  // Assign the roles
  for (let roleType of neededRoles) {
    // Get the potential roles of the current type that weren't used in the previous game

  let potentialRoles = rolesCache
      .filter(role => {
        let room = rooms[roomCode];
        return role.type === roleType && room && room.previousGameRoles && !room.previousGameRoles.some(prevRole => prevRole.name === role.name)
      });

    // If there are no potential roles, then allow roles from the previous game
    if (potentialRoles.length === 0) {
      potentialRoles = rolesCache
        .filter(role => role.type === roleType)
    }

    // Choose a random role from the potential roles
    let chosenRole = potentialRoles[Math.floor(Math.random() * potentialRoles.length)];
    
    // Add the role to the assigned roles
    assignedRoles.push(chosenRole);
  }

  // Save the assigned roles for the next game
  rooms[roomCode].previousGameRoles = assignedRoles;
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
        name: entity.partitionKey,
        type: entity.rowKey,
        image: entity.ImageUrl as string,
        ability: entity.Ability as string
      };
      rolesCache.push(role);
    }

    rolesCache.sort((a, b) => {
      const specificOrder = ["Monarch", "Knight", "Bandit", "Renegade", "Noble", "SubRole"];
      return specificOrder.indexOf(a.type!) - specificOrder.indexOf(b.type!);
    });

    console.log('Roles loaded into cache');
  } catch (error) {
    console.log('Error occurred while loading roles: ', error);
  }
}

loadRoles()

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('Shutting down gracefully...');
  
  io.close(() => {
    console.log('Socket.IO connections closed.');
  });

  server.close(() => {
    console.log('HTTP server closed.');
    // You can add other cleanup tasks here as needed.
  });
}

server.listen(port, () => console.log(`Listening on port ${port}`));

