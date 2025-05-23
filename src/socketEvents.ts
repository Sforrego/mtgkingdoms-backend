import { Server, Socket } from 'socket.io';
import { v4 } from 'uuid';

import { tableClients } from './config.js'
import { getUserData, createGameEntity, createGameUserEntities } from './dbOperations.js';
import { sanitizeUserData, setInitialPlayerRoles, startRoleSelection, startTeamConfirmation,
         assignPlayerRolesOptions, generateTeams, preConfirmationActions, startGame, resetRoomInfo } from './gameLogic.js';
import { rooms, users, rolesCache, mainRoles } from './state.js';
import { User, UserData, Role } from './types.js';
import { emitError, generateRoomCode } from './utils.js';

const DEFAULT_ROOM_CODE = ["690420", "012345"];

// User Management

function handleLogin(socket: any, userId: string, username: string): void {
    console.log(`[${new Date().toISOString()}] User ${userId} with socketId ${socket.id} logged in`);
    console.log(`[${new Date().toISOString()}] User ${username} with socketId ${socket.id} logged in`);
    let eventPayload = {
        userId,
        username,
        isConnected: true,
        roomCode: null as string | null,
        team: [] as User[],
        usersInRoom: [] as User[],
        activeGame: false,
        selectedRolesPool: [] as Role[],
        selectingRole: false,
        reviewingTeam: false,
        potentialRoles: [] as Role[],
        isRevealed: false as boolean | undefined
    };

    if (users[userId]) {
        let user: User = users[userId];
        user.socketId = socket.id;
        user.username = username;
        user.isConnected = true;

        if (user.roomCode && rooms[user.roomCode]) {
            let roomCode = user.roomCode;
            let room = rooms[roomCode];
            socket.join(roomCode);
            eventPayload.roomCode = roomCode;
            eventPayload.activeGame = room.hasActiveGame;
            eventPayload.selectedRolesPool = room.selectedRolesPool;
            eventPayload.selectingRole = room.selectingRoles;
            eventPayload.reviewingTeam = room.confirmingTeam;
            eventPayload.potentialRoles = user.potentialRoles;
            eventPayload.isRevealed = user.isRevealed;
            eventPayload.usersInRoom = sanitizeUserData(rooms[roomCode])

            if (!room.hasActiveGame) {
                room.users[user.userId] = user;
                eventPayload.usersInRoom = Object.values(room.users);
                socket.to(roomCode).emit('userJoinedRoom', { usersInRoom: sanitizeUserData(rooms[roomCode]) });
            }

            let userInRoom = room.users[user.userId];
            if (userInRoom && user.teamIds) {
                eventPayload.team = Object.values(room.users).filter(u => user.teamIds?.includes(u.userId));
            }
        }
    } else {
        users[userId] = {
            userId: userId,
            socketId: socket.id,
            username: username,
            isConnected: true,
            hasSelectedRole: false,
            hasReviewedTeam: false,
            potentialRoles: [],
            isRevealed: false
        };
    }

    socket.emit('loginStatus', eventPayload);
}

function handleGuestLogin(socket: Socket, username: string) {
    const userId = `guest-${v4()}`; // mark clearly as guest
    console.log(`[${new Date().toISOString()}] Guest ${userId} with socketId ${socket.id} connected`);
    console.log(`[${new Date().toISOString()}] Guest ${username} with socketId ${socket.id} connected`);
    const guestUser: User = {
        userId,
        socketId: socket.id,
        username,
        isConnected: true,
        hasSelectedRole: false,
        hasReviewedTeam: false,
        potentialRoles: [],
        isRevealed: false
    };

    users[userId] = guestUser;

    socket.emit('loginStatus', {
        userId,
        username,
        isConnected: true,
        roomCode: null,
        team: [],
        usersInRoom: [],
        activeGame: false,
        selectedRolesPool: [],
        selectingRole: false,
        reviewingTeam: false,
        potentialRoles: [],
        isRevealed: false,
        isGuest: true
    });
}

