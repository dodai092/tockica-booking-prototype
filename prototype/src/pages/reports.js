// Owner reports: the monthly instructor payout, its rates, and client analytics.
import { studioTime } from '../time.js';
import { monthReport, setActualInstructor, setInstructorRate, setBonusSettings, rateOn } from '../payroll.js';
import { popularSlots, popularInstructors, clientRides } from '../analytics.js';
import { loadStore, saveStore } from './session.js';
import { showBanner, slideIn, fadeIn, pop } from './motion.js';
import { openSheet, closeSheet, bindSheet } from './sheet.js';
import { chevron, foldToggle } from './admin.js';

const MONTH_NAMES = ['Siječanj', 'Veljača', 'Ožujak', 'Travanj', 'Svibanj', 'Lipanj', 'Srpanj', 'Kolovoz', 'Rujan', 'Listopad', 'Studeni', 'Prosinac'];
const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const TOP = 3;

const euro = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' });
const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayMonthFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', day: '2-digit', month: '2-digit' });

const $ = (id) => document.getElementById('i-' + id);
const store = loadStore();
saveStore(store);

let month = studioTime.localDate(new Date().toISOString()).slice(0, 7);
const openFolds = new Set(); // instructors whose class list is open, kept across re-renders

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function row(...children) {
  const node = el('div', undefined, 'g-row');
  node.append(...children);
  return node;
}

function main(title, ...subs) {
  const node = el('div', undefined, 'g-main');
  node.append(el('div', title, 'g-title'), ...subs.filter(Boolean).map((text) => el('div', text, 'g-sub')));
  return node;
}

function showMessage(text, isError = false) {
  showBanner($('message'), text, isError);
}

function act(action, text, rerender = true) {
  try {
    action();
    showMessage(text);
  } catch (err) {
    showMessage(err.message, true);
  }
  saveStore(store);
  if (rerender) render();
}

