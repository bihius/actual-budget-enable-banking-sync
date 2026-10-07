import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@actual-app/api';
import { ActualClient } from './client.js';

vi.mock('@actual-app/api', () => ({
  init: vi.fn(),
  downloadBudget: vi.fn(),
  getAccounts: vi.fn(),
  createAccount: vi.fn(),
  importTransactions: vi.fn(),
  sync: vi.fn(),
  shutdown: vi.fn(),
}));

describe('ActualClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only becomes ready after the downloaded budget can be queried', async () => {
    api.getAccounts.mockResolvedValue([]);
    const client = new ActualClient();

    await client.init('http://actual:5006', 'password', 'sync-id');

    expect(api.init).toHaveBeenCalledWith({
      serverURL: 'http://actual:5006',
      password: 'password',
    });
    expect(api.downloadBudget).toHaveBeenCalledWith('sync-id');
    expect(api.getAccounts).toHaveBeenCalledOnce();
    expect(client.isReady()).toBe(true);
  });

  it('stays disconnected when the downloaded budget was closed', async () => {
    api.getAccounts.mockRejectedValue(new Error('No budget file is open'));
    const client = new ActualClient();

    await expect(client.init('http://actual:5006', 'password', 'sync-id')).rejects.toThrow(
      'No budget file is open'
    );
    expect(client.isReady()).toBe(false);
  });
});
