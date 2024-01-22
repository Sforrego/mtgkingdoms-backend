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

interface TableClients {
  gameClient: TableClient,
  gameUserClient: TableClient,
  rolesClient: TableClient,
}

interface UserData {
  userId: string;
  statsPeriod: 'All time' | 'Last 10' | 'Last 5'  ;
  stats: {
    last5Games?: GameStatsSummary;
    last10Games?: GameStatsSummary;
    allTime?: GameStatsSummary;
  };
};

interface GameStatsSummary {
  gamesPlayed: number;
  wins: number;
  rolesPlayed: {
      [roleName: string]: number;
  };
  winsPerRole: {
      [roleName: string]: number,
  }
};

type GameUserEntity = {
  etag: string;
  partitionKey?: string;
  rowKey?: string;
  timestamp?: string;
  role?: string;
  isWinner?: boolean;
};


export { GameStatsSummary, GameUserEntity, Role, Room, User, UserData, SanitizedUser, TableClients };
