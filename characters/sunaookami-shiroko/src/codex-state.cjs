const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { CodexReadState } = require('./codex-read-state.cjs');

const STATE_LABELS = { idle: '待机', running: '正在思考与处理', waiting: '等你确认', review: '工作完成，来看看', failed: '遇到问题了' };
const RECENT_SESSION_MS = 30 * 60 * 1000;
const ACTIVE_SESSION_MS = 12 * 60 * 60 * 1000;

function deriveState(records, previous = 'idle') {
  let state = previous;
  for (const record of records) {
    const payload = record.payload || {};
    if (record.type === 'event_msg') {
      switch (payload.type) {
        case 'turn_started': case 'task_started': state = 'running'; break;
        case 'task_complete': case 'task_completed': case 'turn_completed': state = 'review'; break;
        case 'turn_aborted': case 'task_cancelled': state = 'idle'; break;
        case 'error': case 'task_failed': state = 'failed'; break;
        case 'exec_approval_request': case 'user_input_request': case 'request_user_input': state = 'waiting'; break;
      }
      if (payload.type === 'item_completed' && payload.item) {
        const item = payload.item;
        if (item.type === 'assistant_message' && item.phase === 'final_answer') state = 'review';
        if (['user_input_request', 'approval_request'].includes(item.type)) state = 'waiting';
      }
    }
    if (record.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'assistant' && ['commentary','analysis'].includes(payload.phase || payload.channel)) state = 'running';
      if (['function_call', 'custom_tool_call'].includes(payload.type)) {
        if (/request_user_input|request_permissions|approval/i.test(payload.name || '')) state = 'waiting';
        else state = 'running';
      }
      if (['function_call_output', 'custom_tool_call_output'].includes(payload.type) && state === 'waiting') state = 'running';
      if (payload.type === 'message' && payload.role === 'assistant' && (['final','final_answer'].includes(payload.phase) || payload.channel === 'final')) state = 'review';
    }
  }
  return state;
}

function isCompletion(record) {
  const p = record.payload || {};
  return record.type === 'event_msg' && (['task_complete', 'task_completed', 'turn_completed'].includes(p.type) || p.type === 'item_completed' && p.item?.type === 'assistant_message' && p.item.phase === 'final_answer') || record.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && (['final','final_answer'].includes(p.phase) || p.channel === 'final');
}

function localDateParts(date) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')];
}

