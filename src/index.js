import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { EnableBankingClient } from './enable-banking/client.js';
import { ActualClient } from './actual/client.js';
import { Store } from './store.js';
import { createRouter } from './web/routes.js';
import { syncAll } from './sync/syncer.js';
import logger from './logger.js';

const BANNER = `
┌────────────────────────────────────────────────────────┐
│                                                        │
│   🚀 Actual Budget - Enable Banking Sync Started       │
│                                                        │
│   Port: ${config.port.toString().padEnd(47)} │
│   Cron: ${config.syncCron.padEnd(47)} │
│                                                        │
└────────────────────────────────────────────────────────┘
`;

function validateConfig() {
  const required = [
    ['ENABLE_BANKING_APP_ID', config.appId],
    ['ACTUAL_PASSWORD', config.actualPassword],
    ['ACTUAL_SYNC_ID', config.actualSyncId],
    ['REDIRECT_BASE_URL', config.redirectBaseUrl],
  ];

  const missing = required.filter(([, val]) => !val).map(([name]) => name);

  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (!config.privateKey) {
    logger.error(`Failed to read Enable Banking RSA key from: ${config.keyPath}`);
    process.exit(1);
  }
}

validateConfig();
logger.info(BANNER);

const store = new Store(config.dataDir);
store.load();

const enableClient = new EnableBankingClient(config.appId, config.privateKey);
const actualClient = new ActualClient();

logger.info('Initializing Actual Budget connection...');
try {
  await actualClient.init(config.actualServerUrl, config.actualPassword, config.actualSyncId);
  logger.info('Actual Budget connected.');
} catch (err) {
  logger.error(
    { err },
    'Failed to connect to Actual Budget. Check your credentials and server URL.'
  );
  process.exit(1);
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(createRouter({ enableClient, actualClient, store, config }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(config.port, () => {
  logger.info(`Web UI is ready at http://localhost:${config.port}`);
});

cron.schedule(config.syncCron, async () => {
  logger.info('Starting scheduled sync...');
  try {
    await actualClient.sync();
    const results = await syncAll(enableClient, actualClient, store);
    logger.info({ results }, 'Scheduled sync complete');
  } catch (err) {
    logger.error({ err }, 'Scheduled sync failed');
  }
});

logger.info(`Next sync scheduled according to: ${config.syncCron}`);
