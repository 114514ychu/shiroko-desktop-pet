export function userMessage(error, fallback = '操作未完成，请稍后重试。') {
  let message = typeof error === 'string' ? error : error?.message;
  if (!message) return fallback;
  message = message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim();
  if (!message || /^(?:TypeError|SyntaxError|ReferenceError):|ERR_|fetch failed|Cannot |ENOENT|EACCES|EPERM/i.test(message)) return fallback;
  return message.slice(0, 220);
}

// A card follows the active mode; single companionship accepts a solo selection only.
export function visibilitySelection(preferences, id, visible) {
  return preferences.mode === 'single' ? {type:'solo',value:visible?id:null} : {type:'visible',id,value:visible};
}

export function studentOptions(roles) {
  const entries = [{id:'',name:'暂不显示学生'}, ...roles.filter(role => role.installed).map(role => ({id:role.id,name:role.name}))];
  return {entries, signature:JSON.stringify(entries)};
}
