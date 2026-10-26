// Copyright (c) 2026 B站Absdasbdsa. Licensed under Mulan PSL v2; see ../../LICENSE.
const metadata = require('../package.json');
const attribution = require('../branding.json');
const BRAND = Object.freeze({ ...attribution, version: metadata.version });
const BACKGROUNDS = Object.freeze({ light: '#f0f5f5', dark: '#15232b' });

// Trusted, local application metadata only. No account data or network requests.
function pagePresentationScript(theme, role) {
  if (!['light', 'dark'].includes(theme)) throw new Error('Invalid resolved theme');
  const value = { theme, ...BRAND, roleVersion: role?.version || '' };
  return `(() => {
    const value = ${JSON.stringify(value)};
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.dataset.productVersion = value.version;
    document.documentElement.dataset.author = value.author;
    for (const [name, content] of Object.entries({author:value.author, copyright:value.copyright, generator:value.product+' '+value.version, 'pet-role-version':value.roleVersion})) {
      let meta = document.head.querySelector('meta[name="'+name+'"]');
      if (!meta) { meta = document.createElement('meta'); meta.name = name; document.head.append(meta); }
      meta.content = content;
    }
    const footer = document.querySelector('.footer');
    if (footer && !footer.querySelector('[data-attribution]')) {
      const line = document.createElement('span'); line.dataset.attribution = 'true';
      line.textContent = '控制台 v'+value.version+' · 学生 v'+value.roleVersion+' · 作者：'+value.author;
      footer.append(document.createElement('br'),line);
    }
    return value.theme;
  })()`;
}
module.exports = { BRAND, BACKGROUNDS, pagePresentationScript };