// Croatian plural: 1 vožnja, 2 vožnje, 5 vožnji (11 to 14 take the many form).
function plural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} ${one}`;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function shiftMonth(change) {
  const [year, mon] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year, mon - 1 + change, 1));
  month = moved.toISOString().slice(0, 7);
  render();
  slideIn($('payroll'), change);
}

function classRow(item, instructorName) {
  const date = new Date(item.startsAt);
  const day = DAY_NAMES[studioTime.dayOfWeek(item.startsAt) - 1];
  const tags = {
    out: `Zamjena: ${instructorName(item.actualId)}`,
    in: `Zamjena za: ${instructorName(item.scheduledId)}`,
    cancelled: 'Otkazano',
  };
  const money = item.fee + item.bonus ? euro.format(item.fee + item.bonus) : '';
  const sub = [item.status === 'upcoming' ? 'Predstoji' : item.role === 'cancelled' ? '' : `${item.attended}/${item.bikeCount} došlo`, money, tags[item.role]].filter(Boolean).join(' · ');
  const node = row(main(`${day} ${dayMonthFormat.format(date)} ${timeFormat.format(date)} ${item.name}`, sub));
  node.classList.add('class-row');
  if (item.role !== 'out' && item.role !== 'cancelled') {
    // Who taught is rarely changed, so it is one quiet button that opens a sheet.
    const who = el('button', undefined, 'g-text accent who-button');
    who.type = 'button';
    who.append(el('span', instructorName(item.actualId)), chevron());
    who.setAttribute('aria-label', `Tko je vodio: ${item.name}, trenutno ${instructorName(item.actualId)}`);
    who.addEventListener('click', () => askWho(item));
    node.append(who);
  }
  return node;
}

let lastTotals = new Map();

function renderPayroll() {
  const [year, mon] = month.split('-').map(Number);
  $('month').textContent = `${MONTH_NAMES[mon - 1]} ${year}`;
  const report = monthReport(store, month, new Date());
  const instructorName = (id) => store.instructors.find((i) => i.id === id)?.name ?? '';
  const section = $('payroll');
  section.replaceChildren();

  const total = report.rows.reduce((sum, r) => sum + r.total, 0);
  const taught = report.rows.reduce((sum, r) => sum + r.taught, 0);
  const riders = report.rows.reduce((sum, r) => sum + r.riders, 0);
  const hero = $('hero');
  hero.replaceChildren(el('div', 'Za isplatu', 's-meta'), el('div', euro.format(total), 'hero-amount'), el('div', `${plural(taught, 'trening', 'treninga', 'treninga')} · ${riders} došlo`, 's-meta'));
  const totals = new Map([['all', total], ...report.rows.map((r) => [r.instructorId, r.total])]);
  if (lastTotals.get('month') === month && lastTotals.get('all') !== total) pop(hero.querySelector('.hero-amount'), 0.94);
  lastTotals = new Map([...totals, ['month', month]]);

  for (const r of report.rows) {
    const group = el('div', undefined, 'group');
    const totalNode = el('span', euro.format(r.total), 'g-trail stat-total');
    group.append(row(main(r.name, `${plural(r.taught, 'trening', 'treninga', 'treninga')} · ${r.riders} došlo`), totalNode));
    // Fee and bonus on one line; the bonus only appears when there is one.
    group.append(row(main('Honorar', r.bonus ? `+ bonus ${euro.format(r.bonus)} za bicikle iznad ${report.threshold}` : ''), el('span', euro.format(r.fee), 'g-trail')));
    if (r.substitutedIn || r.substitutedOut) {
      group.append(row(main('Zamjene', `Preuzeto: ${r.substitutedIn} · Predano: ${r.substitutedOut}`)));
    }
    if (r.cancelled || r.upcoming) {
      group.append(row(main('Nije za isplatu', [r.cancelled && `Otkazano: ${r.cancelled}`, r.upcoming && `Predstoji: ${r.upcoming}`].filter(Boolean).join(' · '))));
    }
    if (r.classes.length) {
      const toggle = el('button', undefined, 'g-row g-action');
      toggle.type = 'button';
      const open = openFolds.has(r.instructorId);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.append(el('span', `Treninzi (${r.classes.length})`, 'g-main g-title'), chevron());
      const panel = el('div', undefined, 'class-list');
      panel.hidden = !open;
      panel.append(...r.classes.map((item) => classRow(item, instructorName)));
      foldToggle(toggle, panel);
      toggle.addEventListener('click', () => {
        if (toggle.getAttribute('aria-expanded') === 'true') openFolds.add(r.instructorId);
        else openFolds.delete(r.instructorId);
      });
      group.append(toggle, panel);
    }
    section.append(group);
  }
}

// The sheet that sets who actually taught a class.
let whoClass = null;
function askWho(item) {
  whoClass = item;
  $('sub-sub').textContent = item.name;
  const list = $('sub-list');
  list.replaceChildren();
  for (const instructor of store.instructors) {
    const choice = el('button', undefined, 'g-row g-action');
    choice.type = 'button';
    const current = instructor.id === item.actualId;
    choice.append(el('span', instructor.name, 'g-main g-title'), el('span', current ? '✓' : '', 'g-trail who-check'));
    choice.setAttribute('aria-pressed', String(current));
    choice.addEventListener('click', () => {
      closeSheet($('sub-sheet')).then(() => {
        if (!current) act(() => setActualInstructor(store, whoClass.classId, instructor.id), 'Zamjena spremljena.');
      });
    });
    list.append(choice);
  }
  openSheet($('sub-sheet'));
}

function numberRow(label, value, unit, onChange, step = '0.5') {
  const input = el('input', undefined, 'g-input g-price');
  input.type = 'number';
  input.min = '0';
  input.step = step;
  input.inputMode = 'decimal';
  input.value = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(Number(input.value)));
  const node = el('label', undefined, 'g-row');
  node.append(el('span', label, 'g-main g-title'), input, el('span', unit, 'g-trail'));
  return node;
}

function renderRates() {
  const section = $('rates');
  const today = studioTime.localDate(new Date().toISOString());
  section.replaceChildren();
  const group = el('div', undefined, 'group');
  for (const instructor of store.instructors) {
    group.append(numberRow(`Honorar: ${instructor.name}`, rateOn(instructor, today), '€', (eur) => act(() => setInstructorRate(store, instructor.id, eur, today), 'Honorar spremljen od danas.', false)));
  }
  const settings = store.settings;
  const save = (patch) => act(() => setBonusSettings(store, { threshold: settings.bonusThreshold ?? 15, eur: settings.bonusEur ?? 2, ...patch }), 'Bonus spremljen.');
  group.append(
    numberRow('Bonus od bicikla', settings.bonusThreshold ?? 15, 'od 20', (threshold) => save({ threshold }), '1'),
    numberRow('Bonus po biciklu', settings.bonusEur ?? 2, '€', (eur) => save({ eur })),
  );
  section.append(group);
}

function statGroup(title, rows) {
  const group = el('div', undefined, 'group');
  group.append(row(el('span', title, 'g-main g-title stat-title')));
  if (rows.length === 0) group.append(row(el('span', 'Još nema podataka.', 'g-sub')));
  else group.append(...rows);
  return group;
}

function renderAnalytics() {
  const slots = popularSlots(store).slice(0, TOP).map((slot) =>
    row(main(`${DAY_NAMES[slot.dayOfWeek - 1]} ${slot.time}`), el('span', plural(slot.count, 'rezervacija', 'rezervacije', 'rezervacija'), 'g-trail')));
  const instructors = popularInstructors(store).slice(0, TOP).map((instructor) =>
    row(main(instructor.name), el('span', plural(instructor.count, 'rezervacija', 'rezervacije', 'rezervacija'), 'g-trail')));
  // Whoever is closest to the 50th or 100th class comes first, so it is easy to see who to celebrate.
  const closest = (c) => (c.milestone ? -1 : c.next ? c.toNext : Infinity);
  const rides = clientRides(store).sort((a, b) => closest(a) - closest(b) || b.rides - a.rides).map((client) => {
    const target = client.next ?? client.rides;
    const meter = el('div', undefined, 'g-meter');
    const fill = el('span');
    fill.style.width = `${Math.min(100, (client.rides / target) * 100)}%`;
    meter.append(fill);
    const sub = client.next ? `Do ${client.next}. sata još ${client.toNext}` : '100. sat je dosegnut';
    const celebrate = client.milestone ? `${client.milestone}. sat!` : client.next && client.toNext <= 3 ? `Još ${client.toNext} do ${client.next}. sata` : '';
    const item = row(main(client.name, sub), el('span', plural(client.rides, 'vožnja', 'vožnje', 'vožnji'), 'g-trail'));
    item.classList.add('stat-row');
    if (celebrate) item.querySelector('.g-main').append(el('span', celebrate, 'milestone-badge'));
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(target));
    meter.setAttribute('aria-valuenow', String(client.rides));
    meter.setAttribute('aria-label', `${client.name}: ${client.rides} od ${target}`);
    item.append(meter);
    return item;
  });
  $('analytics').replaceChildren(
    statGroup('Najpopularniji termin', slots),
    statGroup('Najpopularniji trener', instructors),
    statGroup('Vožnje po klijentu', rides),
  );
}

export function render() {
  renderPayroll();
  renderRates();
  renderAnalytics();
}

const SEGMENTS = ['isplata', 'klijenti', 'postavke'];
const segments = $('segments');
segments.addEventListener('click', (event) => {
  const button = event.target.closest('[data-seg]');
  if (!button) return;
  const index = SEGMENTS.indexOf(button.dataset.seg);
  segments.style.setProperty('--i', String(index));
  for (const b of segments.querySelectorAll('[data-seg]')) b.setAttribute('aria-selected', String(b === button));
  for (const name of SEGMENTS) {
    const panel = $(name);
    const on = name === button.dataset.seg;
    if (on && panel.hidden) fadeIn(panel, 6, 200);
    panel.hidden = !on;
  }
});

const subSheet = $('sub-sheet');
bindSheet(subSheet);
$('sub-close').addEventListener('click', () => closeSheet(subSheet));

$('prev').addEventListener('click', () => shiftMonth(-1));
$('next').addEventListener('click', () => shiftMonth(1));

render();
