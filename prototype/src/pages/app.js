// One page, three tabs. Each tab keeps its own script; this only switches between them.
import { render as renderSchedule } from './schedule.js';
import { render as renderReception } from './reception.js';
import { render as renderAdmin } from './admin.js';

const TABS = ['raspored', 'recepcija', 'admin'];
const RENDER = { raspored: renderSchedule, recepcija: renderReception, admin: renderAdmin };

const buttons = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`tab-${t}`)]));
const panels = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`panel-${t}`)]));
let current = null;

function show(tab) {
  const first = current === null;
  for (const t of TABS) {
    const on = t === tab;
    buttons[t].setAttribute('aria-selected', String(on));
    panels[t].hidden = !on;
    panels[t].classList.remove('entering');
  }
  current = tab;
  RENDER[tab]();
  if (!first) panels[tab].classList.add('entering');
  window.scrollTo(0, 0);
  history.replaceState(null, '', `#${tab}`);
}

// Tapping the tab you are on scrolls back to the top, like iOS.
for (const t of TABS) {
  buttons[t].addEventListener('click', () => {
    if (t === current) window.scrollTo({ top: 0, behavior: 'smooth' });
    else show(t);
  });
}

const start = location.hash.slice(1);
show(TABS.includes(start) ? start : TABS[0]);
