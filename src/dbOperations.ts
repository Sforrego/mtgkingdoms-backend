import { GameUserEntity, GameStatsSummary, UserData, Role, Room, TableClients } from './types';
import { TableClient } from '@azure/data-tables';

export const rolesType = ["Monarch", "Knight", "Bandit", "Renegade", "Noble"];

async function createGameEntity(gameId: string, room: Room, tableClients: TableClients) {
    let game = {
      partitionKey: gameId,
          rowKey: new Date().toISOString(),
          gameLength: '', 
        };
        let gameStartTime = room.gameStartedAt;
        if (gameStartTime){
          let gameEndTime = Date.now();
          let gameLengthSeconds = (gameEndTime - gameStartTime) / 1000;
          game.gameLength = `${Math.floor(gameLengthSeconds / 60)}:${gameLengthSeconds % 60}`;
        }
        await tableClients.gameClient.createEntity(game);
  }
  
async function createGameUserEntities(gameId: string, room: Room, winnersIds: string[], tableClients: TableClients) {
    for(let userId in room.users) {
        let user = room.users[userId];
        let potentialRoles = user.potentialRoles || [];

        let userGame = {
        partitionKey: gameId,
        rowKey: userId,
        startingRoleType: user.startingRole?.type,
        endingRoleType: user.role?.type,
        isWinner: winnersIds.includes(userId),
        isRevealed: user.isRevealed,
        potentialRole1: potentialRoles[0]?.name,
        potentialRole2: potentialRoles[1]?.name,
        startingRole: user.startingRole?.name,
        endingRole: user.role?.name,
        };

        await tableClients.gameUserClient.createEntity(userGame);
    }
}

function calculateGameStatsSummary(gameEntities: any[]): GameStatsSummary {
    let summary: GameStatsSummary = {
      gamesPlayed: gameEntities.length,
      wins: gameEntities.filter(e => e.isWinner).length,
      rolesPlayed: {},
      winsPerRole: {},
    };
  
    rolesType.forEach(role => {
      summary.rolesPlayed[role] = 0;
      summary.winsPerRole[role] = 0;
    });
  
    for (const entity of gameEntities) {
      if (entity.role && rolesType.includes(entity.roleType)) {
        summary.rolesPlayed[entity.roleType]++;
        if (entity.isWinner) {
          summary.winsPerRole[entity.roleType]++;
        }
      }
    }
  
    return summary;
  }

async function getUserData(userId: string, tableClient: TableClient): Promise<UserData | null> {
    try {
        const filter = `RowKey eq '${userId}'`;
        const queryResults = tableClient.listEntities<GameUserEntity>({
            queryOptions: { filter: filter }
        });
        
        let userGames = [];
        for await (const entity of queryResults) {
            const timestamp = entity.timestamp ? new Date(entity.timestamp) : new Date(); // or some default value

            const userGame = {
            gameId: entity.partitionKey,
            userId: entity.rowKey,
            timestamp: timestamp,
            startingRoleType: entity.startingRoleType as string,
            endingRoleType: entity.endingRoleType as string,
            isWinner: entity.isWinner as boolean,
            potentialRole1: entity.potentialRole1 as string,
            potentialRole2: entity.potentialRole2 as string,
            startingRole: entity.startingRole as string,
            endingRole: entity.endingRole as string,
            };
            userGames.push(userGame);
        }

        userGames.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        const allTimeGamesStats = calculateGameStatsSummary(userGames);
        const last10GamesStats = calculateGameStatsSummary(userGames.slice(0, 10));
        const last5GamesStats = calculateGameStatsSummary(userGames.slice(0, 5));
        const userData: UserData = {
            userId: userId,
            statsPeriod: 'All time',
            stats: {
                allTime: allTimeGamesStats,
                last5Games: last5GamesStats,
                last10Games: last10GamesStats,
            },
        };

        return userData;

    } catch (error) {
        console.error('Error fetching user data:', error);
        return null;
    }
}

async function getAllRoles(rolesCache: Role[], rolesClient: TableClient) {
    try {
        const entities = rolesClient.listEntities();
        rolesCache.splice(0, rolesCache.length);
        for await (const entity of entities) {
            const role = {
            name: entity.partitionKey,
            type: entity.rowKey,
            image: entity.ImageUrl as string,
            ability: entity.Ability as string
            };
            rolesCache.push(role);
        }
  
        rolesCache.sort((a, b) => {
            const specificOrder = ["Monarch", "Knight", "Bandit", "Renegade", "Noble", "SubRole"];
            return specificOrder.indexOf(a.type!) - specificOrder.indexOf(b.type!);
        });
    } 
    catch (error) {
        console.log(`[${new Date().toISOString()}] Error occurred while loading roles: ${error}`);
    }
}

export { createGameEntity, createGameUserEntities, getUserData, getAllRoles };