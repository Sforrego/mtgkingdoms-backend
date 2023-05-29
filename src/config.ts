import { TableClient } from '@azure/data-tables';
import { TableClients } from './types';
import dotenv from 'dotenv';

dotenv.config();

const storageConnectionString: string = process.env.MTGKINGDOMS_STORAGE_CONNECTION_STRING!;
const port = process.env.PORT || 9998; // for local development

const tableClients: TableClients = {
  gameClient: TableClient.fromConnectionString(storageConnectionString, "Games"),
  gameUserClient: TableClient.fromConnectionString(storageConnectionString, "GameUsers"),
  rolesClient: TableClient.fromConnectionString(storageConnectionString, "Roles")
}

export { port, tableClients };
