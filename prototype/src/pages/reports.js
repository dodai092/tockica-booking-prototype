// Owner reports: the monthly instructor payout, its rates, and client analytics.
import { studioTime, hrDate } from '../time.js';
import { monthReport, setActualInstructor, setInstructorRate, setBonusSettings, setPaid, paidEntry, summaryText, rateOn } from '../payroll.js';
import { popularSlots, popularInstructors, clientRides, clientHistory } from '../analytics.js';
import { loadStore, saveStore } from './session.js';
import { showBanner, slideIn, fadeIn, pop } from './motion.js';
import { openSheet, closeSheet, bindSheet } from './sheet.js';
import { tabKeys } from './tabkeys.js';
import { chevron, foldToggle } from './admin.js';
import { openClass } from './reception.js';

const MONTH_NAMES = ['Siječanj', 'Veljača', 'Ožujak', 'Travanj', 'Svibanj', 'Lipanj', 'Srpanj', 'Kolovoz', 'Rujan', 'Listopad', 'Studeni', 'Prosinac'];
const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const TOP = 3;

const euro = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' });
const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayMonthFormat = hrDate({ day: '2-digit', month: '2-digit' });

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

// Lower case, no accents, so "stjepko" finds "Stjepko" and "zeljko" finds "Željko".
const plain = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

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

// Finished classes whose bookings are not all marked: the bonus and the rider counts would be off.
function renderNotice(report) {
  const section = $('notice');
  section.replaceChildren();
  if (!report.needsCheckIn.length) return;
  const group = el('div', undefined, 'group notice');
  group.append(row(main('Za provjeru', `${plural(report.needsCheckIn.length, 'održan trening ima', 'održana treninga imaju', 'održanih treninga ima')} rezervacije bez dolaska ili no-showa. Bonus se broji samo za označene dolaske.`)));
  for (const item of report.needsCheckIn.slice(0, 3)) {
    const date = new Date(item.startsAt);
    const link = el('button', undefined, 'g-row g-action');
    link.type = 'button';
    link.append(main(`${DAY_NAMES[studioTime.dayOfWeek(item.startsAt) - 1]} ${dayMonthFormat.format(date)} ${timeFormat.format(date)} ${item.name}`, `Neoznačeno: ${item.open}`), chevron());
    link.addEventListener('click', () => {
      openClass(item.classId);
      window.dispatchEvent(new CustomEvent('tockica:tab', { detail: 'recepcija' }));
    });
    group.append(link);
  }
  section.append(group);
}

