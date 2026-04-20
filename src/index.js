import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { EnableBankingClient } from './enable-banking/client.js';
import { ActualClient } from './actual/client.js';
import { Store } from './store.js';
import { createRouter } from './web/routes.js';
import { syncAll } from './sync/syncer.js';

const store = new Store(config.dataDir);
store.load();

const enableClient = new EnableBankingClient(config.appId, config.privateKey);
const actualClient = new ActualClient();

console.log('Initializing Actual Budget connection...');
await actualClient.init(config.actualServerUrl, config.actualPassword, config.actualSyncId);
console.log('Actual Budget connected.');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(createRouter({ enableClient, actualClient, store, config }));

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

cron.schedule(config.syncCron, async () => {
  console.log(`[${new Date().toISOString()}] Starting scheduled sync...`);
  try {
    await actualClient.sync();
    const results = await syncAll(enableClient, actualClient, store);
    console.log('Scheduled sync complete:', JSON.stringify(results));
  } catch (err) {
    console.error('Scheduled sync failed:', err);
  }
});

console.log(`Cron sync scheduled: ${config.syncCron}`);
