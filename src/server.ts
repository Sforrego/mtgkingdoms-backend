import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { attachSocketEvents } from './socketEvents';
import { port, tableClients } from './config';
import { gracefulShutdown, loadRoles } from './utils';
import { rolesCache, rooms } from './state';

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

loadRoles(rolesCache, tableClients.rolesClient);
rooms["690420"].selectedRoles = rolesCache;

attachSocketEvents(io);

process.on('SIGTERM', () => {
  gracefulShutdown(io, server);
});

process.on('SIGINT', () => {
  gracefulShutdown(io, server);
});

server.listen(port, () => console.log(`[${new Date().toISOString()}] Listening on port ${port}`));

