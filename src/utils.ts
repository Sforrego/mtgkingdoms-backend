
import { Server as HttpServer } from 'http';
import { Server as IoServer, Socket } from 'socket.io';

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

function gracefulShutdown(io: IoServer, server: HttpServer) {
    console.log(`[${new Date().toISOString()}] Shutting down gracefully...`);
    io.close(() => {
      console.log(`[${new Date().toISOString()}] Socket.IO connections closed.`);
    });
  
    server.close(() => {
      console.log(`[${new Date().toISOString()}] HTTP server closed.`);
    });
}

function emitError(socket: Socket, message: string) {
  console.error(`[${new Date().toISOString()}] Error: ${message}`);
  socket.emit('error', message);
}

export { emitError, generateRoomCode, gracefulShutdown };

