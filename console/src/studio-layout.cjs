// Keep the native view origin in sync with the two rows in simple-console.css.
const STUDIO_HEADER_HEIGHT = 112;

function arrangeStudio(roleId) {
  const panel = document.getElementById('panel');
  if (!panel || panel.dataset.simpleLayout) return;
  panel.dataset.simpleLayout = 'true';
  const original = [...panel.children];
  const take = selector => panel.querySelector(selector);
  const brand = take('.brand');
  const outfit = take('#variant')?.closest('.field');
  const advanced = document.createElement('details');
  advanced.className = 'simple-details'; advanced.id = 'advancedControls';
  const summary = document.createElement('summary');
  summary.textContent = '更多'; advanced.append(summary);
  const tools = document.createElement('div'); tools.className = 'simple-details-body';
  advanced.append(tools);
  const actions = document.createElement('div'); actions.className = 'companion-actions';
  function action(id, text, command) {
    const button = document.createElement('button'); button.id = id; button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => window.kisakiDesktop.command(command));
    actions.append(button);
  }
  action('companionChat', '聊天', 'chat');
  // Moving the original controls keeps their listeners, IDs and saved values.
  const essentials = new Set([brand, outfit]);
  for (const node of original) {
    if (essentials.has(node)) continue;
    tools.append(node);
  }
  panel.replaceChildren(...[brand, outfit, actions, advanced].filter(Boolean));
}

function studioLayoutScript(roleId) {
  return `(${arrangeStudio.toString()})(${JSON.stringify(roleId)})`;
}
module.exports = { STUDIO_HEADER_HEIGHT, studioLayoutScript };
