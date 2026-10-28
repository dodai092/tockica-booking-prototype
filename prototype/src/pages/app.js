// One page, three tabs. Each tab keeps its own script; this only switches between them.
import { render as renderSchedule } from './schedule.js';
import { render as renderReception } from './reception.js';
import { render as renderReports } from './reports.js';
import { render as renderAdmin } from './admin.js';
import './info.js';
import './theme.js';

const TABS = ['raspored', 'recepcija', 'izvjestaji', 'admin'];
const RENDER = { raspored: renderSchedule, recepcija: renderReception, izvjestaji: renderReports, admin: renderAdmin };

const buttons = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`tab-${t}`)]));
const panels = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`panel-${t}`)]));
let current = null;
const bar = document.querySelector('.tab-bar');
const indicator = document.querySelector('.tab-indicator');

function moveIndicator(tab, animate) {
  const b = buttons[tab];
  indicator.classList.toggle('no-anim', !animate);
  indicator.style.width = `${b.offsetWidth}px`;
  indicator.style.height = `${b.offsetHeight}px`;
  indicator.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
}

function show(tab) {
  const first = current === null;
  for (const t of TABS) {
    const on = t === tab;
    buttons[t].setAttribute('aria-selected', String(on));
    panels[t].hidden = !on;
    panels[t].classList.remove('entering');
  }
  current = tab;
  moveIndicator(tab, !first);
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

window.addEventListener('resize', () => moveIndicator(current, false));
document.fonts?.ready.then(() => moveIndicator(current, false));

const start = location.hash.slice(1);
show(TABS.includes(start) ? start : TABS[0]);
bar.classList.add('ready'); // from now on a newly selected tab icon pops
