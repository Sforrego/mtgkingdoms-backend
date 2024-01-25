import { Room, User, Role } from './types';

export const users: Record<string, User> = {};
export const rolesCache: Role[] = [];
export const rooms: Record<string, Room> = {
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
