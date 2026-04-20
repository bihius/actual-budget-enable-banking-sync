import * as api from '@actual-app/api';

export class ActualClient {
  #initialized = false;

  async init(serverURL, password, syncId) {
    if (this.#initialized) return;
    await api.init({ serverURL, password });
    await api.downloadBudget(syncId);
    this.#initialized = true;
  }

  async getAccounts() {
    return api.getAccounts();
  }

  async createAccount(name, type, initialBalance) {
    return api.createAccount({ name, type, offbudget: false }, initialBalance || 0);
  }

  async importTransactions(accountId, transactions) {
    return api.importTransactions(accountId, transactions);
  }

  async sync() {
    if (!this.#initialized) return;
    await api.sync();
  }

  async shutdown() {
    if (!this.#initialized) return;
    await api.shutdown();
    this.#initialized = false;
  }
}
