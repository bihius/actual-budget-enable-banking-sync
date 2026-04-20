import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export class Store {
  constructor(dataDir) {
    this.path = join(dataDir, 'state.json');
    this.state = { sessions: {}, accountMappings: [], syncLogs: [] };
  }

  load() {
    if (existsSync(this.path)) {
      try {
        const loaded = JSON.parse(readFileSync(this.path, 'utf8'));
        this.state = { ...this.state, ...loaded };
      } catch (err) {
        console.error('Failed to parse state.json:', err.message);
      }
    }
    // Ensure all state keys exist
    this.state.sessions = this.state.sessions || {};
    this.state.accountMappings = this.state.accountMappings || [];
    this.state.syncLogs = this.state.syncLogs || [];
  }

  save() {
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  addSyncLog(log) {
    this.state.syncLogs = [
      { timestamp: new Date().toISOString(), ...log },
      ...(this.state.syncLogs || []),
    ].slice(0, 10);
    this.save();
  }

  getSyncLogs() {
    return this.state.syncLogs || [];
  }

  addSession(session) {
    this.state.sessions[session.sessionId] = session;
    this.save();
  }

  getSession(id) {
    return this.state.sessions[id] || null;
  }

  getSessions() {
    return Object.values(this.state.sessions);
  }

  removeSession(id) {
    delete this.state.sessions[id];
    this.state.accountMappings = this.state.accountMappings.filter(m => m.sessionId !== id);
    this.save();
  }

  addAccountMapping(mapping) {
    mapping.id = mapping.id || randomUUID();
    this.state.accountMappings.push(mapping);
    this.save();
    return mapping;
  }

  getAccountMappings() {
    return this.state.accountMappings;
  }

  updateLastSyncDate(id, date) {
    const m = this.state.accountMappings.find(m => m.id === id);
    if (m) {
      m.lastSyncDate = date;
      this.save();
    }
  }

  removeAccountMapping(id) {
    this.state.accountMappings = this.state.accountMappings.filter(m => m.id !== id);
    this.save();
  }

  resetSyncDate(id) {
    const m = this.state.accountMappings.find(m => m.id === id);
    if (m) { m.lastSyncDate = null; this.save(); }
  }
}
