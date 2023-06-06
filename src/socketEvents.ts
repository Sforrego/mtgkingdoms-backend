import { Server, Socket } from 'socket.io';
import { sanitizeUserData, generateRoomCode, 
    getTeammates, assignPlayerRoles, generatePlayerTeams, createGameEntity, 
    createGameUserEntities, resetRoomInfo } from './utils';
import { User, Role } from './types';
import { rooms, users, rolesCache } from './state';
import { tableClients } from './config'
import { v4 } from 'uuid';

function handleCreateRoom(socket:Socket, userId: string){
    let roomCode;
    do {
        roomCode = generateRoomCode();
    } while (rooms[roomCode]);
    socket.join(roomCode);
    let user: User = users[userId];
    user.roomCode = roomCode;
    console.log(rolesCache);
    rooms[roomCode] = {
        users: {
        [userId]: user
        },
        hasActiveGame: false,
        selectedRoles: rolesCache,
        roomCode: roomCode
    };

    socket.emit('roomCreated', { roomCode, users: sanitizeUserData(rooms[roomCode].users) }); // Send the room code back to the client
    console.log(`User ${userId} has created the room ${roomCode}`)
}

function handleDisconnect(socket: Socket){
    console.log(`User ${socket.id} disconnected`);
    for (let roomCode in rooms) {
        let room = rooms[roomCode];
        for (let userId in room.users) {
            if (room.users[userId].socketId === socket.id) {
                if (room.hasActiveGame){
                    room.users[userId].isConnected = false;
                } else {
                    delete room.users[userId];
                }

                socket.to(roomCode).emit('userDisconnected', { roomCode, users: room.users });
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
}

async function handleEndGame(io: Server, socket: Socket, roomCode: string, winnersIds: string[]){
    try {
        if(rooms[roomCode] && rooms[roomCode].hasActiveGame) {
            console.log(`Room ${roomCode} has ended a game.`);
            const room = rooms[roomCode];
            if (winnersIds.length > 0){
                const gameId = v4();
                createGameEntity(gameId, room, tableClients);
                createGameUserEntities(gameId, room, winnersIds, tableClients);
            }

            resetRoomInfo(io, room);
        } else {
            socket.emit('error', 'No active game to end.'); 
        }
    } catch(error) {
        console.error(`Error ending game in room ${roomCode}: `, error);
        socket.emit('error', 'An error occurred while ending the game.');
    }
}

function handleJoinRoom(socket:Socket, userId: string, roomCode: string){
    if(rooms[roomCode]) {
        if(rooms[roomCode].hasActiveGame){
            socket.emit('error', 'Game has already started')
        } else {
            socket.join(roomCode);
            let user: User = users[userId];
            user.roomCode = roomCode;
            rooms[roomCode].users[userId] = user
            socket.emit('joinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users, userId), selectedRoles: rooms[roomCode].selectedRoles }); // Confirm the join event to the joining client
            socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users) }); // Inform all other clients in the room
            console.log(`User ${userId} has joined the room ${roomCode}`);
        }
    } else {
        socket.emit('error', 'Room does not exist.'); // Send an error message back to the client
    }
}

function handleLeaveRoom(socket:Socket, userId: string, roomCode: string){
    console.log(`${userId} left room ${roomCode}`)
    if (rooms[roomCode]) {
        rooms[roomCode].users[userId].roomCode = undefined;
        delete rooms[roomCode].users[userId];
        if (Object.keys(rooms[roomCode].users).length == 0){
            delete rooms[roomCode];
        }
        socket.leave(roomCode);
        socket.emit('leftRoom', { roomCode, userId });
        socket.to(roomCode).emit('userLeftRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users)});
    }
}

function handleLogin(socket: Socket, userId: string, username: string){
    console.log(`User ${userId} with socketId ${socket.id} logged in`)
    if (users[userId]) {
        let user: User = users[userId];
        user.socketId = socket.id;
        user.username = username;
        user.isConnected = true;
        if (user.roomCode && rooms[user.roomCode]){
            let roomCode = user.roomCode;
            socket.join(roomCode);
            if (!rooms[roomCode].hasActiveGame){
                rooms[roomCode].users[user.userId] = user;
                socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users) });
            } 

            let userInRoom = rooms[roomCode].users[user.userId];
            let teammates: User[] = getTeammates(Object.values(rooms[roomCode].users), userId, userInRoom.role);
            let team: User[] = [userInRoom, ...teammates];
            socket.emit('reconnectedToRoom', {team: team, usersInRoom: sanitizeUserData(rooms[roomCode].users),
                activeGame: rooms[roomCode].hasActiveGame, roomCode: roomCode});
        }
    } else {
        users[userId] = { userId: userId, socketId: socket.id, username: username, isConnected: true };
    }
}