function handleDisconnect(socket: Socket){
    console.log(`[${new Date().toISOString()}] User ${socket.id} disconnected`);
    for (let roomCode in rooms) {
        let room = rooms[roomCode];
        for (let userId in room.users) {
            if (room.users[userId].socketId === socket.id) {
                if (room.hasActiveGame || room.selectingRoles || room.confirmingTeam){
                    room.users[userId].isConnected = false;
                } else {
                    delete room.users[userId];
                }

                socket.to(roomCode).emit('userLeftRoom', { usersInRoom: sanitizeUserData(rooms[roomCode]) });
                if (Object.keys(room.users).length === 0 && !DEFAULT_ROOM_CODE.includes(roomCode)) {
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

async function handleRequestUserData(socket: Socket, userId: string){
    let userData: UserData | null = await getUserData(userId, tableClients.gameUserClient)
    socket.emit('receiveUserData', userData);
}

// Room Management

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
        selectedRolesPool: mainRoles,
        roomCode: roomCode,
        allRolesSelected: false,
        roleSelection: true,
        selectingRoles: false,
        confirmingTeam: false,
        previousGameRoles: [],
        withRevealedRoles: false,
    };

    socket.emit('roomCreated', { roomCode, users: sanitizeUserData(rooms[roomCode]), selectedRoles: rooms[roomCode].selectedRolesPool }); // Send the room code back to the client
    console.log(`[${new Date().toISOString()}] User ${userId} has created the room ${roomCode}`)
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
            socket.emit('joinedRoom', { roomCode, users: sanitizeUserData(rooms[roomCode], userId), selectedRoles: rooms[roomCode].selectedRolesPool, 
                withRevealedRoles: rooms[roomCode].withRevealedRoles }); // Confirm the join event to the joining client
            socket.to(roomCode).emit('userJoinedRoom', { usersInRoom: sanitizeUserData(rooms[roomCode]) }); // Inform all other clients in the room
            console.log(`[${new Date().toISOString()}] User ${userId} has joined the room ${roomCode}`);
        }
    } else {
        socket.emit('error', `Room ${roomCode} does not exist.`); // Send an error message back to the client
    }
}

function handleLeaveRoom(socket: Socket, userId: string, roomCode: string){
    console.log(`[${new Date().toISOString()}] ${userId} left room ${roomCode}`);
    if (rooms[roomCode]) {
        rooms[roomCode].users[userId].roomCode = undefined;
        delete rooms[roomCode].users[userId];
        if (Object.keys(rooms[roomCode].users).length === 0 && !DEFAULT_ROOM_CODE.includes(roomCode)) {
            delete rooms[roomCode];
        }

        socket.leave(roomCode);
        socket.emit('leftRoom', { roomCode, userId });
        if (rooms[roomCode]) {
            socket.to(roomCode).emit('userLeftRoom', { usersInRoom: sanitizeUserData(rooms[roomCode]) });
        }
    }
}

function handleUpdateRolesPool(io: Server, roles: Role[], roomCode: string){
    if (rooms[roomCode]) {
        rooms[roomCode].selectedRolesPool = roles;
        io.to(roomCode).emit('rolesPoolUpdated', { roles });
    }
}

function handleToggleRevealedRoles(io: Server, roomCode: string, withRevealedRoles: boolean){
    if (rooms[roomCode]) {
        rooms[roomCode].withRevealedRoles = withRevealedRoles;
        io.to(roomCode).emit("updateRevealedRolesSetting", { withRevealedRoles });
    }
}

// Game Management

function handleStartGame(io: Server, socket: Socket, roomCode: string){
    try {
        if(rooms[roomCode] && Object.keys(rooms[roomCode].users).length >= 2) {
            console.log(`[${new Date().toISOString()}] Room ${roomCode} is starting a game.`);
            const room = rooms[roomCode];
            room.hasActiveGame = true;
            assignPlayerRolesOptions(room);
            if (!room.roleSelection){
                preConfirmationActions(room);
                setInitialPlayerRoles(room);
                generateTeams(io, room);
                startGame(io, room);
            } else {
                startRoleSelection(io, room);
            }
        }   
    }
    catch(error) {
        emitError(socket, `An error occurred while starting the game in room ${roomCode}.`);
    }
}

function handleRoleSelected(io: Server, userId: string, roomCode: string, selectedRole: Role) {
    const room = rooms[roomCode];
    const user = room.users[userId];
    if(selectedRole === null){
        io.to(user.socketId).emit('error', 'Error when selecting character, no character provided.');
    } else if(user && user.potentialRoles && user.potentialRoles.some(role => role.name === selectedRole.name)) {
        user.role = selectedRole;
        user.startingRole = JSON.parse(JSON.stringify(selectedRole));
        user.hasSelectedRole = true;
        room.previousGameRoles.push(selectedRole);
        const allSelected = Object.values(room.users).every(user => user.role);
        room.allRolesSelected = allSelected;
        if(allSelected) {
            room.selectingRoles = false;
            preConfirmationActions(room);
            generateTeams(io, room);
            startTeamConfirmation(io, room);
        } else {
            io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room) });
        }
    }
    else {
        io.to(user.socketId).emit('error', 'Error when selecting character.');
    }
}

