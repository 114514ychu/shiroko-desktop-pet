// Read-only adapter for DeepSeek Harness v4 session journals.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const zlib = require('node:zlib');
const decompress = promisify(zlib.zstdDecompress);
const labels = { idle: '待机', running: '正在思考与处理', waiting: '等你确认', review: '工作完成，来看看', failed: '遇到问题了' };
const QUESTION_TOOLS = new Set(['ask_user_question', 'request_user_input', 'request_user_input_async']);

// Harness appends independent RFC 8878 frames. Node's one-shot decoder reads
// one frame only; never search compressed bytes for a magic-number delimiter.
function completeFrames(buffer) {
  let offset = 0;
  const frames = [];
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5) break;
    if (buffer.readUInt32LE(offset) !== 0xfd2fb528) throw new Error('Unsupported Harness journal frame');
    const flags = buffer[offset + 4];
    if (flags & 0x18) throw new Error('Invalid Zstandard frame header');
    const single = Boolean(flags & 32), sizeFlag = flags >>> 6, dictionary = flags & 3;
    offset += 5 + (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (sizeFlag ? 1 << sizeFlag : single ? 1 : 0);
    if (offset > buffer.length) break;
    let last = false;
    while (!last) {
      if (buffer.length - offset < 3) return { frames, consumed: start };
      const block = buffer.readUIntLE(offset, 3), type = (block >>> 1) & 3;
      if (type === 3) throw new Error('Invalid Zstandard block');
      offset += 3 + (type === 1 ? 1 : block >>> 3);
      if (offset > buffer.length) return { frames, consumed: start };
      last = Boolean(block & 1);
    }
    if (flags & 4) offset += 4;
    if (offset > buffer.length) return { frames, consumed: start };
    frames.push({ start, end: offset });
  }
  return { frames, consumed: frames.at(-1)?.end || 0 };
}

function emptyFold() {
  return { header: null, state: 'idle', turn: null, lastSeq: -1, updatedAt: 0, completedAt: 0, completionSeq: -1, approvals: new Set(), questions: new Set() };
}
function foldEvent(fold, row) {
  if (row.type === 'session') {
    if (row.version !== 4) throw new Error('Unsupported Harness session version');
    fold.header = { id: row.id, delegationDepth: row.delegationDepth || 0, isSeeded: Boolean(row.isSeeded), parentId: row.parentId || row.parentSessionId };
    return;
  }
  if (!Number.isSafeInteger(row.seq) || row.seq <= fold.lastSeq) return;
  if (row.seq !== fold.lastSeq + 1) throw new Error('Non-contiguous Harness journal');
  fold.lastSeq = row.seq;
  const data = row.data || {};
  fold.updatedAt = Math.max(fold.updatedAt, Number(row.time) || 0);
  switch (row.type) {
    case 'turn/start':
      fold.turn = data.turn; fold.state = 'running'; fold.completedAt = 0;
      fold.approvals.clear(); fold.questions.clear(); break;
    case 'approval/asked':
      if (fold.turn !== null) fold.approvals.add(data.id); break;
    case 'approval/decided': fold.approvals.delete(data.id); break;
    case 'tool/call':
      if (fold.turn !== null && QUESTION_TOOLS.has(data.toolName || data.name)) fold.questions.add(data.callId);
      break;
    case 'tool/result': fold.questions.delete(data.callId || data.message?.source?.callId || data.message?.toolCallId); break;
    case 'turn/end': {
      const reason = data.reason?.kind;
      fold.turn = null; fold.approvals.clear(); fold.questions.clear();
      fold.state = reason === 'completed' ? 'review' : ['error', 'blocked', 'max-tokens', 'interrupted'].includes(reason) ? 'failed' : 'idle';
      fold.completedAt = Number(row.time) || 0;
      fold.completionSeq = row.seq;
      break;
    }
  }
  if (fold.turn !== null) fold.state = fold.approvals.size || fold.questions.size ? 'waiting' : 'running';
}

