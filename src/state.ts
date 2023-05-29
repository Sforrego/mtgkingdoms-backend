import { Room, User, Role } from './types';

export const rooms: Record<string, Room> = {};
export const users: Record<string, User> = {};
export const rolesCache: Role[] = [];
