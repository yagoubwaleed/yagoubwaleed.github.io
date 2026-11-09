// Sidebar: an icon rail plus a content panel. Views are addressed by ?p=section or
// ?p=section/item. Opening a view walks the character to that view's place in the village.
import './settings.js';
import { PROFILE, SECTIONS } from './content.js';

const rail = document.getElementById('rail-sections');
const panel = document.getElementById('panel');
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICONS = {
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.4 14h9.2"/>',
  briefcase: '<path d="M4 8h16v11H4zM9 8V5h6v3M4 13h16"/>',
  board: '<path d="M3 4h18v12H3zM8 20l2-4M16 20l-2-4M7 9h6M7 12h4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  pen: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICONS[name]}</svg>`;
const ARROW = '<svg class="arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 8.5l5-5M4 3.5h4.5V8"/></svg>';
const external = (href) => /^(https?:|mailto:)/.test(href);

// ---------- Rail ----------
rail.innerHTML = SECTIONS.map((s) => `
  <a class="rail-btn" href="?p=${s.id}" data-route="${s.id}" aria-label="${s.title}">
    ${icon(s.icon)}<span class="tip">${s.title}</span>
  </a>`).join('');

// ---------- Views ----------
const findSection = (id) => SECTIONS.find((s) => s.id === id);
const href = (s, i) => `?p=${s}${i ? `/${i}` : ''}`;

function pageView({ title, meta, pills = [], facts = [], body = '' }, back) {
  return `
    ${back ? `<a class="back" href="${href(...back.route)}" data-route="${back.route.filter(Boolean).join('/')}">&larr; ${back.label}</a>` : ''}
    <h1 class="title">${title}</h1>
    ${meta ? `<p class="meta">${meta}</p>` : ''}
    ${pills.length ? `<div class="pills">${pills.map((p) => `
      ${p.route ? `<a class="pill" href="?p=${p.route}" data-route="${p.route}">${p.label}</a>` : `
      <a class="pill${p.primary ? ' primary' : ''}" href="${p.href}"${external(p.href) && !p.href.startsWith('mailto:') ? ' target="_blank" rel="noopener"' : ''}>
        ${p.label}${external(p.href) ? ARROW : ''}</a>`}`).join('')}</div>` : ''}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    <div class="body">${body}</div>`;
}

function itemList(section) {
  if (!section.items.length) return `<p class="empty">${section.empty || 'Nothing here yet.'}</p>`;
  return `<ul class="items">${section.items.map((it) => `
    <li><a href="${href(section.id, it.id)}" data-route="${section.id}/${it.id}">
      <span class="item-title">${it.title}</span>${it.tagline ? `<span class="item-tag">: ${it.tagline}</span>` : ''}
      ${it.summary ? `<span class="item-sum">${it.summary}</span>` : ''}
    </a></li>`).join('')}</ul>`;
}

// Home: the welcome, then the section names.
function homeView() {
  const links = SECTIONS.map((s) => `<li><a href="${href(s.id)}" data-route="${s.id}">${s.title}</a></li>`).join('');
  return `
    <div class="wave" aria-hidden="true">👋🏽</div>
    <div class="intro">${PROFILE.intro.map((l) => `<p>${l}</p>`).join('')}</div>
    <ul class="section-list">${links}</ul>`;
}

function sectionView(s) {
  if (s.page) return pageView({ title: s.title, ...s.page }, { label: 'Home', route: [''] });
  return `
    <a class="back" href="./" data-route="">&larr; Home</a>
    <h1 class="title">${s.title}</h1>
    ${s.intro ? `<p class="lede">${s.intro}</p>` : ''}
    ${itemList(s)}`;
}

function itemView(s, it) {
  return pageView({ title: it.title, ...it.page }, { label: s.title, route: [s.id] });
}

// ---------- Routing ----------
let current = { s: null, i: null };

function parse(str) {
  const [s, i] = (str || '').split('/');
  const section = findSection(s);
  const item = section?.items?.find((x) => x.id === i);
  return { s: section ? s : null, i: item ? i : null };
}
function placeOf({ s, i }) {
  if (!s) return null;
  const section = findSection(s);
  return section.items?.find((x) => x.id === i)?.place || section.place;
}

function render(route, { walk = true } = {}) {
  current = route;
  const section = route.s && findSection(route.s);
  const item = section && route.i && section.items.find((x) => x.id === route.i);
  panel.classList.remove('in');
  panel.innerHTML = item ? itemView(section, item) : section ? sectionView(section) : homeView();
  void panel.offsetWidth;
  panel.classList.add('in');
  panel.scrollTop = 0;
  document.title = section ? `${item ? item.title : section.title} · ${PROFILE.name}` : PROFILE.name;
  for (const a of rail.querySelectorAll('.rail-btn')) a.classList.toggle('on', a.dataset.route === route.s);
  document.getElementById('rail-home').classList.toggle('on', !route.s);
  if (walk) {
    window.__villageGo = placeOf(route) || 'overview';   // remembered for the world if it hasn't loaded yet
    dispatchEvent(new CustomEvent('village:go', { detail: window.__villageGo }));
  }
}

function navigate(str, opts = {}) {
  const route = parse(str);
  const url = route.s ? href(route.s, route.i) : location.pathname;
  history[opts.replace ? 'replaceState' : 'pushState'](null, '', url);
  render(route, opts);
}

// Any link with data-route navigates in place.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-route]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.dataset.route);
});
addEventListener('popstate', () => render(parse(new URLSearchParams(location.search).get('p'))));

// Clicking a building or label in the village opens its section.
addEventListener('village:select', (e) => {
  const s = SECTIONS.find((x) => x.place === e.detail) ||
    SECTIONS.find((x) => x.items?.some((it) => it.place === e.detail));
  if (!s) return;
  const it = s.place === e.detail ? null : s.items.find((x) => x.place === e.detail);
  navigate(it ? `${s.id}/${it.id}` : s.id);
});

// Walking up to a place yourself opens its page, unless you're already reading it.
addEventListener('village:arrive', (e) => {
  if (placeOf(current) === e.detail) return;
  for (const s of SECTIONS) {
    const it = s.items?.find((x) => x.place === e.detail);
    if (it) return navigate(`${s.id}/${it.id}`, { walk: false });
    if (s.place === e.detail && current.s !== s.id) return navigate(s.id, { walk: false });
  }
});

// ---------- Avatar: a pixel portrait on a true 50×50 grid (img/avatar.png), shown enlarged ----------
const AVATAR = '<img src="img/avatar@8x.png" alt="" width="50" height="50" />';
document.getElementById('rail-home').innerHTML = `<span class="avatar">${AVATAR}</span><span class="tip">Home</span>`;

render(parse(new URLSearchParams(location.search).get('p')));
// The sidebar is up; let it paint, then build the world (the slow part) behind a loader.
requestAnimationFrame(() => requestAnimationFrame(() => import('./world.js')));
