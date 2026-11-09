// Season and light/dark mode: two controls on the rail. Choices are remembered per browser
// and announced to the world as `village:season` / `village:theme` events.
const root = document.documentElement;
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export const SEASON_ICONS = {
  spring: '<path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/><path d="M12 15c0-3-2.2-5-6-5 0 3 2.2 5 6 5z"/>',
  summer: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  autumn: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.2-6.1 2.5-.5 5-1.4 6.8-3.9"/>',
  winter: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10"/><path d="M9 3.5l3 2 3-2M9 20.5l3-2 3 2M3.6 10.5l2.6-2.3-.8-3.4M20.4 13.5l-2.6 2.3.8 3.4M5.4 19.2l.8-3.4-2.6-2.3M18.6 4.8l-.8 3.4 2.6 2.3"/>',
};
const THEME_ICON = '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>';   // half-filled circle
const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

root.dataset.season = store.get('season', 'spring');
root.dataset.theme = store.get('theme', 'dark');

const tools = document.getElementById('rail-tools');
tools.insertAdjacentHTML('afterbegin', `
  <div class="season-wrap">
    <button id="season-btn" class="rail-btn" aria-label="Season" aria-expanded="false"></button>
    <div id="season-menu" class="flyout" role="menu" hidden>
      ${Object.keys(SEASON_ICONS).map((s) => `<button class="flyout-btn" data-season="${s}" role="menuitemradio" aria-label="${s[0].toUpperCase() + s.slice(1)}" title="${s[0].toUpperCase() + s.slice(1)}">${svg(SEASON_ICONS[s])}</button>`).join('')}
    </div>
  </div>
  <button id="theme-btn" class="rail-btn" aria-label="Toggle light and dark"></button>`);
const seasonBtn = document.getElementById('season-btn'), menu = document.getElementById('season-menu'), themeBtn = document.getElementById('theme-btn');

function render() {
  const s = root.dataset.season, t = root.dataset.theme;
  seasonBtn.innerHTML = `${svg(SEASON_ICONS[s])}<span class="tip">Season: ${s[0].toUpperCase() + s.slice(1)}</span>`;
  themeBtn.innerHTML = `${svg(THEME_ICON)}<span class="tip">${t === 'dark' ? 'Light' : 'Dark'} mode</span>`;
  for (const b of menu.children) b.classList.toggle('on', b.dataset.season === s);
}
function setSeason(s) {
  root.dataset.season = s; store.set('season', s); render();
  dispatchEvent(new CustomEvent('village:season', { detail: s }));
}
function setTheme(t) {
  root.dataset.theme = t; store.set('theme', t); render();
  dispatchEvent(new CustomEvent('village:theme', { detail: t }));
}
const openMenu = (open) => { menu.hidden = !open; seasonBtn.setAttribute('aria-expanded', String(open)); };
seasonBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(menu.hidden); });
menu.addEventListener('click', (e) => { const b = e.target.closest('[data-season]'); if (b) { setSeason(b.dataset.season); openMenu(false); } });
addEventListener('click', (e) => { if (!e.target.closest('.season-wrap')) openMenu(false); });
addEventListener('keydown', (e) => { if (e.code === 'Escape') openMenu(false); });
themeBtn.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
render();