function renderPayroll() {
  const [year, mon] = month.split('-').map(Number);
  $('month').textContent = `${MONTH_NAMES[mon - 1]} ${year}`;
  const report = monthReport(store, month, new Date());
  const instructorName = (id) => store.instructors.find((i) => i.id === id)?.name ?? '';
  const section = $('payroll');
  section.replaceChildren();

  const total = report.rows.reduce((sum, r) => sum + r.total, 0);
  const paid = report.rows.reduce((sum, r) => sum + (paidEntry(store, month, r.instructorId) ? r.total : 0), 0);
  const taught = report.rows.reduce((sum, r) => sum + r.taught, 0);
  const riders = report.rows.reduce((sum, r) => sum + r.riders, 0);
  const owed = total - paid;
  const hero = $('hero');
  hero.replaceChildren(
    el('div', 'Za isplatu', 's-meta'),
    el('div', euro.format(owed), 'hero-amount'),
    el('div', [paid ? `Već isplaćeno ${euro.format(paid)}` : '', `${plural(taught, 'trening', 'treninga', 'treninga')} · ${riders} došlo`].filter(Boolean).join(' · '), 's-meta'),
  );
  if (lastTotals.get('month') === month && lastTotals.get('owed') !== owed) pop(hero.querySelector('.hero-amount'), 0.94);
  lastTotals = new Map([['month', month], ['owed', owed]]);

  renderNotice(report);

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
    const paidNow = paidEntry(store, month, r.instructorId);
    const paidRow = el('label', undefined, 'g-row');
    const paidBox = el('input', undefined, 'switch');
    paidBox.type = 'checkbox';
    paidBox.setAttribute('role', 'switch');
    paidBox.checked = Boolean(paidNow);
    const paidSub = !paidNow ? '' : paidNow.total !== r.total
      ? `Iznos se promijenio od isplate (bilo ${euro.format(paidNow.total)})`
      : `Isplaćeno ${hrDate({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(paidNow.at))}`;
    paidRow.append(main('Isplaćeno', paidSub), paidBox);
    paidBox.addEventListener('change', () => act(() => setPaid(store, month, r.instructorId, { on: paidBox.checked, total: r.total, now: new Date() }), paidBox.checked ? 'Označeno kao isplaćeno.' : 'Oznaka maknuta.'));
    group.append(paidRow);
    const share = el('button', undefined, 'g-row g-action');
    share.type = 'button';
    share.append(el('span', 'Podijeli sažetak', 'g-main g-title'), chevron());
    share.addEventListener('click', () => shareSummary(summaryText(report, r, $('month').textContent, instructorName), `${r.name}, ${$('month').textContent}`));
    group.append(share);
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

const dateFormat = hrDate({ day: 'numeric', month: 'numeric', year: 'numeric' });

// One client's history, in a sheet: how often, what, with whom, first and last visit.
function showClient(accountId) {
  const h = clientHistory(store, accountId);
  const next = [50, 100].find((m) => m > h.rides);
  $('client-title').textContent = h.name;
  $('client-sub').textContent = plural(h.rides, 'vožnja', 'vožnje', 'vožnji');
  const body = $('client-body');
  body.replaceChildren();
  if (h.rides === 0) {
    const empty = el('div', undefined, 'group');
    empty.append(row(el('span', 'Još nije bio na treningu.', 'g-sub')));
    body.append(empty);
  } else {
    const facts = el('div', undefined, 'group');
    facts.append(
      row(main('Prvi dolazak'), el('span', dateFormat.format(new Date(h.first)), 'g-trail')),
      row(main('Zadnji dolazak'), el('span', dateFormat.format(new Date(h.last)), 'g-trail')),
    );
    if (next) facts.append(row(main(`${next}. sat`, `Još ${next - h.rides}`)));
    body.append(facts);
    body.append(el('h3', 'Najčešće', 'g-header'));
    const often = el('div', undefined, 'group');
    for (const c of h.byClass.slice(0, 5)) often.append(row(main(c.name), el('span', `${c.count}×`, 'g-trail')));
    body.append(often);
    body.append(el('h3', 'Trener', 'g-header'));
    const who = el('div', undefined, 'group');
    for (const i of h.byInstructor) who.append(row(main(i.name), el('span', `${i.count}×`, 'g-trail')));
    body.append(who);
  }
  if (h.guestRides) body.append(el('p', `Kao gost je dovedeno još ${plural(h.guestRides, 'vožnja', 'vožnje', 'vožnji')}. One se ne broje u 50. i 100. sat.`, 'g-footer'));
  openSheet($('client-sheet'));
}

// The phone's share sheet where there is one, else the clipboard.
async function shareSummary(text, title) {
  try {
    if (navigator.share) await navigator.share({ title, text });
    else {
      await navigator.clipboard.writeText(text);
      showMessage('Sažetak je kopiran.');
    }
  } catch (err) {
    if (err.name !== 'AbortError') showMessage('Dijeljenje nije uspjelo.', true);
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
  const query = plain($('client-search').value.trim());
  const closest = (c) => (c.milestone ? -1 : c.next ? c.toNext : Infinity);
  const rides = clientRides(store).filter((c) => !query || plain(c.name).includes(query)).sort((a, b) => closest(a) - closest(b) || b.rides - a.rides).map((client) => {
    const target = client.next ?? client.rides;
    const meter = el('div', undefined, 'g-meter');
    const fill = el('span');
    fill.style.width = `${Math.min(100, (client.rides / target) * 100)}%`;
    meter.append(fill);
    const sub = client.next ? `Do ${client.next}. sata još ${client.toNext}` : '100. sat je dosegnut';
    const celebrate = client.milestone ? `${client.milestone}. sat!` : client.next && client.toNext <= 3 ? `Još ${client.toNext} do ${client.next}. sata` : '';
    const item = el('button', undefined, 'g-row stat-row g-action');
    item.type = 'button';
    item.append(main(client.name, sub), el('span', plural(client.rides, 'vožnja', 'vožnje', 'vožnji'), 'g-trail'));
    item.addEventListener('click', () => showClient(client.accountId));
    if (celebrate) item.querySelector('.g-main').append(el('span', celebrate, 'milestone-badge'));
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(target));
    meter.setAttribute('aria-valuenow', String(client.rides));
    meter.setAttribute('aria-label', `${client.name}: ${client.rides} od ${target}`);
    item.append(meter);
    return item;
  });
  // Searching narrows the page to the matching clients.
  $('analytics').replaceChildren(...(query ? [] : [statGroup('Najpopularniji termin', slots), statGroup('Najpopularniji trener', instructors)]), statGroup('Vožnje po klijentu', rides));
}

export function render() {
  renderPayroll();
  renderRates();
  renderAnalytics();
}

const SEGMENTS = ['isplata', 'klijenti', 'postavke'];
const segments = $('segments');
tabKeys([...segments.querySelectorAll('[data-seg]')]);
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

const clientSheet = $('client-sheet');
bindSheet(clientSheet);
$('client-close').addEventListener('click', () => closeSheet(clientSheet));
$('client-search').addEventListener('input', () => renderAnalytics());

const subSheet = $('sub-sheet');
bindSheet(subSheet);
$('sub-close').addEventListener('click', () => closeSheet(subSheet));

$('prev').addEventListener('click', () => shiftMonth(-1));
$('next').addEventListener('click', () => shiftMonth(1));

render();
