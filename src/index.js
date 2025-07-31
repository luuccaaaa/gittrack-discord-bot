require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { initializeBot } = require('./bot');
const { initializeWebServer } = require('./handlers/webhookHandler');
const express = require('express');
const app = express();

const prisma = new PrismaClient();

async function main() {
  // Initialize and log in the Discord bot
  const botClient = await initializeBot(prisma);

  // Initialize and start the web server for webhooks
  const webServer = initializeWebServer(prisma, botClient);
  const port = process.env.PORT || 3000;
  webServer.listen(port, () => {
    console.log(`Webhook server listening on port ${port}`);
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    // await prisma.$disconnect(); // Potentially keep prisma connected while app is running
  });
