import { TableClient } from '@azure/data-tables';
import { TableClients } from './types';
import dotenv from 'dotenv';

dotenv.config();

const storageConnectionString: string = process.env.MTGKINGDOMS_STORAGE_CONNECTION_STRING!;
if (!storageConnectionString) {
  throw new Error("Storage connection string is not set in environment variables.");
}

const port = process.env.PORT || 9998; // for local development

const tableClients: TableClients = {
  gameClient: TableClient.fromConnectionString(storageConnectionString, "Games"),
  gameUserClient: TableClient.fromConnectionString(storageConnectionString, "GameUsers"),
  rolesClient: TableClient.fromConnectionString(storageConnectionString, "Roles")
}

export { port, tableClients };