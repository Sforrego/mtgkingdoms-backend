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
  roleSelection: boolean,
  roomCode: string;
  selectedRoles: Role[];
  users: { [userId: string]: User };
  allRolesSelected: boolean;
  selectingRoles: boolean;
}

interface User {
  userId: string;
  username: string;
  socketId: string;
  isConnected: boolean;
  isRevealed?: boolean;
  role?: Role;
  potentialRoles: Role[];
  startingRole?: Role;
  hasSelectedRole: boolean;
  roomCode?: string;
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
      [roleType: string]: number;
  };
  winsPerRole: {
      [roleType: string]: number,
  }
};

type GameUserEntity = {
  etag: string;
  partitionKey?: string;
  rowKey?: string;
  timestamp?: string;
  roleType?: string,
  isWinner?: boolean;
  isRevealed?: boolean;
  potentialRole1?: string,
  potentialRole2?: string,
  startingRole?: string,
  endingRole?: string;
};


export { GameStatsSummary, GameUserEntity, Role, Room, User, UserData, SanitizedUser, TableClients };
