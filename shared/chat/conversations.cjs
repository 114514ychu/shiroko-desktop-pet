const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const copy = value => structuredClone(value);
function personaFor(roleId, outfit) { return roleId + (outfit === 'terror' ? ':terror' : ':default'); }
function createConversations(directory, { now = () => new Date().toISOString() } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const cache = new Map(), listeners = new Set(), summaryJobs = new Map();
  let loaded = false, issues = [], active = {};
  const stateFile = path.join(directory, 'active.json');
  function read(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (fs.existsSync(file + '.bak')) return JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
      throw error;
    }
  }
  try { const value=read(stateFile);if(value&&typeof value==='object'&&!Array.isArray(value))active=value; } catch { /* First run; conversation files remain recoverable. */ }
  function atomic(file, value) {
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fs.existsSync(file)) {
        // Preserve the last readable backup when recovering a damaged primary.
        try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, file + '.bak'); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
  function save(session) { atomic(path.join(directory, session.id + '.json'), session); cache.set(session.id, session); }
  function load() {
    if (loaded) return;
    for (const file of fs.readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      try {
        const value = read(path.join(directory, file));
        if (value.id + '.json' !== file || value.version !== 1 || !Array.isArray(value.messages) || !['roleId','persona','title','name','outfit','createdAt','updatedAt','draft','summary'].every(key=>typeof value[key]==='string') || !Number.isInteger(value.summaryThrough) || value.messages.some(item=>!item||typeof item.id!=='string'||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||typeof item.at!=='string'||!['pending','completed','failed','cancelled','interrupted'].includes(item.status))) throw Error('Invalid conversation');
        let interrupted = false;
        for (const message of value.messages) if (message.status === 'pending') { message.status = 'interrupted'; message.error = '上次回复未完成，可以重试。'; if(!value.draft)value.draft=message.content;interrupted = true; }
        if (interrupted) save(value); else cache.set(value.id, value);
      } catch { issues.push('部分记录无法读取，原文件已保留。'); }
    }
    loaded = true;
  }
  function get(id) { load(); if (!validId(id) || !cache.has(id)) throw Error('这段对话不存在或已删除。'); return copy(cache.get(id)); }
  function changed() { for (const listener of listeners) { try { listener(); } catch { /* Notifications must not invalidate a saved conversation. */ } } }
  function update(id, fn) { const session = get(id); fn(session); save(session); changed(); return session; }
  function activate(id) { const value = get(id); const next = { ...active, [value.persona]: id }; atomic(stateFile, next); active = next; changed(); return value; }
  function create(identity) {
    const roleId = String(identity.roleId || 'sunaookami-shiroko');
    if (!/^[a-z0-9-]+$/.test(roleId)) throw Error('角色无效。');
    const at = now(), value = { version: 1, id: randomUUID(), roleId, persona: personaFor(roleId, identity.outfit), name: String(identity.name || '白子').slice(0, 60), outfit: String(identity.outfit || 'default').slice(0, 60), title: '新对话', customTitle: false, createdAt: at, updatedAt: at, draft: '', summary: '', summaryThrough: 0, messages: [] };
    save(value); activate(value.id); return copy(value);
  }
  function current(identity) { load(); const id = active[personaFor(identity.roleId || 'sunaookami-shiroko', identity.outfit)]; return id && cache.has(id) ? get(id) : create(identity); }
  function begin(id, text, retryId) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 6000) throw Error('消息不能为空或超过 6000 字。');
    let messageId;
    const session = update(id, value => {
      if (value.messages.some(message => message.status === 'pending')) throw Error('请等待上一条回复。');
      const retry = retryId && value.messages.find(message => message.id === retryId);
      if (retryId && (!retry || retry.role !== 'user' || !['failed', 'cancelled', 'interrupted'].includes(retry.status) || value.messages.at(-1).id !== retryId)) throw Error('只能重试这段对话最后一条未完成的消息。');
      if (retry) { retry.status = 'pending'; retry.content = text.trim(); delete retry.error; messageId = retry.id; }
      else { const message = { id: randomUUID(), role: 'user', content: text.trim(), at: now(), status: 'pending' }; value.messages.push(message); messageId = message.id; }
      if (!value.customTitle && value.title === '新对话') value.title = text.trim().replace(/\s+/g, ' ').slice(0, 36);
      value.draft = ''; value.updatedAt = now();
    });
    return { session, messageId };
  }
  function complete(id, messageId, content) {
    return update(id, value => {
      const message = value.messages.find(item => item.id === messageId);
      if (!message || message.status !== 'pending' || value.messages.at(-1)?.id !== messageId) throw Error('对话已取消。');
      if (typeof content !== 'string' || !content.trim()) throw Error('回复为空。');
      message.status = 'completed';
      value.messages.push({ id: randomUUID(), role: 'assistant', content, status: 'completed', at: now() });
      value.updatedAt = now();
    });
  }
  function fail(id, messageId, error, cancelled = false) {
    if (!cache.has(id)) return;
    return update(id, value => { const message = value.messages.find(item => item.id === messageId); if (message?.status === 'pending') { message.status = cancelled ? 'cancelled' : 'failed'; message.error = String(error || '回复未完成，请重试。').slice(0, 300); if (!value.draft) value.draft = message.content; value.updatedAt = now(); } });
  }
  function context(id, messageId) {
    const value = get(id), messages = value.messages.filter(item => item.status === 'completed' || item.id === messageId);
    const end = messageId ? messages.findIndex(item => item.id === messageId) + 1 : messages.length;
    const recent = messages.slice(0, end).slice(-23);
    if (recent[0]?.role === 'assistant') recent.shift();
    return { history: recent.map(({ role, content }) => ({ role, content })), summary: value.summary || '' };
  }
  async function summarize(id, generate) {
    if (summaryJobs.has(id) || typeof generate !== 'function') return;
    const value = get(id), completed = value.messages.filter(item => item.status === 'completed');
    const through = Math.max(0, completed.length - 22);
    if (through - value.summaryThrough < 12) return;
    const chunk = completed.slice(value.summaryThrough, through).slice(0, 24);
    summaryJobs.set(id, true);
    try {
      const summary = await generate(value.summary, chunk.map(({ role, content }) => ({ role, content })));
      if (typeof summary !== 'string' || !summary.trim() || !cache.has(id)) return;
      update(id, latest => { if (latest.summaryThrough === value.summaryThrough) { latest.summary = summary.trim().slice(0, 2400); latest.summaryThrough += chunk.length; } });
    } catch { /* Original messages are intact; retry after a later reply. */ }
    finally { summaryJobs.delete(id); }
  }
  return {
    create, current, get, activate, begin, complete, fail, context, summarize,
    import(identity, messages) {
      if (!Array.isArray(messages)) throw Error('旧对话格式无效。');
      const valid = messages.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim()).map(item => ({ id: randomUUID(), role: item.role, content: item.content.slice(0, 6000), at: now(), status: 'completed' }));
      if (!valid.length) return null;
      const value = create(identity);
      return update(value.id, session => { session.messages = valid; session.title = (valid.find(item => item.role === 'user')?.content || '导入的对话').replace(/\s+/g, ' ').slice(0, 36); });
    },
    list({ query = '', roleId = '', offset = 0, limit = 40 } = {}) {
      load(); const search = String(query).trim().slice(0, 100).toLocaleLowerCase();
      const all = [...cache.values()].filter(value => (!roleId || value.roleId === roleId) && (!search || [value.title, value.name, ...value.messages.map(message => message.content)].some(text => text.toLocaleLowerCase().includes(search)))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = Math.max(0, Number(offset) || 0), count = Math.max(1, Math.min(100, Number(limit) || 40));
      return { total: all.length, issues: [...new Set(issues)], items: all.slice(start, start + count).map(value => ({ id: value.id, roleId: value.roleId, persona: value.persona, name: value.name, outfit: value.outfit, title: value.title, updatedAt: value.updatedAt, preview: value.messages.at(-1)?.content.slice(0, 100) || '还没有消息', count: value.messages.length, active: active[value.persona] === value.id })) };
    },
    draft(id, text) { return update(id, value => { value.draft = String(text || '').slice(0, 6000); }); },
    rename(id, title) { if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) throw Error('标题请填写 1 至 80 字。'); return update(id, value => { value.title = title.trim(); value.customTitle = true; }); },
    remove(id) {
      const value = get(id), next = { ...active }; if (next[value.persona] === id) delete next[value.persona];
      atomic(stateFile, next); active = next;
      const file = path.join(directory, id + '.json');
      if (fs.existsSync(file + '.bak')) fs.unlinkSync(file + '.bak');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      cache.delete(id); changed();
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
module.exports = { createConversations, personaFor };
