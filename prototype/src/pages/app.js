// One page, three tabs. Each tab keeps its own script; this only switches between them.
import { render as renderSchedule } from './schedule.js';
import { render as renderReception } from './reception.js';
import { render as renderAdmin } from './admin.js';

const TABS = ['raspored', 'recepcija', 'admin'];
const RENDER = { raspored: renderSchedule, recepcija: renderReception, admin: renderAdmin };
const LABEL_MS = 3000;

const buttons = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`tab-${t}`)]));
const panels = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`panel-${t}`)]));
let current = null;
let labelTimer = null;

function show(tab) {
  if (tab === current) return;
  const from = current;
  const direction = from && TABS.indexOf(tab) < TABS.indexOf(from) ? 'from-left' : 'from-right';

  for (const t of TABS) {
    const on = t === tab;
    buttons[t].setAttribute('aria-selected', String(on));
    buttons[t].classList.remove('show-label');
    panels[t].hidden = !on;
    panels[t].classList.remove('from-left', 'from-right');
  }
  current = tab;
  RENDER[tab]();
  if (from) panels[tab].classList.add(direction);
  window.scrollTo(0, 0);

  // The chosen tab shows its name for 3 seconds, then folds to the icon.
  buttons[tab].classList.add('show-label');
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => buttons[tab].classList.remove('show-label'), LABEL_MS);
  history.replaceState(null, '', `#${tab}`);
}

for (const t of TABS) buttons[t].addEventListener('click', () => show(t));

const start = location.hash.slice(1);
show(TABS.includes(start) ? start : TABS[0]);
