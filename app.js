// One centred page: the welcome, then each section as a collapsible row (all start closed).
// Inside a section, each item (a paper, a role) is its own collapsible row too. ?p=section or
// ?p=section/item opens straight to that row, and opening a row updates the address.
import './settings.js';
import { PROFILE, SECTIONS } from './content.js';

const page = document.getElementById('page');
// Handwritten titles (img/titles/*.png, black ink on transparent). Each is drawn as a mask
// filled with the text colour, so it follows light/dark and hover like ordinary text.
const TITLES = { name: [871, 197], about: [339, 104], research: [458, 122], experience: [516, 139], teaching: [1290, 165], fun: [868, 146], blog: [1072, 165] };
const hand = (key, text, scale) => {
  const [w, h] = TITLES[key];
  return `<span class="hw" role="img" aria-label="${text}" style="--src: url(img/titles/${key}.png); width: ${Math.round(w * scale)}px; height: ${Math.round(h * scale)}px"></span>`;
};
const ARROW = '<svg class="arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 8.5l5-5M4 3.5h4.5V8"/></svg>';
const external = (href) => /^(https?:|mailto:)/.test(href);

// the body of a section or item: subtitle, link buttons, facts table, text
function pageBody({ meta, pills = [], facts = [], body = '' }) {
  return `
    ${meta ? `<p class="meta">${meta}</p>` : ''}
    ${pills.length ? `<div class="pills">${pills.map((p) => `
      <a class="pill${p.primary ? ' primary' : ''}" href="${p.href}"${external(p.href) && !p.href.startsWith('mailto:') ? ' target="_blank" rel="noopener"' : ''}>
        ${p.label}${external(p.href) ? ARROW : ''}</a>`).join('')}</div>` : ''}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    ${body ? `<div class="body">${body}</div>` : ''}`;
}

function itemRow(s, it) {
  return `
    <details class="item" data-route="${s.id}/${it.id}">
      <summary>
        <span class="item-title">${it.title}</span>${it.tagline ? `<span class="item-tag">: ${it.tagline}</span>` : ''}
        ${it.summary ? `<span class="item-sum">${it.summary}</span>` : ''}
      </summary>
      <div class="item-body">${it.page ? pageBody(it.page) : ''}</div>
    </details>`;
}

function sectionRow(s) {
  const inner = s.page
    ? pageBody(s.page)
    : `${s.intro ? `<p class="lede">${s.intro}</p>` : ''}
       ${s.items.length ? s.items.map((it) => itemRow(s, it)).join('') : `<p class="empty">${s.empty || 'Nothing here yet.'}</p>`}`;
  return `
    <details class="section" data-route="${s.id}">
      <summary>${TITLES[s.id] ? hand(s.id, s.title, 0.24) : s.title}</summary>
      <div class="section-body">${inner}</div>
    </details>`;
}

page.innerHTML = `
  <h1 class="name">${hand('name', PROFILE.name, 0.34)}</h1>
  <div class="wave" aria-hidden="true"><span>👋🏽</span></div>
  <div class="intro">${PROFILE.intro.map((l) => `<p>${l}</p>`).join('')}</div>
  <div class="sections">${SECTIONS.map(sectionRow).join('')}</div>`;

// open whatever the address points at
const [ps, pi] = (new URLSearchParams(location.search).get('p') || '').split('/');
const openSec = page.querySelector(`details.section[data-route="${ps}"]`);
if (openSec) {
  openSec.open = true;
  const openItem = pi && openSec.querySelector(`details.item[data-route="${ps}/${pi}"]`);
  if (openItem) openItem.open = true;
  (openItem || openSec).scrollIntoView({ block: 'start' });
}
// keep the address in step with the most recently opened row
page.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement)) return;
  const route = d.open ? d.dataset.route : d.dataset.route.split('/').slice(0, -1).join('/');
  history.replaceState(null, '', route ? `?p=${route}` : location.pathname);
}, true);
