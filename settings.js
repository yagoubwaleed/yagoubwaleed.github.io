// Light/dark mode: a toggle on the rail, remembered per browser.
const root = document.documentElement;
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const THEME_ICON = '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>';   // half-filled circle
const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

root.dataset.theme = store.get('theme', 'dark');

const tools = document.getElementById('rail-tools');
tools.insertAdjacentHTML('afterbegin', `<button id="theme-btn" class="rail-btn" aria-label="Toggle light and dark"></button>`);
const themeBtn = document.getElementById('theme-btn');
function render() {
  themeBtn.innerHTML = svg(THEME_ICON);
  themeBtn.setAttribute('aria-label', `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} mode`);
}
themeBtn.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
  render();
});
render();
