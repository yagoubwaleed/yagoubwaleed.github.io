// The magic wand (top right of the world): each click picks a random rendering effect, page
// colour, font and greeting emoji from fixed sets; a reset button appears under it.
const root = document.documentElement;
export const DEFAULT_EMOJI = '\u{1F44B}\u{1F3FD}';
let emoji = DEFAULT_EMOJI;
export const currentEmoji = () => emoji;

// rendering effects, applied in the dithering pass (dither.js); 0 is the normal look
const EFFECTS = ['Game Boy', 'Noir', 'Sepia', 'Thermal', 'Inverted', 'Synthwave', 'Pastel', 'One-bit', 'Scanlines', 'Vapor'];
// page colours: background, and whether text on it should be dark
const COLOURS = [
  ['#0f2a1d', false], ['#1b1033', false], ['#2a0f14', false], ['#0d1b2a', false], ['#2b2118', false],
  ['#f4e9d8', true], ['#e6efe9', true], ['#f3e1ea', true], ['#e5e9f4', true], ['#fff4c7', true],
];
// fonts (Google Fonts), with a size nudge for the ones that run large or small
const FONTS = [
  ['Pixelify Sans', 1], ['VT323', 1.2], ['Silkscreen', 0.82], ['Space Mono', 0.92], ['Instrument Serif', 1.12],
  ['Unbounded', 0.88], ['Fraunces', 1], ['Syne Mono', 0.95], ['Bricolage Grotesque', 1], ['Caveat', 1.3],
];
const EMOJI = ['\u{1F9CC}', '\u{1F30C}', '\u{1F5FF}', '\u{1F9EE}', '\u{1F3B9}', '\u{1F643}', '\u{1F3D4}\u{FE0F}'];   // troll, galaxy, moai, abacus, piano, upside-down face, mountain
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const loaded = new Set();
function loadFont(name) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}&display=swap`;
  document.head.appendChild(l);
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const VARS = ['--bg', '--text', '--muted', '--faint', '--line', '--raised', '--fx-font', '--fx-scale'];

const stage = document.getElementById('stage');
stage.insertAdjacentHTML('beforeend', `
  <button id="wand" class="chip round" aria-label="Surprise me" title="Surprise me">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 15 9M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6zM7 3l.5 1 1 .5-1 .5L7 6l-.5-1-1-.5 1-.5z"/></svg>
  </button>
  <button id="wand-reset" class="chip round" aria-label="Back to normal" title="Back to normal" hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>
  </button>`);
const wand = document.getElementById('wand'), reset = document.getElementById('wand-reset');
const setEmoji = (e) => { emoji = e; for (const s of document.querySelectorAll('.wave span')) s.textContent = e; };

wand.addEventListener('click', (e) => {
  e.stopPropagation();
  const fx = 1 + Math.floor(Math.random() * EFFECTS.length), [bg, light] = pick(COLOURS), [font, scale] = pick(FONTS);
  loadFont(font);
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--text', light ? '#1d1b18' : '#f1ede6');
  root.style.setProperty('--muted', light ? '#5f5a52' : '#a8a29a');
  root.style.setProperty('--faint', light ? '#9a9389' : '#6c675f');
  root.style.setProperty('--line', light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.1)');
  root.style.setProperty('--raised', light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.07)');
  root.style.setProperty('--fx-font', `"${font}"`);
  root.style.setProperty('--fx-scale', scale);
  root.classList.add('fx');
  root.dataset.fx = fx;   // the avatar picks up a matching filter (index.html)
  setEmoji(pick(EMOJI.filter((x) => x !== emoji)));
  dispatchEvent(new CustomEvent('village:fx', { detail: { fx, bg: hexRgb(bg), light } }));
  reset.hidden = false;
});
reset.addEventListener('click', (e) => {
  e.stopPropagation();
  for (const v of VARS) root.style.removeProperty(v);
  root.classList.remove('fx');
  delete root.dataset.fx;
  setEmoji(DEFAULT_EMOJI);
  dispatchEvent(new CustomEvent('village:fx', { detail: null }));
  reset.hidden = true;
});
