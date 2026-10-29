import { studioTime, hrDate } from '../time.js';
import { checkIn, checkInOpen, closeClass, correctStatus } from '../checkin.js';
import { markNoShow } from '../booking.js';
import { taughtBy } from '../payroll.js';
import { clientRides } from '../analytics.js';
import { bikePosition } from '../layout.js';
import { loadStore, saveStore } from './session.js';
import { fadeIn, fadeOut, pop, showBanner, resize, release, haptic } from './motion.js';

const STATUS_TEXT = {
  booked: 'Rezervirano',
  attended: 'Došao',
  no_show: 'No-show',
  cancelled: 'Otkazano',
  late_cancel: 'Kasno otkazano',
};
const CLASS_MIN_MS = 60 * 1000;

const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayFormat = hrDate({
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

const $ = (id) => document.getElementById('r-' + id);
const store = loadStore();
saveStore(store);
let day = null;
let view = sessionStorage.getItem('tockica-reception-view') === 'map' ? 'map' : 'list';
let selectedId = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function endOf(session) {
  return Date.parse(session.startsAt) + session.durationMin * CLASS_MIN_MS;
}

function showMessage(text, isError = false) {
  showBanner($('message'), text, isError);
}

// Runs an action, saves, and re-renders. Errors show as a message; a success shows in the
// row itself and offers an undo for a few seconds.
// `label` is the undo text, or a function run after the action that may return a celebration.
function act(action, label) {
  const snapshot = structuredClone(store);
  const heights = new Map([...$('classes').querySelectorAll('[data-booking]')].map((row) => [row.dataset.booking, row.getBoundingClientRect().height]));
  const before = new Map(store.bookings.map((b) => [b.id, b.status]));
  try {
    action();
    showMessage('');
    const result = typeof label === 'function' ? label() : label;
    showUndo(typeof result === 'string' ? { text: result } : result, snapshot);
  } catch (err) {
    showMessage(err.message, true);
  }
  saveStore(store);
  render();
  // Whatever changed status pops, and so do the counts.
  let changed = false;
  for (const row of $('classes').querySelectorAll('[data-booking]')) {
    // A row that gained or lost action buttons glides to its new height.
    if (heights.has(row.dataset.booking)) resize(row, heights.get(row.dataset.booking));
    if (before.get(row.dataset.booking) !== row.dataset.status) {
      pop(row.querySelector('.pill'), 0.8);
      changed = true;
    }
  }
  if (changed) for (const count of $('classes').querySelectorAll('.s-counts strong')) pop(count, 0.85);
}

// The undo snackbar: the last action's before-state, kept for 5 seconds.
let undoState = null;
let undoTimer = 0;
let undoToken = 0;

function hideUndo(animate = true) {
  clearTimeout(undoTimer);
  undoState = null;
  const snack = $('undo');
  const token = ++undoToken;
  if (snack.hidden) return;
  if (!animate) {
    snack.hidden = true;
    release(snack);
    return;
  }
  fadeOut(snack).then(() => {
    if (token !== undoToken) return;
    snack.hidden = true;
    release(snack);
  });
}

function showUndo({ text, celebrate = false }, snapshot) {
  const snack = $('undo');
  clearTimeout(undoTimer);
  undoToken += 1;
  undoState = snapshot;
  $('undo-text').textContent = text;
  snack.classList.toggle('celebrate', celebrate);
  haptic(celebrate ? [10, 60, 10, 60, 20] : 10);
  release(snack);
  snack.hidden = false;
  fadeIn(snack, 8, 200);
  if (celebrate) pop(snack, 0.94);
  undoTimer = setTimeout(hideUndo, 5000);
}

$('undo-button').addEventListener('click', () => {
  if (!undoState) return;
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, undoState);
  saveStore(store);
  hideUndo();
  render();
});

// The day to open on: today if it has trainings, else the next day that does, else the last.
function defaultDay(days, today) {
  return days.includes(today) ? today : days.find((d) => d > today) ?? days[days.length - 1];
}

function renderDayPicker(now) {
  const select = $('day');
  const days = [...new Set(store.classes.map((c) => studioTime.localDate(c.startsAt)))].sort();
  const today = studioTime.localDate(now.toISOString());
  if (!day || !days.includes(day)) day = defaultDay(days, today);

  select.replaceChildren();
  for (const d of days) {
    const option = el('option', dayFormat.format(new Date(Date.parse(studioTime.toUtc(`${d}T12:00`)))) + (d === today ? ' · danas' : ''));
    option.value = d;
    option.selected = d === day;
    select.append(option);
  }
}

function renderSummary(session, now) {
  const start = Date.parse(session.startsAt);
  const instructor = store.instructors.find((i) => i.id === taughtBy(session))?.name ?? '';
  const rows = store.bookings.filter((b) => b.classId === session.id);
  const reserved = rows.filter((b) => ['booked', 'attended', 'no_show'].includes(b.status)).length;
  const attended = rows.filter((b) => b.status === 'attended').length;

  let state;
  let tone;
  if (now.getTime() >= endOf(session)) [state, tone] = ['Trening je završio', 'muted'];
  else if (checkInOpen(session, now)) [state, tone] = ['Check-in je otvoren', 'open'];
  else {
    const opens = new Date(start - 30 * CLASS_MIN_MS);
    [state, tone] = [`Check-in se otvara ${dayFormat.format(opens)} u ${timeFormat.format(opens)}`, 'wait'];
  }

  const info = el('div');
  info.append(
    el('div', timeFormat.format(new Date(start)), 's-time'),
    el('div', session.name, 's-name'),
    el('div', [instructor, session.themeName, dayFormat.format(new Date(start))].filter(Boolean).join(' · '), 's-meta'),
  );
  const side = el('div', undefined, 's-side');
  const counts = el('div', undefined, 's-counts');
  for (const [value, label] of [[`${reserved}/${session.bikeCount}`, 'rezervirano'], [String(attended), 'došlo']]) {
    const box = el('div');
    box.append(el('strong', value), el('span', label));
    counts.append(box);
  }
  side.append(el('span', state, `pill pill-${tone}`), counts);
  const card = el('div', undefined, 'summary');
  card.dataset.title = `${timeFormat.format(new Date(start))} ${session.name}`;
  card.dataset.counts = `${reserved}/${session.bikeCount} · ${attended} došlo`;
  card.append(info, side);
  return card;
}

function row(...children) {
  const node = el('div', undefined, 'g-row');
  node.append(...children);
  return node;
}

// Who is on the bike: the guest if there is one, else the account holder.
const riderOf = (booking) => booking.guestName || store.accounts.find((a) => a.id === booking.accountId)?.name || '';

// The account holder's 50th or 100th class: worth saying out loud at the door.
function milestoneOf(booking) {
  if (booking.guestName) return null;
  const client = clientRides(store).find((c) => c.accountId === booking.accountId);
  return client?.milestone ? { text: `${client.milestone}. sat! ${client.name}`, celebrate: true } : null;
}

// The main action (check in) goes at the right of the row; the rest sit in a line below.
function actionButtons(booking, session, now) {
  const buttons = [];
  let primary = null;
  const ended = now.getTime() >= endOf(session);

  if (!ended && booking.status === 'booked') {
    if (checkInOpen(session, now)) {
      primary = el('button', 'Dolazak', 'btn');
      primary.addEventListener('click', () => act(() => checkIn(store, booking.id, new Date()), () => milestoneOf(booking) ?? `${riderOf(booking)}, bicikl ${booking.bikeNo}: došao`));
    }
    if (now.getTime() >= Date.parse(session.startsAt)) {
      const button = el('button', 'No-show', 'g-text destructive');
      button.addEventListener('click', () => act(() => markNoShow(store, booking.id), `${riderOf(booking)}, bicikl ${booking.bikeNo}: no-show`));
      buttons.push(button);
    }
  }

  if (ended) {
    for (const [status, label] of [['attended', 'Označi dolazak'], ['no_show', 'Označi no-show']]) {
      if (booking.status === status) continue;
      const button = el('button', label, status === 'no_show' ? 'g-text destructive' : 'g-text accent');
      button.addEventListener('click', () => act(() => correctStatus(store, booking.id, status, new Date()), `${riderOf(booking)}, bicikl ${booking.bikeNo}: ${STATUS_TEXT[status].toLowerCase()}`));
      buttons.push(button);
    }
  }
  return { primary, buttons };
}

// Active bookings only: a cancelled bike is free again on the map.
const ON_MAP = ['booked', 'attended', 'no_show'];

// The room as in the booking sheet, with the rider's first name on each bike. Tap a bike for its actions.
function renderMap(session, now) {
  const wrap = el('section', undefined, 'group');
  wrap.setAttribute('aria-label', 'Karta bicikala');
  const bookings = store.bookings.filter((b) => b.classId === session.id && ON_MAP.includes(b.status));
  const grid = el('div', undefined, 'bike-grid r-map');
  for (let bikeNo = 1; bikeNo <= session.bikeCount; bikeNo += 1) {
    const booking = bookings.find((b) => b.bikeNo === bikeNo);
    const button = el('button', undefined, `bike${booking ? ` map-${booking.status}` : ''}${booking && booking.id === selectedId ? ' sel' : ''}`);
    button.type = 'button';
    button.append(el('b', String(bikeNo)), el('span', booking ? riderOf(booking).split(' ')[0] : ''));
    const { column, row } = bikePosition(bikeNo);
    button.style.gridArea = `${row} / ${column}`;
    if (booking) {
      button.setAttribute('aria-label', `Bicikl ${bikeNo}, ${riderOf(booking)}, ${STATUS_TEXT[booking.status].toLowerCase()}`);
      button.addEventListener('click', () => {
        selectedId = booking.id === selectedId ? null : booking.id;
        render();
      });
    } else button.disabled = true;
    grid.append(button);
  }
  const picked = bookings.find((b) => b.id === selectedId);
  const bar = el('div', undefined, 'g-row r-pick');
  if (!picked) bar.append(el('span', 'Dodirni bicikl za dolazak ili no-show.', 'g-sub'));
  else {
    const { primary, buttons } = actionButtons(picked, session, now);
    const who = el('div', undefined, 'g-main');
    who.append(el('div', riderOf(picked), 'g-title'), el('div', `Bicikl ${picked.bikeNo} · ${STATUS_TEXT[picked.status]}`, 'g-sub'));
    bar.append(who);
    if (primary) bar.append(primary);
    for (const button of buttons) bar.append(button);
  }
  wrap.append(grid, bar);
  return wrap;
}

function renderBookings(session, now) {
  if (view === 'map') return renderMap(session, now);
  const list = el('section', undefined, 'group');
  list.setAttribute('aria-label', 'Rezervacije');
  const classId = session.id;

  const all = store.bookings.filter((b) => b.classId === classId);
  const rows = all.sort((a, b) => a.bikeNo - b.bikeNo);

  if (rows.length === 0) {
    list.append(row(el('span', 'Još nema rezervacija za ovaj trening.', 'g-sub')));
    return list;
  }

  for (const booking of rows) {
    const account = store.accounts.find((a) => a.id === booking.accountId);
    const item = el('div', undefined, `g-row r-row row-${booking.status}`);
    item.dataset.booking = booking.id;
    item.dataset.status = booking.status;
    const who = el('div', undefined, 'g-main');
    who.append(el('div', account?.name ?? '', 'g-title'));
    if (booking.guestName) who.append(el('div', `Gost: ${booking.guestName}`, 'g-sub'));
    item.append(el('div', String(booking.bikeNo), 'bike-badge'), who);
    const { primary, buttons } = actionButtons(booking, session, now);
    // "Rezervirano" is the default, so it is not repeated on every row.
    if (primary) item.append(primary);
    else if (booking.status !== 'booked') item.append(el('span', STATUS_TEXT[booking.status], `pill pill-${booking.status}`));
    if (buttons.length) {
      // The secondary actions (No-show, corrections) stay folded behind a menu button.
      const actions = el('div', undefined, 'r-actions');
      actions.hidden = true;
      actions.append(...buttons);
      const more = el('button', '⋯', 'r-more');
      more.type = 'button';
      more.setAttribute('aria-label', `Više za bicikl ${booking.bikeNo}`);
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        actions.hidden = !actions.hidden;
        more.setAttribute('aria-expanded', String(!actions.hidden));
      });
      item.append(more, actions);
    }
    list.append(item);
  }
  return list;
}

