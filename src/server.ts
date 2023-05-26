import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import {v4} from 'uuid';
import {Server} from 'socket.io';
import { TableClient } from '@azure/data-tables';

dotenv.config();
const app = express();
const storageConnectionString: string = process.env.MTGKINGDOMS_STORAGE_CONNECTION_STRING!;
const port = process.env.PORT || 9998; // for local development

app.get('/', (req, res) => {
  res.send('Hello, this is a test endpoint!');
});

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
  gameStartedAt?: number;
}

let rolesCache: Role[] = [];
let rooms: { [roomCode: string]: Room } = {};
let users: { [userId: string]: User } = {};

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
        let userInRoom = rooms[user.roomCode].users[user.userId];
        let teammates: User[] = getTeammates(Object.values(rooms[user.roomCode].users), userId, userInRoom.role);
        let team: User[] = [userInRoom, ...teammates];
        socket.emit('reconnectedToRoom', {team: team, usersInRoom: sanitizeUserData(rooms[user.roomCode].users),
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
      } else {
        socket.join(roomCode);
        let user: User = users[userId];
        user.roomCode = roomCode;
        rooms[roomCode].users[userId] = user
        socket.emit('joinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users, userId) }); // Confirm the join event to the joining client
        socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users) }); // Inform all other clients in the room
        console.log(`User ${userId} has joined the room ${roomCode}`);
      }
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
        if(gameRoles[index].type === "Monarch") {
          rooms[roomCode].previousMonarchUserId = user.userId;
          currentUser.isRevealed = true;
        }
      });
      for (let userId in rooms[roomCode].users){
        let sendToUser = rooms[roomCode].users[userId]
        let teammates = getTeammates(Object.values(rooms[roomCode].users), userId, sendToUser.role)
        // Ensure teammates is an array before spreading
        if (!Array.isArray(teammates)) {
          teammates = [];
        }
        let team: User[] = [rooms[roomCode].users[userId], ...teammates]
        console.log(team);
        console.log(teammates);
        io.to(sendToUser.socketId).emit('gameStarted', { team: team });
      }
      rooms[roomCode].hasActiveGame = true;
      rooms[roomCode].gameStartedAt = Date.now();
      io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(rooms[roomCode].users) });
    } else {
      socket.emit('error', 'Not enough players to start a game.'); 
    }
  });

  socket.on('revealRole', ({ userId, roomCode }) => {
    let revealedUser = rooms[roomCode].users[userId]
    revealedUser.isRevealed = true;
    if (revealedUser.role && revealedUser.role.name == "Archenemy"){
      let archenemyRevealed = rolesCache.find(r=>r.name == "Archenemy Revealed");
      let villager = rolesCache.find(r=>r.name == "Villager")
      revealedUser.role = archenemyRevealed
      for(let user of Object.values(rooms[roomCode].users)){
        user.isRevealed = true;
        user.role = villager;
      }
    }
    console.log(sanitizeUserData(rooms[roomCode].users));
    io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(rooms[roomCode].users) });
  });

  socket.on('endGame', ({ roomCode, winnersIds }) => {
    console.log(`Room ${roomCode} ended the game.`);
    console.log(`Room ${winnersIds} ended the game.`);
    let roomUsers = rooms[roomCode].users;
    if(winnersIds && winnersIds.length > 0){
      // Save game to table
      let gameId = v4();
      let game = {
        partitionKey: gameId,
        rowKey: new Date().toISOString(),
        gameLength: '', // To be filled in later
      };
      let gameStartTime = rooms[roomCode].gameStartedAt;
      if (gameStartTime){
        let gameEndTime = Date.now();
        let gameLengthSeconds = (gameEndTime - gameStartTime) / 1000;
        game.gameLength = `${Math.floor(gameLengthSeconds / 60)}:${gameLengthSeconds % 60}`;
      }
      const gameClient = TableClient.fromConnectionString(storageConnectionString, "Games");
      gameClient.createEntity(game);
      
      const gameUserClient = TableClient.fromConnectionString(storageConnectionString, "GameUsers");
      for(let userId in roomUsers){
        let user: User = roomUsers[userId];
        const gameUser ={
          partitionKey: gameId,
          rowKey: user.userId,
          username: user.username || '',
          roleType: user.role?.type || '',
          roleName: user.role?.name || '',
          didWin: winnersIds.includes(user.userId),
          didReveal: user.isRevealed || false
        }
        gameUserClient.createEntity(gameUser);
    }}

    // Reset Room
    for(let userId in roomUsers){
      let user: User = roomUsers[userId];
      if(!user.isConnected){
        delete roomUsers[userId];
      } else {
        user.role = undefined;
        user.isRevealed = false;
      }
    }
    rooms[roomCode].hasActiveGame = false;
    io.to(roomCode).emit('gameEnded', { users: sanitizeUserData(rooms[roomCode].users) });
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

  // Jester check
  let renegade: Role | undefined = assignedRoles.find(r => r.name == "Jester")
  if(renegade){
    let knight: Role | undefined = assignedRoles.find(r => r.type == "Knight")
    if(knight){
      knight.name = "Corrupted "+knight.name;
      knight.ability = "You serve the Jester.\n"+(knight.ability?.replace("Monarch","Jester") ?? "")
    }
  }
  rooms[roomCode].previousGameRoles = assignedRoles;
  return assignedRoles;
}

function getTeammates(usersInRoom: User[], userId: string, role: Role | undefined): User[] {
  let teammates: User[] = [];
  if(role){
    if (role.type == "Bandit"){
      teammates = usersInRoom.filter(u => u.role?.type == "Bandit" && u.userId != userId)
    }
  }
  return teammates
}

const generateRoomCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

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

