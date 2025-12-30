import { Room, User, Role } from './types.js';
import { DEFAULT_ROOM_CODE } from './constants.js';
// Global state for users, roles, and rooms
export const users: Record<string, User> = {};
export const rolesCache: Role[] = [];
export const mainRoles: Role[] = [];
export const rooms: Record<string, Room> = {
    // Default room setup
    [DEFAULT_ROOM_CODE[0]]: {
      hasActiveGame: false,
      gameStartedAt: undefined,
      previousMonarchUserId: undefined,
      previousGameRoles: [],
      roomCode: DEFAULT_ROOM_CODE[0],
      selectedRolesPool: [], 
      users: {},
      roleSelection: true,
      allRolesSelected: false,
      selectingRoles: false,
      confirmingTeam: false,
      withRevealedRoles: true,
      inactivityCleanupTimer: undefined
    },
    [DEFAULT_ROOM_CODE[1]]: {
      hasActiveGame: false,
      gameStartedAt: undefined,
      previousMonarchUserId: undefined,
      previousGameRoles: [],
      roomCode: DEFAULT_ROOM_CODE[1],
      selectedRolesPool: [], 
      users: {},
      roleSelection: true,
      allRolesSelected: false,
      selectingRoles: false,
      confirmingTeam: false,
      withRevealedRoles: true,
      inactivityCleanupTimer: undefined
    },
  };  
