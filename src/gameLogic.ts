import lodash from 'lodash';
import {  Role, User, SanitizedUser, Room } from './types.js';
import { Server } from 'socket.io';
import { ROLE_ORDER } from './constants.js'

const { shuffle } = lodash;

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

function startTeamConfirmation(io: Server, room: Room) {
  room.selectingRoles = false;
  room.confirmingTeam = true;
  Object.values(room.users).forEach(user => {
    let team: User[] = Object.values(room.users).filter(u => user.teamIds?.includes(u.userId));
    io.to(user.socketId).emit('reviewTeam', { team });
  });
}

function resetPreviousGameRoles(room: Room){
  room.previousGameRoles = [];
  for (let userId in room.users){
  let user = room.users[userId];
    if(user.role){
      room.previousGameRoles.push(user.role)
    }
  }
}

function generateTeams(io: Server, room: Room) {
  for (let userId in room.users){
    let user = room.users[userId];
    if(user.role){
      room.previousGameRoles.push(user.role)
    }
    
    let teammatesIds = getTeammatesIds(Object.values(room.users), userId, user.role, room.withRevealedRoles);
    if (!Array.isArray(teammatesIds)) {
      teammatesIds = [];
    }
    
    let teamIds: string[] = [userId, ...teammatesIds];
    user.teamIds = teamIds;
  }
}

function preConfirmationActions(room: Room){
  resetPreviousGameRoles(room);
}

function startGame(io: Server, room: Room) {
  var nobles = Object.values(room.users).filter(u => u.role?.type == "Noble").map(u => u.role);
  room.gameStartedAt = Date.now();
  for (let userId in room.users){
    let user = room.users[userId];
    if (user.role?.type === "Monarch"){
      room.previousMonarchUserId = user.userId;
    }

    if (user.role?.startsRevealed){
      user.isRevealed = true;
    }

    let teammates = user.teamIds ?? [];
    let team: User[] = [user, ...teammates.filter(id => id !== user.userId).map(id => room.users[id])];
    io.to(user.socketId).emit('gameStarted', { team: team, nobles: nobles });
  }
  
  io.to(room.roomCode).emit('gameUpdated', { usersInRoom: sanitizeUserData(room) });
}

function getGameRoles(numPlayers: number, room: Room) {
  let neededRoles = ROLE_ORDER.slice(0, numPlayers);
  let possibleRoles: Role[][] = [];
  let roomSelectedRoles = [...room.selectedRolesPool];
  let charactersPerRole = room.roleSelection ? 2 : 1;
  let previousRoles = room.previousGameRoles ? new Set(room.previousGameRoles.map(role => role.name)) : new Set();

  for (let roleType of neededRoles) {
    // Filter out roles that were used in the previous game, if possible
    let potentialRoles = roomSelectedRoles.filter(role =>
      role.type === roleType &&
      !previousRoles.has(role.name) &&
      (
        (room.withRevealedRoles && (role.revealedMode === "revealed" || role.revealedMode === "both")) ||
        (!room.withRevealedRoles && (role.revealedMode === "hidden" || role.revealedMode === "both"))
      )
    );

    if (potentialRoles.length < charactersPerRole) {
      // If not enough new roles, add roles from the previous game
      let backupRoles = roomSelectedRoles.filter(role =>
        role.type === roleType &&
        !potentialRoles.includes(role) &&
        (
          (room.withRevealedRoles && (role.revealedMode === "revealed" || role.revealedMode === "both")) ||
          (!room.withRevealedRoles && (role.revealedMode === "hidden" || role.revealedMode === "both"))
        )
      );
      potentialRoles = [...potentialRoles, ...backupRoles];
    }

    let chosenRoles = [];
    while (chosenRoles.length < charactersPerRole && potentialRoles.length > 0) {
      let roleIndex = Math.floor(Math.random() * potentialRoles.length);
      let chosenRole = potentialRoles.splice(roleIndex, 1)[0];
      chosenRoles.push(chosenRole);
      // Ensure the chosen role is not selected again for another player
      roomSelectedRoles = roomSelectedRoles.filter(role => role !== chosenRole);
    }

    if (chosenRoles.length < charactersPerRole) {
      console.error(`Not enough roles to assign ${charactersPerRole} choices per player for the role: ${roleType}.`);
    } else {
      // Store chosen roles in possibleRoles, preserving the order of the ROLE_ORDER array
      possibleRoles.push(chosenRoles);
    }
  }

  return possibleRoles;
}

function getTeammatesIds(usersInRoom: User[], userId: string, role: Role | undefined, withRevealedRoles: boolean): string[] {
  let teammates: string[] = [];
  if(role){
    if (role.type == "Bandit"){
      teammates = usersInRoom.filter(u => u.role?.type == "Bandit" && u.userId != userId).map(u => u.userId);
    }
    else if (role.type == "Knight"){
      teammates = usersInRoom.filter(u => u.role?.type == "Monarch" && u.userId != userId).map(u => u.userId);
    }
    else if (role.type == "Monarch" && withRevealedRoles){
      teammates = usersInRoom.filter(u => u.role?.type == "Knight" && u.userId != userId).map(u => u.userId);
    }
    else if (role.type == "Noble"){
      teammates = usersInRoom.filter(u => u.role?.type == "Noble" && u.userId != userId).map(u => u.userId);
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
    user.hasReviewedTeam = false;
    if(!user.isConnected){
      delete room.users[userId];
    }
  }
  
  room.gameStartedAt = undefined;
  room.hasActiveGame = false;
  io.to(room.roomCode).emit('gameEnded', { usersInRoom: sanitizeUserData(room) });
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

function sanitizeRole(role?: Role): Role {
  return {
    type: role?.type,
  };
}

function sanitizeUserData(room: Room, userId?: string): SanitizedUser[] {
  const users = room.users;
  return Object.keys(users).map(id => {
    const user = users[id];
    const sanitizedUser: SanitizedUser = {
      ...user,
      role: room.withRevealedRoles && room.gameStartedAt ? sanitizeRole(user.role) : undefined,
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


export { assignPlayerRolesOptions, setInitialPlayerRoles, startRoleSelection, startTeamConfirmation, generateTeams, preConfirmationActions, startGame, getGameRoles, getTeammatesIds, resetRoomInfo, sanitizeUserData, shuffleUsers };

