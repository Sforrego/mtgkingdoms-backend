import { TableClient } from "@azure/data-tables";

interface Role {
  ability?: string;
  image?: string;
  name?: string;
  type?: string;
}

interface Room {
  hasActiveGame: boolean;
  gameStartedAt?: number;
  previousMonarchUserId?: string;
  previousGameRoles?: Role[];
  roomCode: string;
  selectedRoles: Role[];
  users: { [userId: string]: User };
}

interface User {
  isConnected: boolean;
  isRevealed?: boolean;
  socketId: string;
  role?: Role;
  roomCode?: string;
  userId: string;
  username: string;
}

interface SanitizedUser extends Omit<User, 'role'> {
  role?: Role;
}

type TableClients = {
  gameClient: TableClient,
  gameUserClient: TableClient,
  rolesClient: TableClient,
}

export { Role, Room, User, SanitizedUser, TableClients };
