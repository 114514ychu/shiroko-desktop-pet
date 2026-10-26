// Project-authored emblems match the corresponding character's full panel.
const identities = {
  'igusa-haruka': {
    englishName: 'IGUSA HARUKA', aliases: ['伊草遥香', '遥香', 'Haruka'], emblemLabel: '伊草遥香 · 棱角光环与礼帽徽记',
    emblemSVG: "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\" focusable=\"false\"><path d=\"m5 6 8-3 2 4 12-3-5 6-10-2-7 2Z\"/><path d=\"m8 13 16-1 2 7-20 2Zm-2 8 20-2M10 23l6 6 6-7M10 16l12-1M15 23h3\"/></svg>"
  },
  'sunaookami-shiroko': {
    englishName: 'SUNAOOKAMI SHIROKO', aliases: ['黑子', '砂狼白子', '白子', 'Shiroko'], emblemLabel: '砂狼白子 · 狼与光环徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m8 14-3-9 9 5h4l9-5-3 9 1 7-9 8-9-8Z"/><path d="m7 16 6 2-1 4m13-6-6 2 1 4m-8 0 4 3 4-3m-4 3v4M12 4a10 3 0 0 1 15 2M5 6a10 3 0 0 1 3-2"/><path d="M11 17h2m6 0h2"/></svg>'
  },
  'ajitani-hifumi': {
    englishName: 'AJITANI HIFUMI', aliases: ['日富美', '阿慈谷日富美', 'Hifumi'], emblemLabel: '阿慈谷日富美 · 佩洛洛徽记',
    emblemSVG: "<svg viewBox=\"0 0 32 32\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M7 13c-3-3-2-7 1-8 3-.8 4 2.5 5 5m12 3c3-3 2-7-1-8-3-.8-4 2.5-5 5\"/><path d=\"M6 20c0-6 4-10 10-10s10 4 10 10-4 9-10 9S6 26 6 20Z\"/><circle cx=\"12\" cy=\"18\" r=\".8\"/><circle cx=\"20\" cy=\"18\" r=\".8\"/><path d=\"m12 22 4-2 4 2-4 3Zm4 3v2M12 3h8\"/></svg>"
  },
  'ryuge-kisaki': {
    englishName: 'RYUGE KISAKI', aliases: ['妃咲'], emblemLabel: '妃咲 · 龙纹徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M19 9c-8-3-14.5 1.5-14 8 .4 5.2 5.1 8.1 9.9 6.2 3.3-1.3 3.6-5.8.8-7.3-2.1-1.1-4.4 0-4.4 2.2"/><path d="M19 9l2.5-4 .7 4.9 5.3 2.4-4 3c-1.8 1.3-4.3 1-5.5-.9l-1-1.5M17.5 8.5l-1-3.5M7 10 5.5 7.5M5.2 13l-2.4-1M6 21l-2 .8"/><circle cx="21.5" cy="12" r=".65" class="crest-eye"/><path d="M4 27h4.5M21 26.5h7M21 24h3.5"/></svg>'
  },
  'sorasaki-hina': {
    englishName: 'SORASAKI HINA', aliases: ['日奈'], emblemLabel: '日奈 · 羽翼与光环徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><ellipse cx="16" cy="5.5" rx="6.5" ry="2.3"/><path d="M14 14C11 8.5 7 9.5 3 6c0 5.5 2 9 6.5 10L5 20c3.3.3 6.4-.3 9-3M18 14c3-5.5 7-4.5 11-8 0 5.5-2 9-6.5 10L27 20c-3.3.3-6.4-.3-9-3"/><path d="m5.5 11.5 6.5 4M7 15l4.5 2.5m15-6-6.5 4M25 15l-4.5 2.5M16 11l3 5-3 7-3-7ZM16 23v4m-2.5 0h5"/></svg>'
  },
  'onikata-kayoko': {
    englishName: 'ONIKATA KAYOKO', aliases: ['佳代子'], emblemLabel: '佳代子 · 耳机与猫徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5.5 18v-2.4a10.5 10.5 0 0 1 21 0V18"/><rect x="3.5" y="16" width="4.5" height="9" rx="2.2"/><rect x="24" y="16" width="4.5" height="9" rx="2.2"/><path d="M11 15l-.5-5 5.5 3.5 5.5-3.5-.5 5c2 1.2 3 2.9 3 5 0 4-3.6 6.5-8 6.5S8 24 8 20c0-2.1 1-3.8 3-5Z"/><path d="M12.5 19h.5m6 0h.5M14.5 22h3L16 23.5Z"/></svg>'
  },
  'kei': {
    englishName: 'KEI', aliases: ['凯伊', 'Kei'], emblemLabel: '凯伊 · 耳机与猫徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5.5 18v-2.4a10.5 10.5 0 0 1 21 0V18"/><rect x="3.5" y="16" width="4.5" height="9" rx="2.2"/><rect x="24" y="16" width="4.5" height="9" rx="2.2"/><path d="M11 15l-.5-5 5.5 3.5 5.5-3.5-.5 5c2 1.2 3 2.9 3 5 0 4-3.6 6.5-8 6.5S8 24 8 20c0-2.1 1-3.8 3-5Z"/><path d="M12.5 19h.5m6 0h.5M14.5 22h3L16 23.5Z"/></svg>'
  },
  'izuna': {
    englishName: 'IZUNA', aliases: ['久田泉奈', '泉奈', 'Izuna'], emblemLabel: '久田泉奈 · 忍者徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m7 13 2-8 7 5 7-5 2 8-2 11-7 5-7-5Z"/><path d="M9 17h14M12 21h8M14 25h4M12 14h2m6 0h2"/></svg>'
  },
  'shun': {
    englishName: 'SHUN', aliases: ['瞬', '瞬（幼年）', 'Shun'], emblemLabel: '瞬 · 兔与茶徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M10 14V5c0-2 3-2 4 0l2 6 2-6c1-2 4-2 4 0v9"/><path d="M7 16c0-4 4-7 9-7s9 3 9 7-4 10-9 10-9-6-9-10Z"/><circle cx="12" cy="17" r="1"/><circle cx="20" cy="17" r="1"/><path d="m14 21 2 1 2-1M16 22v3"/></svg>'
  },
  'uzawa-reisa': {
    englishName: 'UZAWA REISA', aliases: ['玲纱'], emblemLabel: '玲纱 · 星光正义徽记',
    emblemSVG: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m16 3 3.7 7.7 8.5 1.2-6.1 6 1.4 8.4-7.5-4-7.5 4 1.4-8.4-6.1-6 8.5-1.2Z"/><path d="m16 10 2 4.1 4.5.6-3.3 3.2.8 4.5-4-2.2-4 2.2.8-4.5-3.3-3.2 4.5-.6Z"/><path d="M4 5v4M2 7h4m22 17v4m-2-2h4"/></svg>'
  }
};
const genericEmblem = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 4 19 13 28 16 19 19 16 28 13 19 4 16 13 13Z"/></svg>';
export function characterIdentity(role) {
  return identities[role.id] || { englishName: role.id.replaceAll('-', ' '), aliases: [], emblemLabel: role.name + ' · 学生徽记', emblemSVG: genericEmblem };
}
const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('en').replace(/[\s_\-·•.]/g, '');
export function matchesCharacter(role, query) {
  const identity = characterIdentity(role);
  const text = normalize([role.name, role.id, identity.englishName, ...identity.aliases].join(' '));
  return String(query).normalize('NFKC').trim().split(/\s+/).map(normalize).filter(Boolean).every(token => text.includes(token));
}