function handleRevealRole(io: Server, userId:string, roomCode: string){
    let revealedUser = rooms[roomCode].users[userId]
    revealedUser.isRevealed = true;
    if (revealedUser.role && revealedUser.role.name == "Archenemy"){
        let archenemyRevealed = rolesCache.find(r=>r.name == "Archenemy Revealed");
        let villager = rolesCache.find(r=>r.name == "Villager")
        revealedUser.role = archenemyRevealed
        for(let user of Object.values(rooms[roomCode].users)){
            if(userId != user.userId){
                user.isRevealed = true;
                user.role = villager;
            }
        }
    }

    io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(rooms[roomCode].users) });
}

function handleSelectRoles(io: Server, roles: Role[], roomCode: string){
    if (rooms[roomCode]) {
        rooms[roomCode].selectedRoles = roles;
        io.to(roomCode).emit('rolesSelected', { roles });
    }
}

function handleStartGame(io: Server, socket: Socket, roomCode: string){
    try {
        if(rooms[roomCode] && Object.keys(rooms[roomCode].users).length >= 2) {
            console.log(`Room ${roomCode} is starting a game.`);
            const room = rooms[roomCode];
            assignPlayerRoles(room);
            generatePlayerTeams(io, room);
            room.hasActiveGame = true;
            room.gameStartedAt = Date.now();
            io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(room.users) });
        } else {
            socket.emit('error', 'Not enough players to start a game.'); 
        }
    } catch(error) {
        console.error(`Error starting game in room ${roomCode}: `, error);
        socket.emit('error', 'An error occurred while starting the game.');
    }
}

// Specific Renegade functions
function handleChosenOneDecision(io: Server, userId: string, roomCode: string, decision: string){
    let room = rooms[roomCode];
    room.users[userId].role = rolesCache.find(r => r.name == decision);
    io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(room.users) });
}

function handleCultification(io: Server, userId: string, roomCode: string, cultistsIds: string[]){
    let room = rooms[roomCode];
    let cultistRole = rolesCache.find(r => r.name == "Cultist");
    for (let user of Object.values(rooms[roomCode].users)){
        if (user.userId == userId || cultistsIds.includes(user.userId)){
            user.role = cultistRole;
            user.isRevealed = true;
        }
    }
    
    io.to(roomCode).emit('gameUpdated', { users: sanitizeUserData(room.users) });
}

export function attachSocketEvents(io: Server) {
    io.on('connection', (socket) => {
        console.log('New client connected');
        
        socket.on('create', ({ userId }) => handleCreateRoom(socket, userId));
        socket.on('disconnect', () => handleDisconnect(socket));
        socket.on('endGame', ({ roomCode, winnersIds }) => handleEndGame(io, socket, roomCode, winnersIds));
        socket.on('error', (error) => console.log('Socket error:', error));
        socket.on('getRoles', async () => socket.emit('rolesData', rolesCache));
        socket.on('join', ({ userId, roomCode }) => handleJoinRoom(socket, userId, roomCode));
        socket.on('leaveRoom', ({ userId, roomCode }) => handleLeaveRoom(socket, userId, roomCode));
        socket.on('login', ({ userId, username }) => handleLogin(socket, userId, username));
        socket.on('revealRole', ({ userId, roomCode }) => handleRevealRole(io, userId, roomCode));
        socket.on('selectRoles', ({ roles, roomCode }) => handleSelectRoles(io, roles, roomCode));
        socket.on('startGame', ({ roomCode }) => handleStartGame(io, socket, roomCode));

        socket.on('chosenOneDecision', ({ userId, roomCode, decision }) => handleChosenOneDecision(io, userId, roomCode, decision))
        socket.on('cultification', ({ userId, roomCode, cultistsIds }) => handleCultification(io, userId, roomCode, cultistsIds))
    });
}
