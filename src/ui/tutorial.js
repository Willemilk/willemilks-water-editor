// First-run tutorial: a short spotlight tour over the real UI. Skippable,
// remembered in localStorage, re-launchable from the help button.
import { el } from './panels.js';
import { t } from '../i18n.js';

const KEY = 'wwe_tutorial_done_v1';

// Titles and bodies live in i18n under tut.s0..s6.
const STEPS = [
  { target: null, key: 's0' },
  { target: '#level-panel', key: 's1' },
  { target: '#toolbar-tools', key: 's2' },
  { target: '#material-bar', key: 's3' },
  { target: '#tab-objects', key: 's4' },
  { target: '#inspector', key: 's5' },
  { target: '#btn-save', key: 's6' },
];

export function shouldShowTutorial() {
  try { return !localStorage.getItem(KEY); } catch { return true; }
}

export function markTutorialDone() {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
}

export function startTutorial() {
  document.querySelector('.tut-overlay')?.remove();
  let i = 0;
  const spotlight = el('div', { class: 'tut-spotlight' });
  const card = el('div', { class: 'tut-card' });
  const overlay = el('div', { class: 'tut-overlay' }, spotlight, card);
  document.body.append(overlay);

  function close() {
    markTutorialDone();
    overlay.remove();
    window.removeEventListener('resize', position);
    window.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' || e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft' && i > 0) { i--; render(); }
  }

  function next() {
    if (i === STEPS.length - 1) return close();
    i++;
    render();
  }

  function position() {
    const step = STEPS[i];
    const target = step.target ? document.querySelector(step.target) : null;
    if (target) {
      const r = target.getBoundingClientRect();
      spotlight.style.display = 'block';
      spotlight.style.left = r.left - 8 + 'px';
      spotlight.style.top = r.top - 8 + 'px';
      spotlight.style.width = r.width + 16 + 'px';
      spotlight.style.height = r.height + 16 + 'px';
      const cardW = 380;
      let cx = r.right + 16;
      if (cx + cardW > window.innerWidth) cx = Math.max(12, r.left - cardW - 16);
      const cy = Math.min(Math.max(12, r.top), window.innerHeight - 240);
      card.style.left = cx + 'px';
      card.style.top = cy + 'px';
      card.style.transform = 'none';
    } else {
      // no target (intro step, or the element is not on screen): centered card
      spotlight.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
    }
  }

  function render() {
    const step = STEPS[i];
    const last = i === STEPS.length - 1;
    card.replaceChildren(
      el('div', { class: 'tut-progress' },
        ...STEPS.map((_, n) => el('span', { class: n <= i ? 'on' : '' }))),
      el('h3', { text: t(`tut.${step.key}.title`) }),
      el('p', { text: t(`tut.${step.key}.body`) }),
      el('div', { class: 'tut-actions' },
        el('button', { class: 'btn ghost', text: t('tut.skip'), onclick: close }),
        el('div', { class: 'row gap' },
          i > 0 ? el('button', { class: 'btn ghost', text: t('tut.back'), onclick: () => { i--; render(); } }) : null,
          el('button', { class: 'btn primary', text: last ? t('tut.done') : t('tut.next'), onclick: next }))
      )
    );
    position();
  }

  window.addEventListener('resize', position);
  window.addEventListener('keydown', onKey);
  render();
}

// ---------------- toasts ----------------

let toastWrap = null;

export function toast(message, kind = 'info', ms = 3200) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toasts';
    document.body.append(toastWrap);
  }
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  toastWrap.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, ms);
}
