// First-run tutorial: a short spotlight tour over the real UI. Skippable,
// remembered in localStorage, re-launchable from the help button.
const KEY = 'wwe_tutorial_done_v1';

const STEPS = [
  {
    target: null,
    title: 'Welcome to Willemilks Water Editor',
    body: 'A full level editor for Where\'s My Water, including the thing other editors can\'t do: painting the terrain itself. This tour takes 30 seconds.',
  },
  {
    target: '#level-panel',
    title: '1 · Pick a level',
    body: 'Every level from your game files shows up here. Click one to open it. Use the search box to find levels fast (try "first_dig").',
  },
  {
    target: '#toolbar-tools',
    title: '2 · Tools',
    body: 'Select (V) moves objects. Pencil (B), Line (L), Rectangle (R), Fill (F) and Eraser (E) paint the terrain. Picker (I) samples a material from the level.',
  },
  {
    target: '#material-bar',
    title: '3 · Materials',
    body: 'This is the official terrain palette from the game\'s own dev files. Dirt is diggable, rock is solid, blue is pre-placed water. Pick one, then paint.',
  },
  {
    target: '#tab-objects',
    title: '4 · Objects',
    body: 'Browse every object in the game with live previews: stars, spouts, fans, bombs. Click one, then click in the level to place it.',
  },
  {
    target: '#inspector',
    title: '5 · Inspector',
    body: 'Select an object to edit its position, angle and every property (FluidType, motor speeds, timers…). With nothing selected you edit the level properties here.',
  },
  {
    target: '#btn-save',
    title: '6 · Save & export',
    body: 'Save writes into the loaded game tree. Export gives you the .xml and .png pair, ready to drop into your APK with your mod.bat workflow. Ctrl+Z undoes anything. Have fun!',
  },
];

export function shouldShowTutorial() {
  try { return !localStorage.getItem(KEY); } catch { return true; }
}

export function markTutorialDone() {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
}

export function startTutorial() {
  let i = 0;
  const overlay = document.createElement('div');
  overlay.className = 'tut-overlay';
  const spotlight = document.createElement('div');
  spotlight.className = 'tut-spotlight';
  const card = document.createElement('div');
  card.className = 'tut-card';
  overlay.append(spotlight, card);
  document.body.append(overlay);

  function close() {
    markTutorialDone();
    overlay.remove();
    window.removeEventListener('resize', position);
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
      const cardW = 360;
      let cx = r.right + 16;
      if (cx + cardW > window.innerWidth) cx = Math.max(12, r.left - cardW - 16);
      let cy = Math.min(Math.max(12, r.top), window.innerHeight - 220);
      card.style.left = cx + 'px';
      card.style.top = cy + 'px';
      card.style.transform = 'none';
    } else {
      spotlight.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
    }
  }

  function render() {
    const step = STEPS[i];
    card.innerHTML = `
      <div class="tut-progress">${STEPS.map((_, n) => `<span class="${n <= i ? 'on' : ''}"></span>`).join('')}</div>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <div class="tut-actions">
        <button class="btn ghost" data-act="skip">Skip tour</button>
        <div>
          ${i > 0 ? '<button class="btn ghost" data-act="back">Back</button>' : ''}
          <button class="btn primary" data-act="next">${i === STEPS.length - 1 ? t('tut.done') : t('tut.next')}</button>
        </div>
      </div>`;
    card.querySelector('[data-act="skip"]').onclick = close;
    card.querySelector('[data-act="next"]').onclick = () => {
      if (i === STEPS.length - 1) return close();
      i++; render(); position();
    };
    card.querySelector('[data-act="back"]')?.addEventListener('click', () => { i--; render(); position(); });
  }

  window.addEventListener('resize', position);
  render();
  position();
}

// ---------------- toasts ----------------

let toastWrap = null;

export function toast(message, kind = 'info', ms = 3200) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toasts';
    document.body.append(toastWrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  toastWrap.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}
