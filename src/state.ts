import { Room, User, Role } from './types.js';

// Global state for users, roles, and rooms
export const users: Record<string, User> = {};
export const rolesCache: Role[] = [];
export const mainRoles: Role[] = [];
export const rooms: Record<string, Room> = {
    // Default room setup
    "690420": {
      hasActiveGame: false,
      gameStartedAt: undefined,
      previousMonarchUserId: undefined,
      previousGameRoles: [],
      roomCode: "690420",
      selectedRolesPool: [], 
      users: {},
      roleSelection: true,
      allRolesSelected: false,
      selectingRoles: false,
      confirmingTeam: false,
      withRevealedRoles: false
    },
    "012345": {
      hasActiveGame: false,
      gameStartedAt: undefined,
      previousMonarchUserId: undefined,
      previousGameRoles: [],
      roomCode: "012345",
      selectedRolesPool: [], 
      users: {},
      roleSelection: true,
      allRolesSelected: false,
      selectingRoles: false,
      confirmingTeam: false,
      withRevealedRoles: true
    },
  };  
