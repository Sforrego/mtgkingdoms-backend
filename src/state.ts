import { Room, User, Role } from './types';

// Global state for users, roles, and rooms
export const users: Record<string, User> = {};
export const rolesCache: Role[] = [];
export const rooms: Record<string, Room> = {
    // Default room setup
    "690420": {
      hasActiveGame: false,
      gameStartedAt: undefined,
      previousMonarchUserId: undefined,
      previousGameRoles: undefined,
      roomCode: "690420",
      selectedRoles: [], 
      users: {},
      roleSelection: true,
      allRolesSelected: false,
      selectingRoles: false
    }
  };  
