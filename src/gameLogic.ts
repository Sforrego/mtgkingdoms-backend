import { shuffle } from 'lodash';
import {  Role, User, SanitizedUser, Room } from './types';
import { Server } from 'socket.io';
import { ROLE_ORDER } from './constants'

function assignPlayerRolesOptions(room: Room) {
    const gameRoles: Role[][] = getGameRoles(Object.keys(room.users).length, room);
    const shuffledUsers: User[] = shuffleUsers([...Object.values(room.users)], room.previousMonarchUserId);
    shuffledUsers.forEach((user, index) => {
      let currentUser: User = room.users[user.userId];
      currentUser.potentialRoles = gameRoles[index]; 
    });
}

function setInitialPlayerRoles(room: Room) {
  Object.values(room.users).forEach(user => {
      if (user.potentialRoles && user.potentialRoles.length > 0) {
          user.role = user.potentialRoles[0];
      } else {
          console.error("No potential roles available for user:", user);
      }
  });
}

function startRoleSelection(io: Server, room: Room) {
  room.selectingRoles = true;
  Object.values(room.users).forEach(user => {
      io.to(user.socketId).emit('selectRole', { potentialRoles: user.potentialRoles });
  });
}

function jesterCheck(room: Room){
  let jesterUser = Object.values(room.users).find(u => u.role?.name === "Jester");
  if (jesterUser) {
    let knightUser = Object.values(room.users).find(u => u.role?.type === "Knight");
    if (knightUser && knightUser.role) {
      knightUser.role.type = "Renegade"
      knightUser.role.name = "Corrupted " + knightUser.role.name;
      knightUser.role.ability = "You serve the Jester.\n When you Reveal the Jester is forced to Reveal." + (knightUser.role.ability?.replace(new RegExp("Monarch", 'g'), "Jester") ?? "");
    }
    console.log("asd");
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

function getGameRoles(numPlayers: number, room: Room) {
  let neededRoles = ROLE_ORDER.slice(0, numPlayers);
  let possibleRoles: Role[][] = [];
  let roomSelectedRoles = [...room.selectedRoles]; 
  shuffle(roomSelectedRoles);
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
  
function shuffleUsers(users: User[], previousMonarchUserId?: string): User[] {
    let otherUsers: User[] = users.filter(user => user.userId !== previousMonarchUserId);
    let shuffledOtherUsers: User[] = shuffle([...otherUsers]);
    if(previousMonarchUserId !== null) {
      let previousMonarchUser = users.find(user => user.userId === previousMonarchUserId);
      if(previousMonarchUser !== undefined) {
        shuffledOtherUsers.push(previousMonarchUser);
      }
    }
    return shuffledOtherUsers;
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
      
      console.log(userId)
      console.log(sanitizedUser)
      return sanitizedUser;
    });
  }

export { assignPlayerRolesOptions, setInitialPlayerRoles, startRoleSelection, generatePlayerTeamsAndStartGame, getGameRoles, getTeammates, resetRoomInfo, sanitizeUserData, shuffleUsers };

