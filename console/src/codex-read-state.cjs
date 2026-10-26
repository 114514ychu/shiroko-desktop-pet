const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class CodexReadState {
  constructor({ home, globalStatePath = path.join(home, '.codex-global-state.json'), databasePath = path.join(home, 'state_5.sqlite'), metadataReader } = {}) {
    this.globalStatePath = globalStatePath; this.databasePath = databasePath; this.metadataReader = metadataReader;
    this.metadata = new Map(); this.cached = null; this.lastGoodAt = 0;
  }
  read() {
    try {
      const stat = fs.statSync(this.globalStatePath);
      if (this.cached && stat.mtimeMs === this.mtime && stat.size === this.size && stat.ino === this.inode && stat.ctimeMs === this.ctime) { this.lastGoodAt = Date.now(); return this.cached; }
      const value = JSON.parse(fs.readFileSync(this.globalStatePath, 'utf8'))['electron-thread-read-state-v1'];
      if (value?.version !== 1 || !value.unreadByIdentity || typeof value.unreadByIdentity !== 'object' || Array.isArray(value.unreadByIdentity)) return null;
      this.cached = value; this.mtime = stat.mtimeMs; this.size = stat.size; this.inode = stat.ino; this.ctime = stat.ctimeMs; this.lastGoodAt = Date.now(); return value;
    } catch { return Date.now() - this.lastGoodAt < 2000 ? this.cached : null; }
  }
  recentRollouts(since) {
    if (this.metadataReader) return null;
    try {
      if (!this.database) {
        const { DatabaseSync } = require('node:sqlite');
        this.database = new DatabaseSync(this.databasePath, { readOnly: true });
      }
      this.recentQuery ||= this.database.prepare('SELECT rollout_path FROM threads WHERE archived = 0 AND updated_at >= ? ORDER BY updated_at DESC');
      return this.recentQuery.all(Math.floor(since / 1000)).map(row => row.rollout_path);
    } catch { return null; }
  }
  thread(threadId) {
    if (!threadId) return null;
    if (this.metadataReader) return this.metadataReader(threadId);
    const cached = this.metadata.get(threadId);
    if (cached && Date.now() - cached.checkedAt < 10000) return cached.info;
    try {
      if (!this.database) {
        const { DatabaseSync } = require('node:sqlite');
        this.database = new DatabaseSync(this.databasePath, { readOnly: true });
      }
      if (!this.query) {
        this.query = this.database.prepare('SELECT t.creator_account_id, t.creator_user_id, t.archived, e.parent_thread_id FROM threads t LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id WHERE t.id = ?');
      }
      const row = this.query.get(threadId);
      if (!row) return null;
      const identityHash = row.creator_account_id && row.creator_user_id ? crypto.createHash('sha256').update(JSON.stringify(['chatgpt', row.creator_account_id, row.creator_user_id])).digest('hex') : null;
      const info = { identityHash, archived: Boolean(row.archived), subagent: Boolean(row.parent_thread_id) };
      this.metadata.set(threadId, { info, checkedAt: Date.now() }); return info;
    } catch { return null; }
  }
  unread(threadId, value = this.read()) {
    const info = this.thread(threadId);
    if (!value || !info?.identityHash) return { available: false, info };
    const group = value.unreadByIdentity[info.identityHash];
    if (group == null) return { available: true, hasUnread: false, info };
    if (typeof group !== 'object' || Array.isArray(group)) return { available: false, info };
    const hosts = Object.entries(group).filter(([key]) => key.startsWith('local:'));
    if (hosts.some(([, ids]) => !Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) return { available: false, info };
    if (hosts.length > 1) return { available: false, info };
    return { available: true, hasUnread: hosts[0]?.[1].includes(threadId) ?? false, info };
  }
  close() { this.database?.close(); this.database = null; this.query = null; this.recentQuery = null; this.metadata.clear(); }
}
module.exports = { CodexReadState };
