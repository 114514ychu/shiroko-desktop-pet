const api = window.petSettingsMenu, buttons = [...document.querySelectorAll('button:not([hidden])')];
function render(state) {
  if (!state) return;
  document.documentElement.dataset.theme = state.theme;
  document.getElementById('updateMenuDot').hidden = !state.updateReminder;
  
}
for (const button of buttons) button.addEventListener('click', () => api.action(button.dataset.action));
document.addEventListener('keydown', event => {
  const index = buttons.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  } else if (['Escape', 'Tab'].includes(event.key)) { event.preventDefault(); api.close(); }
});
api.onState(render); api.initial().then(render);
