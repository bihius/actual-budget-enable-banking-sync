import { transformTransaction } from './transformer.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

let syncing = false;

export async function syncAll(enableClient, actualClient, store) {
  if (syncing) {
    console.log('Sync already in progress, skipping');
    return { skipped: true };
  }
  syncing = true;
  const results = [];

  try {
    const mappings = store.getAccountMappings();

    for (const mapping of mappings) {
      try {
        const session = store.getSession(mapping.sessionId);
        if (!session || new Date(session.validUntil) < new Date()) {
          console.warn(`Session expired for ${mapping.bankName} (${mapping.iban}), skipping`);
          results.push({ mapping: mapping.id, status: 'expired' });
          continue;
        }

        const dateFrom = mapping.lastSyncDate ? daysAgo(7) : daysAgo(90);
        const dateTo = today();

        console.log(`Fetching transactions for ${mapping.bankName} ${mapping.iban} from ${dateFrom} to ${dateTo}`);
        const ebTransactions = await enableClient.getAllTransactions(
          mapping.enableAccountUid, dateFrom, dateTo
        );

        const actualTransactions = ebTransactions
          .filter(tx => tx.status === 'BOOK')
          .map(transformTransaction);

        if (actualTransactions.length === 0) {
          console.log(`No booked transactions for ${mapping.bankName}`);
          results.push({ mapping: mapping.id, status: 'ok', added: 0, updated: 0 });
          continue;
        }

        const result = await actualClient.importTransactions(
          mapping.actualAccountId, actualTransactions
        );

        console.log(`Synced ${mapping.bankName}: added=${result.added.length}, updated=${result.updated.length}`);
        store.updateLastSyncDate(mapping.id, daysAgo(7));
        results.push({
          mapping: mapping.id,
          status: 'ok',
          added: result.added.length,
          updated: result.updated.length,
        });
      } catch (err) {
        console.error(`Sync failed for ${mapping.bankName}:`, err.message);
        results.push({ mapping: mapping.id, status: 'error', error: err.message });
      }
    }
  } finally {
    syncing = false;
  }

  return { results };
}
