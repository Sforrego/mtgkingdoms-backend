import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { attachSocketEvents } from './socketEvents.js';
import { port, tableClients } from './config.js';
import { gracefulShutdown } from './utils.js';
import { getAllRoles } from './dbOperations.js';
import { rolesCache, mainRoles, rooms } from './state.js';

dotenv.config();
const app = express();

app.get('/', (_, res) => {
  res.send('Hello, this is a test endpoint!');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors:{
       origin: ["http://localhost:3000", "https://agreeable-river-08f60e510.3.azurestaticapps.net"],
       methods: ["GET", "POST"],
       allowedHeaders: ["my-custom-header"],
       credentials: true
    }
});

getAllRoles(rolesCache, mainRoles, tableClients.rolesClient);
rooms["690420"].selectedRolesPool = mainRoles;
rooms["012345"].selectedRolesPool = mainRoles;
attachSocketEvents(io);

process.on('SIGTERM', () => {
  gracefulShutdown(io, server);
});

process.on('SIGINT', () => {
  gracefulShutdown(io, server);
});

server.listen(port, () => {
  console.log(`[${new Date().toISOString()}] Listening on port ${port}`);
}).on('error', (e) => {
  console.error(`Failed to start server: ${e.message}`);
});
