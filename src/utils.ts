import { Role, User, SanitizedUser, Room, TableClients } from './types';
import { TableClient } from '@azure/data-tables';
import { Server as HttpServer } from 'http';
import { Server as IoServer, Server } from 'socket.io';

function assignRoles(numPlayers: number, room: Room) {
    const roleOrder = ["Monarch", "Bandit", "Bandit", "Knight", "Renegade", "Noble", "Noble", "Bandit"];
    let neededRoles = roleOrder.slice(0, numPlayers);
    let assignedRoles: Role[] = [];
    let roomSelectedRoles = room.selectedRoles;
    for (let roleType of neededRoles) {
        let potentialRoles = roomSelectedRoles
            .filter(role => {
            return role.type === roleType && room && room.previousGameRoles && !room.previousGameRoles.some(prevRole => prevRole.name === role.name)
            });
  
        if (potentialRoles.length === 0) {
            potentialRoles = roomSelectedRoles
                .filter(role => role.type === roleType)
        }
  
      let chosenRole = potentialRoles[Math.floor(Math.random() * potentialRoles.length)];
      assignedRoles.push(chosenRole);
    }
  
    // Jester check
    let renegade: Role | undefined = assignedRoles.find(r => r.name == "Jester")
    if(renegade){
      let knight: Role | undefined = assignedRoles.find(r => r.type == "Knight")
      if(knight){
        knight.name = "Corrupted "+knight.name;
        knight.ability = "You serve the Jester.\n When you Reveal the Jester is forced to Reveal."+(knight.ability?.replace("Monarch","Jester") ?? "")
      }
    }
    room.previousGameRoles = assignedRoles;
    return assignedRoles;
}

function assignPlayerRoles(room: Room) {
    const gameRoles: Role[] = assignRoles(Object.keys(room.users).length, room);
    const shuffledUsers: User[] = shuffleUsers([...Object.values(room.users)], room.previousMonarchUserId);
    
    shuffledUsers.forEach((user, index) => {
        let currentUser: User = room.users[user.userId];
        currentUser.role = gameRoles[index];
        if(gameRoles[index].type === "Monarch") {
            room.previousMonarchUserId = user.userId;
            currentUser.isRevealed = true;
        }
    });
}

async function createGameEntity(gameId: string, room: Room, tableClients: TableClients) {
    let game = {
        partitionKey: gameId,
        rowKey: new Date().toISOString(),
        gameLength: '', 
    };
    let gameStartTime = room.gameStartedAt;
    if (gameStartTime){
        let gameEndTime = Date.now();
        let gameLengthSeconds = (gameEndTime - gameStartTime) / 1000;
        game.gameLength = `${Math.floor(gameLengthSeconds / 60)}:${gameLengthSeconds % 60}`;
    }
    await tableClients.gameClient.createEntity(game);
}

async function createGameUserEntities(gameId: string, room: Room, winnersIds: string[], tableClients: TableClients) {
    console.log(winnersIds)
    for(let userId in room.users) {
        console.log(winnersIds.includes(userId));
        console.log(userId);
        let userGame = {
            partitionKey: gameId,
            rowKey: userId,
            role: room.users[userId].role?.type,
            isWinner: winnersIds.includes(userId)
        };
        await tableClients.gameUserClient.createEntity(userGame);
    }
}

function generatePlayerTeams(io: Server, room: Room) {
    for (let userId in room.users){
        let sendToUser = room.users[userId];
        let teammates = getTeammates(Object.values(room.users), userId, sendToUser.role);
        if (!Array.isArray(teammates)) {
            teammates = [];
        }
        let team: User[] = [room.users[userId], ...teammates];
        io.to(sendToUser.socketId).emit('gameStarted', { team: team });
    }
}

function generateRoomCode() {
      return Math.floor(100000 + Math.random() * 900000).toString();
};
  
function getTeammates(usersInRoom: User[], userId: string, role: Role | undefined): User[] {
    let teammates: User[] = [];
    if(role){
      if (role.type == "Bandit"){
        teammates = usersInRoom.filter(u => u.role?.type == "Bandit" && u.userId != userId)
      }
      else if (role.type == "Knight"){
        teammates = usersInRoom.filter(u => u.role?.name == "Jester" && u.userId != userId)
      }
      else if (role.type == "Noble"){
        teammates = usersInRoom.filter(u => u.role?.type == "Noble" && u.userId != userId)
      }
    }
    return teammates
}

function gracefulShutdown(io: IoServer, server: HttpServer) {
    console.log('Shutting down gracefully...');
    io.close(() => {
      console.log('Socket.IO connections closed.');
    });
  
    server.close(() => {
      console.log('HTTP server closed.');
    });
}

async function loadRoles(rolesCache: Role[], rolesClient: TableClient) {
    try {
        const entities = rolesClient.listEntities();
        rolesCache.splice(0, rolesCache.length);
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
    } 
    catch (error) {
        console.log('Error occurred while loading roles: ', error);
    }
}
  
function resetRoomInfo(io: Server, room: Room) {
    for(let userId in room.users){
        let user: User = room.users[userId];
        if(!user.isConnected){
            delete room.users[userId];
        } else {
            user.role = undefined;
            user.isRevealed = false;
        }
    }

    room.hasActiveGame = false;
    io.to(room.roomCode).emit('gameEnded', { users: sanitizeUserData(room.users) });
}

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
  
function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
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

export { assignRoles, assignPlayerRoles, createGameEntity, createGameUserEntities, 
        generateRoomCode, generatePlayerTeams, getTeammates, gracefulShutdown, loadRoles, 
        resetRoomInfo, sanitizeUserData, shuffleArray, shuffleUsers };