async function hostRunning() {
  if (process.platform !== 'win32') return false;
  const result = await promisify(execFile)('tasklist.exe', ['/FI', 'IMAGENAME eq DSH Desktop.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000, maxBuffer: 128 * 1024 });
  return /"DSH Desktop\.exe"/i.test(result.stdout);
}

class HarnessStateMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.home = options.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    this.root = options.sessionsRoot || path.join(this.home, 'sessions');
    this.clock = options.now || Date.now;
    this.probe = options.isHostRunning || hostRunning;
    this.interval = options.interval || 700;
    this.completionMs = options.completionMs ?? 60000;
    this.activeMs = options.activeMs ?? 12 * 60 * 60 * 1000;
    this.files = new Map(); this.acknowledged = new Set(); this.generation = 0;
    this.snapshot = { state: 'idle', label: labels.idle, connected: false, readTracking: false, source: 'DeepSeek Harness', needsReview: false };
  }
  start() { if (this.timer) return; void this.poll(); this.timer = setInterval(() => void this.poll(), this.interval); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; this.generation++; }
  async discover() {
    const found = [];
    async function walk(dir, depth) {
      if (depth > 4) return;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file, depth + 1);
        else if (entry.isFile() && entry.name === 'session.v4.jsonl.zstd') found.push(file);
      }
    }
    await walk(this.root, 0);
    return found;
  }
  async read(file, stat) {
    let cache = this.files.get(file);
    if (cache && cache.size === stat.size && cache.mtime === stat.mtimeMs) return cache.fold;
    const handle = await fsp.open(file, 'r');
    try {
      let continued = Boolean(cache && stat.size > cache.size && cache.offset);
      if (continued) {
        const boundary = Buffer.alloc(Math.min(64, cache.offset));
        await handle.read(boundary, 0, boundary.length, cache.offset - boundary.length);
        continued = crypto.createHash('sha256').update(boundary).digest('hex') === cache.fingerprint;
      }
      if (!continued) cache = { offset: 0, fold: emptyFold(), pending: '' };
      // Work on a copy so malformed or partially written data cannot corrupt the last good state.
      const fold = { ...cache.fold, approvals: new Set(cache.fold.approvals), questions: new Set(cache.fold.questions) };
      let position = cache.offset, pending = cache.pending;
      while (position < stat.size) {
        const buffer = Buffer.alloc(Math.min(8 * 1024 * 1024, stat.size - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        const { frames, consumed } = completeFrames(buffer.subarray(0, bytesRead));
        if (!frames.length) {
          if (bytesRead === buffer.length && stat.size - position > bytesRead) throw new Error('Harness frame exceeds read limit');
          break;
        }
        for (const frame of frames) {
          const decoded = await decompress(buffer.subarray(frame.start, frame.end), { maxOutputLength: 32 * 1024 * 1024 });
          const text = pending + decoded.toString('utf8'), end = text.lastIndexOf('\n');
          if (end < 0) { pending = text; continue; }
          for (const line of text.slice(0, end).split('\n')) if (line.trim()) foldEvent(fold, JSON.parse(line));
          pending = text.slice(end + 1);
        }
        position += consumed;
      }
      const boundary = Buffer.alloc(Math.min(64, position));
      await handle.read(boundary, 0, boundary.length, position - boundary.length);
      this.files.set(file, { offset: position, fold, pending, size: stat.size, mtime: stat.mtimeMs, fingerprint: crypto.createHash('sha256').update(boundary).digest('hex') });
      return fold;
    } finally { await handle.close(); }
  }
  acknowledge() {
    if (this.snapshot.completionKey) this.acknowledged.add(this.snapshot.completionKey);
    if (this.acknowledged.size > 500) this.acknowledged.delete(this.acknowledged.values().next().value);
    return this.poll();
  }
  async poll() {
    if (this.busy) return this.busy;
    const generation = this.generation;
    this.busy = this._poll().then(value => {
      if (generation !== this.generation) return this.snapshot;
      if (JSON.stringify(value) !== JSON.stringify(this.snapshot)) { this.snapshot = value; this.emit('change', value); }
      return this.snapshot;
    }).catch(() => this.snapshot).finally(() => { this.busy = null; });
    return this.busy;
  }
  async _poll() {
    const now = this.clock();
    if (!this.probedAt || now - this.probedAt >= 4000) {
      this.probedAt = now;
      try { this.running = await this.probe(); } catch { this.running = false; }
    }
    const base = { state: 'idle', label: labels.idle, connected: false, readTracking: false, source: 'DeepSeek Harness', needsReview: false };
    if (!this.running) return base;
    try { await fsp.access(this.root, fs.constants.R_OK); } catch { return { ...base, detail: '未找到 Harness 会话目录' }; }
    base.connected = true;
    if (!this.discoveredAt || now - this.discoveredAt >= 2000) {
      this.discoveredAt = now; this.paths = await this.discover();
      const active = new Set(this.paths);
      for (const file of this.files.keys()) if (!active.has(file)) this.files.delete(file);
    }
    const candidates = []; let readErrors = 0;
    for (const file of this.paths) {
      try {
        const stat = await fsp.stat(file);
        if (now - stat.mtimeMs > this.activeMs) { this.files.delete(file); continue; }
        const fold = await this.read(file, stat);
        if (!fold.header || fold.header.delegationDepth > 0 || fold.header.parentId) continue;
        const completionKey = `${fold.header.id}:${fold.completionSeq}`;
        const terminal = ['review', 'failed'].includes(fold.state);
        let state = fold.state;
        if (terminal && (this.acknowledged.has(completionKey) || now - fold.completedAt > this.completionMs)) state = 'idle';
        if (now - fold.updatedAt > this.activeMs) state = 'idle';
        if (state !== 'idle') candidates.push({ state, updatedAt: fold.updatedAt, threadId: fold.header.id, completionKey: terminal ? completionKey : null });
      } catch { readErrors++; }
    }
    const priority = { waiting: 4, running: 3, failed: 2, review: 1 };
    candidates.sort((a, b) => priority[b.state] - priority[a.state] || b.updatedAt - a.updatedAt);
    const chosen = candidates[0];
    return { ...base, ...(chosen || {}), label: labels[chosen?.state || 'idle'], needsReview: chosen?.state === 'review', activeCount: candidates.length, ...(readErrors ? { detail: `${readErrors} 个会话暂时无法读取，等待下一次更新` } : {}) };
  }
}
module.exports = { HarnessStateMonitor, completeFrames, emptyFold, foldEvent };
