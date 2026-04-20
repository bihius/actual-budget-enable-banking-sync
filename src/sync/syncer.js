import { transformTransaction } from './transformer.js';
import logger from '../logger.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

let syncing = false;

export function _resetSyncing() {
  syncing = false;
}

export function isSyncing() {
  return syncing;
}

export async function syncAll(enableClient, actualClient, store) {
  if (syncing) {
    logger.info('Sync already in progress, skipping');
    return { skipped: true };
  }
  syncing = true;
  const results = [];

  try {
    const mappings = store.getAccountMappings();

    for (const mapping of mappings) {
      let resultEntry = { mapping: mapping.id, status: 'ok', added: 0, updated: 0 };
      try {
        const session = store.getSession(mapping.sessionId);
        if (!session || new Date(session.validUntil) < new Date()) {
          logger.warn(`Session expired for ${mapping.bankName} (${mapping.iban}), skipping`);
          resultEntry.status = 'expired';
          results.push(resultEntry);
          store.addSyncLog({ results: [resultEntry] });
          continue;
        }

        const dateFrom = mapping.lastSyncDate ? daysAgo(7) : daysAgo(90);
        const dateTo = today();

        logger.info(
          `Fetching transactions for ${mapping.bankName} ${mapping.iban} from ${dateFrom} to ${dateTo}`
        );
        const ebTransactions = await enableClient.getAllTransactions(
          mapping.enableAccountUid,
          dateFrom,
          dateTo
        );

        const actualTransactions = ebTransactions
          .filter((tx) => tx.status === 'BOOK')
          .map(transformTransaction);

        if (actualTransactions.length === 0) {
          logger.info(`No booked transactions for ${mapping.bankName}`);
          results.push(resultEntry);
          store.addSyncLog({ results: [resultEntry] });
          // Add a small delay between accounts anyway
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const importResult = await actualClient.importTransactions(
          mapping.actualAccountId,
          actualTransactions
        );

        logger.info(
          `Synced ${mapping.bankName}: added=${importResult.added.length}, updated=${importResult.updated.length}`
        );
        store.updateLastSyncDate(mapping.id, daysAgo(7));
        
        resultEntry.added = importResult.added.length;
        resultEntry.updated = importResult.updated.length;
        results.push(resultEntry);
        store.addSyncLog({ results: [resultEntry] });

        // Add a delay between accounts to avoid hitting rate limits
        await new Promise((r) => setTimeout(r, 5000));
      } catch (err) {
        logger.error({ err }, `Sync failed for ${mapping.bankName}`);
        resultEntry.status = 'error';
        resultEntry.error = err.message;
        results.push(resultEntry);
        store.addSyncLog({ results: [resultEntry] });
      }
    }
  } finally {
    syncing = false;
  }

  return { results };
}