function handleTeamConfirmed(io: Server, userId: string, roomCode: string) {
    const room = rooms[roomCode];
    const user = room.users[userId];
    console.log(`User ${userId} has confirmed their team.`)
    user.hasReviewedTeam = true;
    const allConfirmed = Object.values(room.users).every(user => user.hasReviewedTeam);
    if(allConfirmed) {
        room.confirmingTeam = false;
        startGame(io, room);
    } else {
        io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room) });
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

    io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(rooms[roomCode]) });
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
                const persistentUsers = Object.values(room.users).filter(u => !u.userId.startsWith("guest-"));
                if (persistentUsers.length > 0) {
                    await createGameUserEntities(gameId, room, winnersIds, tableClients);
                }
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

// Specific Renegade functions

function handleCultification(io: Server, userId: string, roomCode: string, cultistsIds: string[]){
    let room = rooms[roomCode];
    let cultistRole = rolesCache.find(r => r.name == "Cultist");
    for (let user of Object.values(rooms[roomCode].users)){
        if (user.userId == userId || cultistsIds.includes(user.userId)){
            user.role = cultistRole;
            user.isRevealed = true;
        }
    }
    
    io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room) });
}

function handleConceal(io: Server, userId: string, roomCode: string){
    let room = rooms[roomCode];
    let user = rooms[roomCode].users[userId];
    user.isRevealed = false;

    io.to(roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room) });
}

export function attachSocketEvents(io: Server) {
    io.on('connection', (socket) => {
        console.log(`[${new Date().toISOString()}] New client connected`);

        // User management
        socket.on('login', ({ userId, username }) => handleLogin(socket, userId, username));
        socket.on("guestLogin", (username: string) => handleGuestLogin(socket, username));
        socket.on('disconnect', () => handleDisconnect(socket));
        socket.on('requestUserData', ({ userId }) => handleRequestUserData(socket, userId));

        // Room management
        socket.on('create', ({ userId }) => handleCreateRoom(socket, userId));
        socket.on('getRoles', async () => socket.emit('rolesData', rolesCache));
        socket.on('join', ({ userId, roomCode }) => handleJoinRoom(socket, userId, roomCode));
        socket.on('leaveRoom', ({ userId, roomCode }) => handleLeaveRoom(socket, userId, roomCode));
        socket.on('updateRolesPool', ({ roles, roomCode }) => handleUpdateRolesPool(io, roles, roomCode));
        socket.on("toggleRevealedRoles", ({ roomCode, withRevealedRoles }) => handleToggleRevealedRoles(io, roomCode, withRevealedRoles));

        // Game management
        socket.on('startGame', ({ roomCode }) => handleStartGame(io, socket, roomCode));
        socket.on('selectRole', ({ userId, roomCode, selectedRole }) => handleRoleSelected(io, userId, roomCode, selectedRole));
        socket.on('confirmTeam', ({ userId, roomCode }) => handleTeamConfirmed(io, userId, roomCode));
        socket.on('revealRole', ({ userId, roomCode }) => handleRevealRole(io, userId, roomCode));
        socket.on('endGame', ({ roomCode, winnersIds }) => handleEndGame(io, socket, roomCode, winnersIds));
        
        // Role specific functions
        socket.on('conceal', ({ userId, roomCode }) => handleConceal(io, userId, roomCode))
        socket.on('cultification', ({ userId, roomCode, cultistsIds }) => handleCultification(io, userId, roomCode, cultistsIds))
        
        socket.on('error', (error) => console.log(`[${new Date().toISOString()}] Socket error:${error}`));
    });
}
