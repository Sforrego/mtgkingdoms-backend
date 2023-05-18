require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwksRsa = require('jwks-rsa');
const { expressjwt: jwt } = require('express-jwt');

const app = express();

const clientId = process.env.MTGKINGDOMS_CLIENT_ID;
const tenantId = process.env.MTGKINGDOMS_TENANT_ID;

// Middleware for validating JWTs
const checkJwt = jwt({
    // Provide a signing key based on the key identifier in the header and the signing keys provided by your Azure AD B2C endpoint.
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://MTGKingdoms.b2clogin.com/MTGKingdoms.onmicrosoft.com/B2C_1_signupsignin/discovery/v2.0/keys`,
    }),
    // Validate the audience (your application ID) and the issuer.
    audience: clientId,
    issuer: `https://MTGKingdoms.b2clogin.com/${tenantId}/v2.0/`,
    algorithms: ['RS256'],
});

app.use(checkJwt);

const server = http.createServer(app);
const io = socketIo(server, {
    cors:{
       origin: "http://localhost:3000",
       methods: ["GET", "POST"],
       allowedHeaders: ["my-custom-header"],
       credentials: true
    }
});

io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });

  socket.on('error', (error) => {
    console.log('Socket error:', error);
  });
});

server.listen(9998, () => console.log('Listening on port 9998'));

