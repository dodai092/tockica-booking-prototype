// One page, three tabs. Each tab keeps its own script; this only switches between them.
import { render as renderSchedule } from './schedule.js';
import { render as renderAccount } from './account.js';
import { render as renderReception } from './reception.js';
import { render as renderReports } from './reports.js';
import { render as renderAdmin } from './admin.js';
import { render as renderSculpt } from './sculpt.js';
import './info.js';
import './theme.js';
import { tabKeys } from './tabkeys.js';
import { LOGINS, getLogin, setLogin, loadStore } from './session.js';
import { askCancel } from './schedule.js';
import { loginRole, tabsFor, canOpen } from '../roles.js';

const TABS = ['raspored', 'racun', 'recepcija', 'izvjestaji', 'admin', 'sculpt'];
const RENDER = { raspored: renderSchedule, racun: renderAccount, recepcija: renderReception, izvjestaji: renderReports, admin: renderAdmin, sculpt: renderSculpt };

const buttons = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`tab-${t}`)]));
const panels = Object.fromEntries(TABS.map((t) => [t, document.getElementById(`panel-${t}`)]));
let current = null;
const bar = document.querySelector('.tab-bar');
const indicator = document.querySelector('.tab-indicator');

const allowed = () => tabsFor(loginRole(getLogin()));

function moveIndicator(tab, animate) {
  const b = buttons[tab];
  indicator.classList.toggle('no-anim', !animate);
  indicator.style.width = `${b.offsetWidth}px`;
  indicator.style.height = `${b.offsetHeight}px`;
  indicator.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
}

function show(tab) {
  if (!allowed().includes(tab)) tab = allowed()[0];
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

// Other pages can ask for a tab, for example a report linking to a class in Recepcija.
window.addEventListener('tockica:tab', (event) => show(event.detail));

// Tapping the tab you are on scrolls back to the top, like iOS.
for (const t of TABS) {
  buttons[t].addEventListener('click', () => {
    if (t === current) window.scrollTo({ top: 0, behavior: 'smooth' });
    else show(t);
  });
}

// The tabs the signed-in role may see. The keyboard handler reads this array, so it is edited in place.
const visibleTabs = TABS.map((t) => buttons[t]);
tabKeys(visibleTabs);

function applyRole() {
  for (const t of TABS) buttons[t].hidden = !canOpen(loginRole(getLogin()), t);
  visibleTabs.splice(0, visibleTabs.length, ...TABS.filter((t) => !buttons[t].hidden).map((t) => buttons[t]));
}

// Demo sign-in: switches between two customers, Reception, the Owner and two trainers.
const login = document.getElementById('login');
for (const [value, label] of LOGINS) login.append(new Option(label, value));
login.value = getLogin();
login.addEventListener('change', () => {
  setLogin(login.value);
  applyRole();
  show(allowed().includes(current) ? current : allowed()[0]);
  moveIndicator(current, false);
});
applyRole();

window.addEventListener('resize', () => moveIndicator(current, false));
document.fonts?.ready.then(() => moveIndicator(current, false));

// A link like #racun/otkazi/<booking id> (from the reminder mail) opens Moj profil and asks to cancel that booking,
// but only for the signed-in customer who owns it.
const [start, action, bookingId] = location.hash.slice(1).split('/');
show(TABS.includes(start) ? start : allowed()[0]);
if (action === 'otkazi' && current === 'racun') {
  const store = loadStore();
  const booking = store.bookings.find((b) => b.id === bookingId && b.status === 'booked' && b.accountId === getLogin());
  const session = booking && store.classes.find((c) => c.id === booking.classId);
  if (session && Date.parse(session.startsAt) > Date.now()) askCancel(booking, session);
}
bar.classList.add('ready'); // from now on a newly selected tab icon pops
