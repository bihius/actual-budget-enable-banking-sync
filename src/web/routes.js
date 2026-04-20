import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { syncAll, isSyncing } from '../sync/syncer.js';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(__dirname, 'views');

function readView(name) {
  return readFileSync(join(viewsDir, name), 'utf8');
}

const SUPPORTED_COUNTRIES = [
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'GR', name: 'Greece' },
  { code: 'HR', name: 'Croatia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IT', name: 'Italy' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'LV', name: 'Latvia' },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SK', name: 'Slovakia' },
];

export function createRouter({ enableClient, actualClient, store, config }) {
  const router = Router();

  // Dashboard
  router.get('/', async (req, res) => {
    let actualAccounts = [];
    try {
      actualAccounts = await actualClient.getAccounts();
    } catch (err) {
      logger.error({ err }, 'Failed to fetch actual accounts for dashboard');
    }

    const mappings = store.getAccountMappings().map((m) => {
      const session = store.getSession(m.sessionId);
      const expired = !session || new Date(session.validUntil) < new Date();
      const actualAcc = actualAccounts.find((a) => a.id === m.actualAccountId);
      const displayName = actualAcc
        ? actualAcc.name
        : m.bankName === 'Bank'
          ? 'Unknown Bank'
          : m.bankName;
      return { ...m, expired, displayName, validUntil: session?.validUntil };
    });

    const syncLogs =
      store
        .getSyncLogs()
        .map((log) => {
          const time = new Date(log.timestamp).toLocaleString();
          const details = log.results
            .map((r) => {
              const m = mappings.find((map) => map.id === r.mapping);
              const name = m ? m.displayName : 'Unknown';
              if (r.status === 'error') return `${name}: ERROR (${r.error})`;
              if (r.status === 'expired') return `${name}: Session Expired`;
              return `${name}: +${r.added}, updated ${r.updated}`;
            })
            .join('; ');
          return `<div class="log-entry"><strong>${time}</strong>: ${details}</div>`;
        })
        .join('') || '<p style="color:#888;font-size:0.9rem">No sync history yet</p>';

    let html = readView('index.html');
    
    // Add Syncing status to header if active
    const syncStatusHeader = isSyncing() 
      ? '<div style="background:#fff3cd;color:#856404;padding:0.75rem;border-radius:8px;margin-bottom:1.5rem;border:1px solid #ffeeba"><strong>Sync in progress...</strong> The system is currently fetching data from your bank. Refresh in a few minutes to see results.</div>' 
      : '';
    
    html = html.replace('{{SYNC_STATUS}}', syncStatusHeader);

    let rows = '';
    if (mappings.length === 0) {
      rows =
        '<tr><td colspan="4" style="text-align:center;color:#888">No bank connections yet</td></tr>';
    } else {
      for (const m of mappings) {
        let nameHtml = `<strong>${m.displayName}</strong>`;
        if (m.expired) {
          nameHtml +=
            '<br><span style="color:#e74c3c;font-size:0.8rem;font-weight:bold">Expired - Reconnect needed</span>';
        } else if (m.validUntil) {
          const expiryDate = new Date(m.validUntil).toLocaleDateString();
          nameHtml += `<br><span style="color:#7f8c8d;font-size:0.75rem">Session valid until: ${expiryDate}</span>`;
        }

        rows += `<tr>
          <td>${nameHtml}</td>
          <td>${m.iban || '-'}</td>
          <td>${m.lastSyncDate || 'Never'}</td>
          <td>
            <form method="POST" action="/accounts/${m.id}/reset-sync" style="display:inline">
              <button type="submit" class="btn btn-sm btn-warning">Re-sync</button>
            </form>
            <form method="POST" action="/disconnect/${m.id}" style="display:inline">
              <button type="submit" class="btn btn-sm btn-danger">Disconnect</button>
            </form>
          </td>
        </tr>`;
      }
    }
    html = html.replace('{{ROWS}}', rows).replace('{{SYNC_LOGS}}', syncLogs);
    res.send(html);
  });

  // Country selector + bank list
  router.get('/connect', async (req, res) => {
    const { country } = req.query;

    const countryOptions = SUPPORTED_COUNTRIES.map(
      (c) =>
        `<option value="${c.code}"${country === c.code ? ' selected' : ''}>${c.name} (${c.code})</option>`
    ).join('\n');

    let cards = '';
    if (country) {
      try {
        const result = await enableClient.getAspsps(country);
        const banks = Array.isArray(result) ? result : result?.aspsps || [];
        for (const bank of banks) {
          const name = bank.name || bank.aspsp_name || 'Unknown';
          cards += `<div class="bank-card">
            <form method="POST" action="/connect/start">
              <input type="hidden" name="aspspName" value="${name}">
              <input type="hidden" name="aspspCountry" value="${country}">
              <button type="submit" class="bank-btn">${name}</button>
            </form>
          </div>`;
        }
        if (!cards) cards = '<p class="no-banks">No banks found for this country.</p>';
      } catch (err) {
        cards = `<p class="no-banks">Error loading banks: ${err.message}</p>`;
      }
    }

    let html = readView('connect.html');
    html = html
      .replace('{{COUNTRY_OPTIONS}}', countryOptions)
      .replace('{{BANKS}}', cards)
      .replace('{{SELECTED_COUNTRY}}', country || '');
    res.send(html);
  });

  // Start auth
  router.post('/connect/start', async (req, res) => {
    try {
      const { aspspName, aspspCountry } = req.body;
      const redirectUrl = `${config.redirectBaseUrl}/auth/callback?aspsp_name=${encodeURIComponent(aspspName)}`;
      const state = randomUUID();
      const result = await enableClient.startAuth(aspspName, aspspCountry, redirectUrl, state);
      res.redirect(result.url);
    } catch (err) {
      res.status(500).send(`Auth start failed: ${err.message}`);
    }
  });

  // Auth callback
  router.get('/auth/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`Bank authorization error: ${error}`);
    if (!code) return res.status(400).send('Missing authorization code');

    try {
      const session = await enableClient.createSession(code);
      store.addSession({
        sessionId: session.session_id,
        aspspName: req.query.aspsp_name || 'Bank',
        validUntil:
          session.access?.valid_until ||
          new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        accounts: session.accounts || [],
        createdAt: new Date().toISOString(),
      });
      res.redirect(`/map/${session.session_id}`);
    } catch (err) {
      res.status(500).send(`Session creation failed: ${err.message}`);
    }
  });

  // Account mapping
  router.get('/map/:sessionId', async (req, res) => {
    const session = store.getSession(req.params.sessionId);
    if (!session) return res.status(404).send('Session not found');

    let actualAccounts;
    try {
      actualAccounts = await actualClient.getAccounts();
    } catch (err) {
      return res.status(500).send(`Failed to get Actual accounts: ${err.message}`);
    }

    let html = readView('map.html');

    let ebOptions = '';
    for (const acc of session.accounts) {
      const label = `${acc.account_id?.iban || acc.uid} (${acc.currency || '?'})`;
      ebOptions += `<option value="${acc.uid}" data-iban="${acc.account_id?.iban || ''}">${label}</option>`;
    }

    let actualOptions = '';
    for (const acc of actualAccounts) {
      actualOptions += `<option value="${acc.id}">${acc.name}</option>`;
    }

    html = html
      .replace('{{SESSION_ID}}', session.sessionId)
      .replace('{{BANK_NAME}}', session.aspspName)
      .replace('{{EB_ACCOUNTS}}', ebOptions)
      .replace('{{ACTUAL_ACCOUNTS}}', actualOptions);

    res.send(html);
  });

  // Save mapping
  router.post('/map', async (req, res) => {
    const { sessionId, enableAccountUid, iban, newAccountName, newAccountType, newAccountBalance } =
      req.body;
    let { actualAccountId } = req.body;
    const session = store.getSession(sessionId);

    if (newAccountName) {
      const balance = newAccountBalance ? Math.round(parseFloat(newAccountBalance) * 100) : 0;
      actualAccountId = await actualClient.createAccount(
        newAccountName,
        newAccountType || 'checking',
        balance
      );
    }

    if (!actualAccountId) {
      return res.status(400).send('Select an existing account or fill in a new account name.');
    }

    store.addAccountMapping({
      sessionId,
      enableAccountUid,
      actualAccountId,
      bankName: session?.aspspName || 'Bank',
      iban: iban || '',
      lastSyncDate: null,
    });

    res.redirect('/');
  });

  // Manual sync - run in background to prevent timeouts
  router.post('/sync/now', (req, res) => {
    // Check if already syncing
    // We can't await syncAll here because it takes too long
    // But we can fire it off
    actualClient
      .sync()
      .then(() => syncAll(enableClient, actualClient, store))
      .then((results) => {
        logger.info({ results }, 'Manual background sync complete');
      })
      .catch((err) => {
        logger.error({ err }, 'Manual background sync failed');
      });

    res.json({ status: 'started' });
  });

  // Reset sync date (force full 90-day re-fetch on next sync)
  router.post('/accounts/:id/reset-sync', (req, res) => {
    store.resetSyncDate(req.params.id);
    res.redirect('/');
  });

  // Disconnect
  router.post('/disconnect/:id', (req, res) => {
    store.removeAccountMapping(req.params.id);
    res.redirect('/');
  });

  // Status API
  router.get('/api/status', (req, res) => {
    const mappings = store.getAccountMappings().map((m) => {
      const session = store.getSession(m.sessionId);
      return {
        ...m,
        sessionValid: session && new Date(session.validUntil) > new Date(),
      };
    });
    res.json({ mappings, sessions: store.getSessions() });
  });

  return router;
}