// Ended class with people still marked "booked": offer to close it.
function closeButton(session, now) {
  if (now.getTime() < endOf(session) || !store.bookings.some((b) => b.classId === session.id && b.status === 'booked')) return null;
  const button = el('button', 'Zatvori trening', 'g-row g-action destructive');
  button.type = 'button';
  button.addEventListener('click', () => {
    if (!window.confirm('Zatvoriti trening? Svi koji nisu došli bit će označeni kao no-show.')) return;
    act(() => closeClass(store, session.id, new Date()), 'Trening zatvoren');
  });
  const wrap = el('div', undefined, 'group');
  wrap.append(button);
  return wrap;
}

let summaryObserver = null;
const scrolledPast = new Map();

export function render() {
  const now = new Date();
  renderDayPicker(now);
  summaryObserver?.disconnect();
  scrolledPast.clear();
  const sessions = store.classes
    .filter((c) => studioTime.localDate(c.startsAt) === day)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const sections = sessions.map((session) => {
    const card = renderSummary(session, now);
    summaryObserver.observe(card);
    const section = el('section', undefined, 'r-class');
    section.append(card, ...[closeButton(session, now), renderBookings(session, now)].filter(Boolean));
    return section;
  });
  $('classes').replaceChildren(...sections);
  for (const [id, mode] of [['view-list', 'list'], ['view-map', 'map']]) $(id).setAttribute('aria-pressed', String(view === mode));
}

// Called by a report that links to a class; the tab renders it when shown.
export function openClass(id) {
  day = studioTime.localDate(store.classes.find((c) => c.id === id).startsAt);
  hideUndo(false);
}

$('day').addEventListener('change', (event) => {
  day = event.target.value;
  selectedId = null;
  hideUndo(false);
  showMessage('');
  render();
  fadeIn($('classes'), 6);
});

for (const [id, mode] of [['view-list', 'list'], ['view-map', 'map']]) {
  $(id).addEventListener('click', () => {
    if (view === mode) return;
    view = mode;
    sessionStorage.setItem('tockica-reception-view', mode);
    selectedId = null;
    render();
    fadeIn($('classes'), 6);
  });
}

// Once a class card has scrolled away, a compact bar keeps the latest such class and its counts in view.
function updateCompact() {
  const past = [...scrolledPast.keys()].filter((card) => scrolledPast.get(card)).pop();
  $('compact').classList.toggle('show', Boolean(past));
  if (past) {
    $('compact-title').textContent = past.dataset.title;
    $('compact-counts').textContent = past.dataset.counts;
  }
}
summaryObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) scrolledPast.set(entry.target, !entry.isIntersecting && entry.boundingClientRect.bottom < 0);
  updateCompact();
});

render();
