import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { EnableBankingClient } from './enable-banking/client.js';
import { ActualClient } from './actual/client.js';
import { Store } from './store.js';
import { createRouter } from './web/routes.js';
import { syncAll } from './sync/syncer.js';
import logger from './logger.js';

// @actual-app/api's internal sync client can reject outside the promise we
// await (e.g. a background 'out-of-sync' failure during downloadBudget),
// which otherwise crashes the process as an unhandled rejection. Combined
// with `restart: unless-stopped`, that crash-loops the container and floods
// the Actual server with sync requests on every restart. Log and keep going
// instead - our own retry/backoff logic in connectActual() handles recovery.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection (likely from @actual-app/api) - ignoring');
});

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

let actualLastError = null;

// Retry with growing backoff instead of exiting the process. A hard exit here
// combined with `restart: unless-stopped` crash-loops the container, and each
// attempt re-runs api.downloadBudget()/sync() against the Actual server — if
// the failure is persistent (e.g. a corrupted local Merkle sync tree), that
// floods the server with sync requests instead of failing quietly.
const ACTUAL_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

async function connectActual(attempt) {
  try {
    await actualClient.init(config.actualServerUrl, config.actualPassword, config.actualSyncId);
    actualLastError = null;
    logger.info('Actual Budget connected.');
  } catch (err) {
    actualLastError = err.message;
    logger.error(
      { err, attempt },
      'Failed to connect to Actual Budget. If this persists, the local Merkle sync state may be ' +
        'corrupted - use "Reset sync" in Actual (Settings > Advanced) and restart this service.'
    );

    if (attempt <= ACTUAL_RETRY_DELAYS_MS.length) {
      const delay = ACTUAL_RETRY_DELAYS_MS[attempt - 1];
      logger.warn(`Retrying Actual Budget connection in ${delay / 1000}s (attempt ${attempt})`);
      setTimeout(() => connectActual(attempt + 1), delay).unref();
    } else {
      logger.error(
        'Giving up on automatic Actual Budget reconnection after repeated failures. ' +
          'Restart this service once the underlying issue is resolved.'
      );
    }
  }
}

logger.info('Initializing Actual Budget connection...');
await connectActual(1);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(createRouter({ enableClient, actualClient, store, config }));

// Health check endpoint
app.get('/health', (req, res) => {
  const ready = actualClient.isReady();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    actualConnected: ready,
    actualLastError,
    uptime: process.uptime(),
  });
});

app.listen(config.port, () => {
  logger.info(`Web UI is ready at http://localhost:${config.port}`);
});

cron.schedule(config.syncCron, async () => {
  if (!actualClient.isReady()) {
    logger.warn('Skipping scheduled sync: Actual Budget is not connected');
    return;
  }
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
