import { studioTime } from '../time.js';
import { checkIn, checkInOpen, closeClass, correctStatus } from '../checkin.js';
import { markNoShow } from '../booking.js';
import { taughtBy } from '../payroll.js';
import { clientRides } from '../analytics.js';
import { loadStore, saveStore } from './session.js';
import { fadeIn, fadeOut, pop, showBanner, reveal, resize, expand, collapse, release, haptic } from './motion.js';

const STATUS_TEXT = {
  booked: 'Rezervirano',
  attended: 'Došao',
  no_show: 'No-show',
  cancelled: 'Otkazano',
  late_cancel: 'Kasno otkazano',
};
const CLASS_MIN_MS = 60 * 1000;

const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('hr-HR', {
  timeZone: 'Europe/Zagreb',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

const $ = (id) => document.getElementById('r-' + id);
const store = loadStore();
saveStore(store);
let classId = null;

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
  const heights = new Map([...$('bookings').querySelectorAll('[data-booking]')].map((row) => [row.dataset.booking, row.getBoundingClientRect().height]));
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
  for (const row of $('bookings').querySelectorAll('[data-booking]')) {
    // A row that gained or lost action buttons glides to its new height.
    if (heights.has(row.dataset.booking)) resize(row, heights.get(row.dataset.booking));
    if (before.get(row.dataset.booking) !== row.dataset.status) {
      pop(row.querySelector('.pill'), 0.8);
      changed = true;
    }
  }
  if (changed) for (const count of $('summary').querySelectorAll('.s-counts strong')) pop(count, 0.85);
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

function renderClassPicker(now) {
  const select = $('class');
  const sorted = [...store.classes].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const upcoming = sorted.filter((c) => endOf(c) > now.getTime());
  const past = sorted.filter((c) => endOf(c) <= now.getTime()).reverse();
  if (!classId) classId = (upcoming[0] ?? sorted[0]).id;

  select.replaceChildren();
  for (const [label, group] of [['Nadolazeći treninzi', upcoming], ['Prošli treninzi', past]]) {
    if (group.length === 0) continue;
    const optgroup = el('optgroup');
    optgroup.label = label;
    for (const session of group) {
      const option = el('option', `${dayFormat.format(new Date(session.startsAt))} ${timeFormat.format(new Date(session.startsAt))} · ${session.name}${session.cancelled ? ' (otkazano)' : ''}`);
      option.value = session.id;
      option.selected = session.id === classId;
      optgroup.append(option);
    }
    select.append(optgroup);
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
  $('summary').replaceChildren(info, side);
  $('compact-title').textContent = `${timeFormat.format(new Date(start))} ${session.name}`;
  $('compact-counts').textContent = `${reserved}/${session.bikeCount} · ${attended} došlo`;
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

// Lower case, no accents, so "zeljko" finds "Željko".
const plain = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function matches(booking, query) {
  const account = store.accounts.find((a) => a.id === booking.accountId);
  return String(booking.bikeNo) === query || plain(`${account?.name ?? ''} ${booking.guestName ?? ''}`).includes(query);
}

function renderBookings(now) {
  const session = store.classes.find((c) => c.id === classId);
  const list = $('bookings');
  list.replaceChildren();
  reveal($('close-wrap'), now.getTime() >= endOf(session) && store.bookings.some((b) => b.classId === classId && b.status === 'booked'), undefined, expand, collapse);

  const all = store.bookings.filter((b) => b.classId === classId);
  const query = plain($('search').value.trim());
  const rows = all
    .filter((b) => !query || matches(b, query))
    .sort((a, b) => a.bikeNo - b.bikeNo);

  if (rows.length === 0) {
    list.append(row(el('span', all.length ? 'Nema rezultata.' : 'Još nema rezervacija za ovaj trening.', 'g-sub')));
    return;
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
      const actions = el('div', undefined, 'r-actions');
      actions.append(...buttons);
      item.append(actions);
    }
    list.append(item);
  }
}

export function render() {
  const now = new Date();
  renderClassPicker(now);
  const session = store.classes.find((c) => c.id === classId);
  renderSummary(session, now);
  renderBookings(now);
}

// Called by a report that links to a class; the tab renders it when shown.
export function openClass(id) {
  classId = id;
  $('search').value = '';
  hideUndo(false);
}

$('class').addEventListener('change', (event) => {
  classId = event.target.value;
  $('search').value = '';
  hideUndo(false);
  showMessage('');
  render();
  fadeIn($('summary'), 6);
  fadeIn($('bookings'), 6);
});

$('close').addEventListener('click', () => {
  if (!window.confirm('Zatvoriti trening? Svi koji nisu došli bit će označeni kao no-show.')) return;
  act(() => closeClass(store, classId, new Date()), 'Trening zatvoren');
});

$('search').addEventListener('input', () => renderBookings(new Date()));

// Once the summary card has scrolled away, a compact bar keeps the class and the counts in view.
new IntersectionObserver(([entry]) => {
  $('compact').classList.toggle('show', !entry.isIntersecting && entry.boundingClientRect.bottom < 0);
}).observe($('summary'));

render();
