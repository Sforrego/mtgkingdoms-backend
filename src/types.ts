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
  previousGameRoles: Role[];
  roleSelection: boolean,
  roomCode: string;
  selectedRoles: Role[];
  users: { [userId: string]: User };
  allRolesSelected: boolean;
  selectingRoles: boolean;
  confirmingTeam: boolean;
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
  hasReviewedTeam: boolean;
  roomCode?: string;
  teamIds?: string[];
}

interface SanitizedUser extends Omit<User, 'role'> {
  role?: Role;
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

interface TableClients {
  gameClient: TableClient,
  gameUserClient: TableClient,
  rolesClient: TableClient,
}

type GameUserEntity = {
  etag: string;
  partitionKey?: string;
  rowKey?: string;
  timestamp?: string;
  startingRoleType?: string,
  endingRoleType?: string,
  isWinner?: boolean;
  isRevealed?: boolean;
  potentialRole1?: string,
  potentialRole2?: string,
  startingRole?: string,
  endingRole?: string;
};


export { GameStatsSummary, GameUserEntity, Role, Room, User, UserData, SanitizedUser, TableClients };
