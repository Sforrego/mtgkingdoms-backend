setup .env with remember to use dev values for testing:
MTGKINGDOMS_CLIENT_ID
MTGKINGDOMS_TENANT_ID
MTGKINGDOMS_STORAGE_CONNECTION_STRING
For Client (application) and Tenant (directory) ID: MTGKingdoms directory -> Microsoft Entra ID -> App registrations

to run the backend execute:

npm install
npm run build
npm start

To deploy install Azure App Services in VSCode, then right click the mtgkindoms-backend folder and at the bottom select deploy to web app.