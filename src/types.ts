import { TableClient } from "@azure/data-tables";

interface Role {
  ability?: string;
  image?: string;
  name?: string;
  type?: string;
}

interface Room {
  roomCode: string;
  users: { [userId: string]: User };
  selectedRolesPool: Role[];
  previousGameRoles: Role[];
  previousMonarchUserId?: string;
  gameStartedAt?: number;
  hasActiveGame: boolean;
  roleSelection: boolean, // Defines if a room has the option to select between two roles, default is true.
  selectingRoles: boolean;
  allRolesSelected: boolean;
  confirmingTeam: boolean;
  withRevealedRoles: boolean;
}

interface User {
  userId: string;
  username: string;
  socketId: string;
  isConnected: boolean;
  roomCode?: string;
  isRevealed?: boolean;
  potentialRoles: Role[];
  startingRole?: Role;
  role?: Role;
  hasSelectedRole: boolean;
  hasReviewedTeam: boolean;
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
