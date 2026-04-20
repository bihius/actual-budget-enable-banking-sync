import { generateJWT } from './jwt.js';

const BASE_URL = 'https://api.enablebanking.com';

export class EnableBankingClient {
  constructor(appId, privateKeyPem) {
    this.appId = appId;
    this.privateKey = privateKeyPem;
  }

  async _request(method, path, body) {
    const token = generateJWT(this.appId, this.privateKey);
    const url = `${BASE_URL}${path}`;
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const RETRY_DELAYS = [30000, 60000, 120000, 240000, 480000];
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      const res = await fetch(url, opts);
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : (RETRY_DELAYS[attempt] || 600000);
        console.warn(`Rate limited (attempt ${attempt + 1}), retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Enable Banking ${method} ${path} failed (${res.status}): ${text}`);
      }
      return res.json();
    }
    throw new Error(`Enable Banking ${method} ${path} failed after ${RETRY_DELAYS.length + 1} attempts (429)`);
  }

  async getAspsps(country) {
    const params = country ? `?country=${country}` : '';
    return this._request('GET', `/aspsps${params}`);
  }

  async startAuth(aspspName, aspspCountry, redirectUrl, state) {
    const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const body = {
      access: {
        valid_until: validUntil,
        balances: true,
        transactions: true,
      },
      aspsp: { name: aspspName, country: aspspCountry },
      state: state || crypto.randomUUID(),
      redirect_url: redirectUrl,
      psu_type: 'personal',
    };
    console.log('startAuth body:', JSON.stringify(body));
    return this._request('POST', '/auth', body);
  }

  async createSession(code) {
    return this._request('POST', '/sessions', { code });
  }

  async getSession(sessionId) {
    return this._request('GET', `/sessions/${sessionId}`);
  }

  async getTransactions(accountUid, dateFrom, dateTo, continuationKey) {
    let path = `/accounts/${accountUid}/transactions?date_from=${dateFrom}&date_to=${dateTo}`;
    if (continuationKey) path += `&continuation_key=${encodeURIComponent(continuationKey)}`;
    return this._request('GET', path);
  }

  async getAllTransactions(accountUid, dateFrom, dateTo) {
    const all = [];
    let continuationKey = null;
    do {
      const res = await this.getTransactions(accountUid, dateFrom, dateTo, continuationKey);
      if (res.transactions) all.push(...res.transactions);
      continuationKey = res.continuation_key || null;
      if (continuationKey) {
        // Small delay between pages to avoid hitting rate limits too fast
        await new Promise(r => setTimeout(r, 2000));
      }
    } while (continuationKey);
    return all;
  }
}
