import { Server, Socket } from 'socket.io';
import { sanitizeUserData, generateRoomCode, getUserData,
    getTeammates, assignPlayerRoles, generatePlayerTeamsAndStartGame, createGameEntity, 
    createGameUserEntities, resetRoomInfo } from './utils';
import { User, UserData, Role } from './types';
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
    rooms[roomCode] = {
        users: {
        [userId]: user
        },
        hasActiveGame: false,
        selectedRoles: rolesCache,
        roomCode: roomCode,
        allRolesSelected: false,
        roleSelection: true,
        selectingRoles: false,
    };

    socket.emit('roomCreated', { roomCode, users: sanitizeUserData(rooms[roomCode].users) }); // Send the room code back to the client
    console.log(`[${new Date().toISOString()}] User ${userId} has created the room ${roomCode}`)
}

function handleDisconnect(socket: Socket){
    console.log(`[${new Date().toISOString()}] User ${socket.id} disconnected`);
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
                if (Object.keys(room.users).length === 0 && roomCode != "690420") {
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
            console.log(`[${new Date().toISOString()}] Room ${roomCode} has ended a game.`);
            const room = rooms[roomCode];
            if (winnersIds.length > 0){
                const gameId = v4();
                createGameEntity(gameId, room, tableClients);
                // add role usage data
                await createGameUserEntities(gameId, room, winnersIds, tableClients);
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
            console.log(`[${new Date().toISOString()}] User ${userId} has joined the room ${roomCode}`);
        }
    } else {
        socket.emit('error', 'Room does not exist.'); // Send an error message back to the client
    }
}

function handleLeaveRoom(socket: Socket, userId: string, roomCode: string){
    console.log(`[${new Date().toISOString()}] ${userId} left room ${roomCode}`);
    if (rooms[roomCode]) {
        rooms[roomCode].users[userId].roomCode = undefined;
        delete rooms[roomCode].users[userId];
        if (Object.keys(rooms[roomCode].users).length === 0 && roomCode !== "690420") {
            delete rooms[roomCode];
        }

        socket.leave(roomCode);
        socket.emit('leftRoom', { roomCode, userId });
        if (rooms[roomCode]) {
            socket.to(roomCode).emit('userLeftRoom', { roomCode, users: sanitizeUserData(rooms[roomCode].users) });
        }
    }
}

function handleLogin(socket: Socket, userId: string, username: string){
    console.log(`[${new Date().toISOString()}] User ${userId} with socketId ${socket.id} logged in`)
    if (users[userId]) {
        let user: User = users[userId];
        user.socketId = socket.id;
        user.username = username;
        user.isConnected = true;
        if (user.roomCode && rooms[user.roomCode]){
            let roomCode = user.roomCode;
            let room = rooms[roomCode];
            socket.join(roomCode);
            if (!room.hasActiveGame){
                room.users[user.userId] = user;
                socket.to(roomCode).emit('userJoinedRoom', { roomCode, users: sanitizeUserData(room.users) });
            } 

            let userInRoom = room.users[user.userId];

            if(userInRoom){
                let teammates: User[] = getTeammates(Object.values(room.users), userId, userInRoom.role);
                let team: User[] = [userInRoom, ...teammates];
                socket.emit('reconnectedToRoom', {team: team, usersInRoom: sanitizeUserData(room.users),
                    activeGame: room.hasActiveGame, roomCode: roomCode });
            }
        }
    } else {
        users[userId] = { userId: userId, socketId: socket.id, username: username, isConnected: true , hasSelectedRole: false, potentialRoles: []};
    }
}

async function handleRequestUserData(socket: Socket, userId: string){
    let userData: UserData | null = await getUserData(userId, tableClients.gameUserClient)
    socket.emit('receiveUserData', userData);
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

    io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(rooms[roomCode].users) });
}

function handleStartGame(io: Server, socket: Socket, roomCode: string){
    try {
        if(rooms[roomCode] && Object.keys(rooms[roomCode].users).length >= 2) {
            console.log(`[${new Date().toISOString()}] Room ${roomCode} is starting a game.`);
            const room = rooms[roomCode];
            assignPlayerRoles(room);
            if (!room.roleSelection){
                Object.values(room.users).forEach(user => {
                    if (user.potentialRoles && user.potentialRoles.length > 0) {
                      user.role = user.potentialRoles[0];
                    } else {
                      console.error("No potential roles available for user:", user);
                    }
                  });

                generatePlayerTeamsAndStartGame(io, room);
            } else {
                room.selectingRoles = true;
                Object.values(room.users).forEach(user => {
                    io.to(user.socketId).emit('selectRole', { potentialRoles: user.potentialRoles });
                });
            }
        } else {
            socket.emit('error', 'Not enough players to start a game.'); 
        }
    } catch(error) {
        console.error(`Error starting game in room ${roomCode}: `, error);
        socket.emit('error', 'An error occurred while starting the game.');
    }
}

function handleRoleSelected(io: Server, userId: string, roomCode: string, selectedRole: Role) {
    const room = rooms[roomCode];
    const user = room.users[userId];
    if(selectedRole === null){
        io.to(user.socketId).emit('error', 'Error when selecting character, no character provided.');
    } else if(user && user.potentialRoles && user.potentialRoles.some(role => role.name === selectedRole.name)) {
        user.role = selectedRole;
        user.startingRole = selectedRole;
        user.hasSelectedRole = true;
        const allSelected = Object.values(room.users).every(user => user.role);
        room.allRolesSelected = allSelected;
        if(allSelected) {
            room.selectingRoles = false;
            generatePlayerTeamsAndStartGame(io, room);
        } else {
            io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room.users) });
        }
    }
    else {
        io.to(user.socketId).emit('error', 'Error when selecting character.');
    }
}

// Specific Renegade functions
function handleChosenOneDecision(io: Server, userId: string, roomCode: string, decision: string){
    let room = rooms[roomCode];
    room.users[userId].role = rolesCache.find(r => r.name == decision);
    io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room.users) });
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
    
    io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room.users) });
}

export function attachSocketEvents(io: Server) {
    io.on('connection', (socket) => {
        console.log(`[${new Date().toISOString()}] New client connected`);
        
        socket.on('create', ({ userId }) => handleCreateRoom(socket, userId));
        socket.on('disconnect', () => handleDisconnect(socket));
        socket.on('endGame', ({ roomCode, winnersIds }) => handleEndGame(io, socket, roomCode, winnersIds));
        socket.on('error', (error) => console.log(`[${new Date().toISOString()}] Socket error:${error}`));
        socket.on('getRoles', async () => socket.emit('rolesData', rolesCache));
        socket.on('join', ({ userId, roomCode }) => handleJoinRoom(socket, userId, roomCode));
        socket.on('leaveRoom', ({ userId, roomCode }) => handleLeaveRoom(socket, userId, roomCode));
        socket.on('login', ({ userId, username }) => handleLogin(socket, userId, username));
        socket.on('requestUserData', ({ userId }) => handleRequestUserData(socket, userId));
        socket.on('revealRole', ({ userId, roomCode }) => handleRevealRole(io, userId, roomCode));
        socket.on('selectRole', ({ userId, roomCode, selectedRole }) => handleRoleSelected(io, userId, roomCode, selectedRole));
        socket.on('startGame', ({ roomCode }) => handleStartGame(io, socket, roomCode));

        socket.on('chosenOneDecision', ({ userId, roomCode, decision }) => handleChosenOneDecision(io, userId, roomCode, decision))
        socket.on('cultification', ({ userId, roomCode, cultistsIds }) => handleCultification(io, userId, roomCode, cultistsIds))
    });
}
