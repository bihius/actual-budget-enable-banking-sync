import { readFileSync } from 'fs';

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const keyPath = process.env.ENABLE_BANKING_KEY_PATH || '/keys/private.pem';

let privateKey;
try {
  privateKey = readFileSync(keyPath, 'utf8');
} catch (err) {
  // We'll log this in index.js, but need to provide a value to avoid total crash here
  privateKey = null;
}

export const config = {
  appId: process.env.ENABLE_BANKING_APP_ID, // Use process.env directly to allow validation in index.js
  privateKey,
  keyPath,
  actualServerUrl: process.env.ACTUAL_SERVER_URL || 'http://actual:5006',
  actualPassword: required('ACTUAL_PASSWORD'),
  actualSyncId: required('ACTUAL_SYNC_ID'),
  redirectBaseUrl: required('REDIRECT_BASE_URL'),
  syncCron: process.env.SYNC_CRON || '0 */6 * * *',
  dataDir: process.env.DATA_DIR || process.cwd(),
  port: parseInt(process.env.PORT || '3000', 10),
};
