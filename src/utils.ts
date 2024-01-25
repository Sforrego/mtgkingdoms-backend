import { GameStatsSummary, GameUserEntity, Role, User, UserData, SanitizedUser, Room, TableClients } from './types';
import { TableClient } from '@azure/data-tables';
import { Server as HttpServer } from 'http';
import { Server as IoServer, Server } from 'socket.io';

const roleOrder = ["Monarch", "Bandit", "Knight", "Bandit", "Renegade", "Noble", "Noble", "Bandit"];
export const rolesType = ["Monarch", "Knight", "Bandit", "Renegade", "Noble"];

function assignPlayerRoles(room: Room) {
    const gameRoles: Role[][] = getGameRoles(Object.keys(room.users).length, room);
    const shuffledUsers: User[] = shuffleUsers([...Object.values(room.users)], room.previousMonarchUserId);
    shuffledUsers.forEach((user, index) => {
      let currentUser: User = room.users[user.userId];
      currentUser.potentialRoles = gameRoles[index]; 
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
  for(let userId in room.users) {
    let user = room.users[userId];
    let potentialRoles = user.potentialRoles || [];

    let userGame = {
      partitionKey: gameId,
      rowKey: userId,
      roleType: user.role?.type,
      role: user.role?.name,
      isWinner: winnersIds.includes(userId),
      potentialRole1: potentialRoles[0]?.name,
      potentialRole2: potentialRoles[1]?.name,
      startingRole: user.startingRole?.name,
    };

    await tableClients.gameUserClient.createEntity(userGame);
    }
  }
  
function jesterCheck(room: Room){
  let jesterUser = Object.values(room.users).find(u => u.role?.name === "Jester");
  if (jesterUser) {
    let knightUser = Object.values(room.users).find(u => u.role?.type === "Knight");
    if (knightUser && knightUser.role) {
      knightUser.role.name = "Corrupted " + knightUser.role.name;
      knightUser.role.ability = "You serve the Jester.\n When you Reveal the Jester is forced to Reveal." + (knightUser.role.ability?.replace("Monarch", "Jester") ?? "");
    }
  }
}

function generatePlayerTeamsAndStartGame(io: Server, room: Room) {
  var nobles = Object.values(room.users).filter(u => u.role?.type == "Noble").map(u => u.role);

  jesterCheck(room);

  for (let userId in room.users){
    let user = room.users[userId];
    if (user.role?.type === "Monarch"){
      room.previousMonarchUserId = user.userId;
      user.isRevealed = true;
    } 

    let teammates = getTeammates(Object.values(room.users), userId, user.role);
    if (!Array.isArray(teammates)) {
        teammates = [];
    }

    let team: User[] = [room.users[userId], ...teammates];
    io.to(user.socketId).emit('gameStarted', { team: team, nobles: nobles });
  }

  room.hasActiveGame = true;
  room.gameStartedAt = Date.now();
  io.to(room.roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room.users) });
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

function getGameRoles(numPlayers: number, room: Room) {
  let neededRoles = roleOrder.slice(0, numPlayers);
  let possibleRoles: Role[][] = [];
  let roomSelectedRoles = [...room.selectedRoles]; 
  shuffleArray(roomSelectedRoles);
  let charactersPerRole = room.roleSelection ? 2 : 1;

  for (let roleType of neededRoles) {
    let potentialRoles = roomSelectedRoles.filter(role => role.type === roleType);

    let chosenRoles = [];
    while (chosenRoles.length < charactersPerRole && potentialRoles.length > 0) {
      let roleIndex = Math.floor(Math.random() * potentialRoles.length);
      let chosenRole = potentialRoles.splice(roleIndex, 1)[0];
      chosenRoles.push(chosenRole);
      roomSelectedRoles = roomSelectedRoles.filter(role => role !== chosenRole);     
    }

    if (chosenRoles.length < charactersPerRole) {
      console.error(`Not enough roles to assign ${charactersPerRole} choices per player for the role: ${roleType}.`);
    }

    possibleRoles.push(chosenRoles);
  }

  return possibleRoles;
}

async function getUserData(userId: string, tableClient: TableClient): Promise<UserData | null> {
  try {
      const filter = `RowKey eq '${userId}'`;
      const queryResults = tableClient.listEntities<GameUserEntity>({
        queryOptions: { filter: filter }
      });
      
      let userGames = [];
      for await (const entity of queryResults) {
          const timestamp = entity.timestamp ? new Date(entity.timestamp) : new Date(); // or some default value

          const userGame = {
          gameId: entity.partitionKey,
          userId: entity.rowKey,
          role: entity.role as string,
          roleType: entity.roleType as string,
          potentialRole1: entity.potentialRole1 as string,
          potentialRole2: entity.potentialRole2 as string,
          startingRole: entity.startingRole as string,
          isWinner: entity.isWinner as boolean,
          timestamp: timestamp
          };
          userGames.push(userGame);
      }

      userGames.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const allTimeGamesStats = calculateGameStatsSummary(userGames);
      const last10GamesStats = calculateGameStatsSummary(userGames.slice(0, 10));
      const last5GamesStats = calculateGameStatsSummary(userGames.slice(0, 5));
      const userData: UserData = {
          userId: userId,
          statsPeriod: 'All time',
          stats: {
              allTime: allTimeGamesStats,
              last5Games: last5GamesStats,
              last10Games: last10GamesStats,
          },
      };

      return userData;

  } catch (error) {
      console.error('Error fetching user data:', error);
      return null;
  }
}

function calculateGameStatsSummary(gameEntities: any[]): GameStatsSummary {
  let summary: GameStatsSummary = {
    gamesPlayed: gameEntities.length,
    wins: gameEntities.filter(e => e.isWinner).length,
    rolesPlayed: {},
    winsPerRole: {},
  };

  rolesType.forEach(role => {
    summary.rolesPlayed[role] = 0;
    summary.winsPerRole[role] = 0;
  });

  for (const entity of gameEntities) {
    if (entity.role && rolesType.includes(entity.roleType)) {
      summary.rolesPlayed[entity.roleType]++;
      if (entity.isWinner) {
        summary.winsPerRole[entity.roleType]++;
      }
    }
  }

  return summary;
}

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
    console.log(`[${new Date().toISOString()}] Shutting down gracefully...`);
    io.close(() => {
      console.log(`[${new Date().toISOString()}] Socket.IO connections closed.`);
    });
  
    server.close(() => {
      console.log(`[${new Date().toISOString()}] HTTP server closed.`);
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
        console.log(`[${new Date().toISOString()}] Error occurred while loading roles: ${error}`);
    }
}
  
function resetRoomInfo(io: Server, room: Room) {
    for(let userId in room.users){
        let user: User = room.users[userId];
        user.role = undefined;
        user.isRevealed = false;
        user.startingRole = undefined;
        user.potentialRoles = [];
        user.hasSelectedRole = false;
        if(!user.isConnected){
            delete room.users[userId];
        }
    }

    room.hasActiveGame = false;
    io.to(room.roomCode).emit('gameEnded', { users: sanitizeUserData(room.users) });
}

function sanitizeUserData(users: { [userId: string]: User }, userId?: string): SanitizedUser[] {
  return Object.keys(users).map(id => {
    const user = users[id];
    const sanitizedUser: SanitizedUser = {
      ...user,
      role: undefined,
      potentialRoles: [],
    };

    if (id === userId) {
      sanitizedUser.role = user.role;
      sanitizedUser.potentialRoles = user.potentialRoles;
    } else if (sanitizedUser.isRevealed) {
      sanitizedUser.role = user.role;
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

export { assignPlayerRoles, createGameEntity, createGameUserEntities, 
        generateRoomCode, generatePlayerTeamsAndStartGame, getGameRoles, getUserData, getTeammates, gracefulShutdown, loadRoles, 
        resetRoomInfo, sanitizeUserData, shuffleArray, shuffleUsers };