class CodexStateMonitor extends EventEmitter {
  constructor({ root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'), interval = 1500, readState } = {}) {
    super(); this.root = root; this.interval = interval; this.state = 'idle'; this.files = new Map(); this.sessions = new Map(); this.snapshot = { state: 'idle', label: STATE_LABELS.idle, connected: false, needsReview: false, pendingReviewCount: 0, readTracking: false, threadId: null, updatedAt: Date.now() };
    this.readStateSource = readState || new CodexReadState({ home: path.dirname(root) });
  }
  start() {
    this.poll(); this.timer = setInterval(() => this.poll(), this.interval); this.timer.unref?.();
    try {
      const file = this.readStateSource.globalStatePath;
      if (file) this.readWatcher = fs.watch(path.dirname(file), { persistent: false }, (_event, name) => {
        if (name?.toString() !== path.basename(file)) return;
        clearTimeout(this.readDebounce); this.readDebounce = setTimeout(() => this.poll(), 80); this.readDebounce.unref?.();
      });
      this.readWatcher?.on('error', () => {});
    } catch {}
  }
  stop() { clearInterval(this.timer); clearTimeout(this.readDebounce); this.readWatcher?.close(); this.readStateSource.close?.(); }
  listRecentFiles() {
    const paths = new Set(), files = [];
    const addDirectory = dir => {
      try { for (const name of fs.readdirSync(dir)) if (name.endsWith('.jsonl')) paths.add(path.join(dir, name)); } catch {}
    };
    for (let days = 0; days < 2; days++) {
      const date = new Date(); date.setDate(date.getDate() - days);
      addDirectory(path.join(this.root, ...localDateParts(date)));
    }
    // Resumed conversations keep their original date directory. The read-only
    // index finds them without walking every historical log on each poll.
    const indexed = this.readStateSource.recentRollouts?.(Date.now() - ACTIVE_SESSION_MS);
    if (indexed) {
      const canonical = value => process.platform === 'win32' ? path.toNamespacedPath(path.resolve(value)).toLowerCase() : path.resolve(value);
      const root = canonical(this.root) + path.sep;
      for (const file of indexed) if (typeof file === 'string' && canonical(file).startsWith(root) && file.endsWith('.jsonl')) paths.add(file);
    } else {
      // CLI installations may have no SQLite index. Refresh the directory list
      // periodically and stat files so an append in an old chat is still found.
      if (!this.historyPaths || Date.now() - this.historyCheckedAt > 15000) {
        this.historyPaths = []; this.historyCheckedAt = Date.now();
        const walk = (dir, depth) => {
          if (depth === 3) { try { for (const name of fs.readdirSync(dir)) if (name.endsWith('.jsonl')) this.historyPaths.push(path.join(dir,name)); } catch {} return; }
          try { for (const name of fs.readdirSync(dir)) if (/^\d{2,4}$/.test(name)) walk(path.join(dir,name),depth+1); } catch {}
        };
        walk(this.root,0);
      }
      for (const file of this.historyPaths) paths.add(file);
    }
    for (const file of paths) {
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs < ACTIVE_SESSION_MS) files.push({ file, size: stat.size, mtime: stat.mtimeMs, threadId: path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1] });
      } catch { /* Concurrent archive/delete must not hide other active tasks. */ }
    }
    return files.sort((a, b) => b.mtime - a.mtime);
  }
  sessionMetadata(info) {
    const cached = this.sessions.get(info.file);
    if (cached && info.size >= cached.size) return cached;
    const fd = fs.openSync(info.file, 'r');
    try {
      const bytes = Buffer.alloc(Math.min(info.size, 256 * 1024));
      const count = fs.readSync(fd, bytes, 0, bytes.length, 0), end = bytes.subarray(0, count).indexOf(10);
      if (end < 0) return { threadId: info.threadId, subagent: false };
      const record = JSON.parse(bytes.subarray(0, end).toString('utf8'));
      const p = record.type === 'session_meta' ? record.payload || {} : {};
      const threadId = typeof p.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id) ? p.id : info.threadId;
      const isChild = source => source === 'subagent' || Boolean(source && typeof source === 'object' && source.subagent);
      const result = { size: info.size, threadId, subagent: isChild(p.source) || isChild(p.thread_source) };
      this.sessions.set(info.file, result); return result;
    } catch { return { threadId: info.threadId, subagent: false }; } finally { fs.closeSync(fd); }
  }
  readState(info) {
    const cached = this.files.get(info.file);
    if (cached && cached.size === info.size && cached.mtime === info.mtime) return cached.state;
    const maxBytes = 192 * 1024;
    let continuing = Boolean(cached && info.size > cached.size);
    const fd = fs.openSync(info.file, 'r');
    const boundaryHash = offset => {
      const length = Math.min(64, offset), boundary = Buffer.alloc(length);
      const read = fs.readSync(fd, boundary, 0, length, offset - length);
      return crypto.createHash('sha256').update(boundary.subarray(0, read)).digest('hex');
    };
    let state, completedAt, turnId, completionKey, offset, fingerprint;
    try {
      if (continuing && cached.fingerprint && boundaryHash(cached.offset) !== cached.fingerprint) continuing = false;
      state = continuing ? cached.state : 'idle';
      completedAt = continuing ? cached.completedAt : null; turnId = continuing ? cached.turnId : null; completionKey = continuing ? cached.completionKey : null;
      let position = continuing ? cached.offset : 0, pending = Buffer.alloc(0);
      // Replay all committed records in bounded chunks. A tail-only bootstrap
      // loses task_started/waiting in long, buffered or tool-less turns.
      while (position < info.size) {
        const chunk = Buffer.alloc(Math.min(maxBytes, info.size - position));
        const count = fs.readSync(fd, chunk, 0, chunk.length, position);
        if (!count) break;
        position += count;
        const bytes = Buffer.concat([pending, chunk.subarray(0,count)]);
        const lastNewline = bytes.lastIndexOf(10);
        if (lastNewline < 0) { pending = bytes; continue; }
        for (const line of bytes.subarray(0,lastNewline+1).toString('utf8').split('\n')) {
          let record;
          try { record = JSON.parse(line); } catch { continue; }
          state = deriveState([record], state);
          const payload = record.payload || {};
          if (record.type === 'event_msg' && ['task_started','turn_started'].includes(payload.type)) turnId = payload.turn_id || payload.task_id || record.timestamp || null;
          if (isCompletion(record)) {
            const timestamp = Date.parse(record.timestamp);
            completedAt = Number.isFinite(timestamp) ? timestamp : info.mtime;
            completionKey = payload.turn_id || payload.task_id || turnId || completedAt;
          }
        }
        pending = bytes.subarray(lastNewline+1);
      }
      offset = position - pending.length; fingerprint = boundaryHash(offset);
    } finally { fs.closeSync(fd); }
    const sameCompletion = completionKey === cached?.completionKey;
    this.files.set(info.file, { size: info.size, mtime: info.mtime, offset, fingerprint, state, completedAt, turnId, completionKey, lastUnread: sameCompletion ? cached?.lastUnread : undefined, readCompletionKey: sameCompletion ? cached?.readCompletionKey : undefined });
    return state;
  }
  poll() {
    try {
      const recent = this.listRecentFiles();
      const activeFiles = new Set(recent.map(info => info.file));
      for (const file of this.files.keys()) if (!activeFiles.has(file)) this.files.delete(file);
      for (const file of this.sessions.keys()) if (!activeFiles.has(file)) this.sessions.delete(file);
      const uiReadState = this.readStateSource.read?.();
      const candidates = [], seenThreads = new Set();
      for (const listed of recent) {
        let session;
        try { session = this.sessionMetadata(listed); } catch { continue; }
        const info = { ...listed, threadId: session.threadId };
        if (session.subagent || seenThreads.has(info.threadId || info.file)) continue;
        const unread = this.readStateSource.unread?.(info.threadId, uiReadState) || { available: false };
        if (unread.info?.subagent || unread.info?.archived) continue;
        let state;
        try { state = this.readState(info); } catch { continue; }
        // A streamed turn may stay active while its rollout is buffered. Keep
        // explicit running/waiting and unread completion states beyond 30 min;
        // ordinary idle/failure records retain the short freshness window.
        if (Date.now() - info.mtime >= RECENT_SESSION_MS && !['running','waiting'].includes(state) && !(state === 'review' && unread.available && unread.hasUnread)) continue;
        seenThreads.add(info.threadId || info.file);
        const cached = this.files.get(info.file);
        let needsReview = false;
        if (state === 'review') {
          const completedAt = cached?.completedAt ?? info.mtime;
          if (unread.available) {
            if (cached.lastUnread === true && unread.hasUnread === false) cached.readCompletionKey = cached.completionKey;
            cached.lastUnread = unread.hasUnread;
            needsReview = unread.hasUnread;
            if (!unread.hasUnread && (cached.readCompletionKey === cached.completionKey || Date.now() - completedAt > 2000)) state = 'idle';
          } else if (Date.now() - completedAt > 20000) state = 'idle';
        }
        candidates.push({ state, needsReview, threadId: info.threadId || null, readTracking: unread.available });
      }
      const priorities = { waiting: 5, running: 4, failed: 3, review: 2, idle: 1 };
      candidates.sort((a, b) => priorities[b.state] - priorities[a.state]);
      const selected = candidates[0];
      const state = selected?.state || 'idle';
      const connected = candidates.length > 0;
      const pendingReviewCount = candidates.filter(item => item.state === 'review' && item.needsReview).length;
      const readTracking = selected?.readTracking || false;
      const needsReview = selected?.needsReview || false;
      const threadId = selected?.threadId || null;
      if (state !== this.snapshot.state || connected !== this.snapshot.connected || needsReview !== this.snapshot.needsReview || pendingReviewCount !== this.snapshot.pendingReviewCount || readTracking !== this.snapshot.readTracking || threadId !== this.snapshot.threadId) {
        this.state = state;
        this.snapshot = { state, label: state === 'review' ? needsReview ? '工作完成，等你查看' : '任务已完成' : STATE_LABELS[state], connected, needsReview, pendingReviewCount, readTracking, threadId, updatedAt: Date.now() };
        this.emit('change', { ...this.snapshot });
      }
    } catch {
      const changed = this.snapshot.connected || this.snapshot.state !== 'idle';
      this.state = 'idle'; this.snapshot = { state: 'idle', label: STATE_LABELS.idle, connected: false, needsReview: false, pendingReviewCount: 0, readTracking: false, threadId: null, updatedAt: Date.now() };
      if (changed) this.emit('change', { ...this.snapshot });
    }
  }
}
module.exports = { CodexStateMonitor, deriveState, STATE_LABELS };
