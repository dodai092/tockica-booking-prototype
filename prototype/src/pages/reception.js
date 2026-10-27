import { studioTime } from '../time.js';
import { checkIn, checkInOpen, closeClass, correctStatus } from '../checkin.js';
import { markNoShow } from '../booking.js';
import { loadStore, saveStore } from './session.js';

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
  const node = $('message');
  node.textContent = text;
  node.classList.toggle('error', isError);
}

// Runs an action, saves, and re-renders. Errors show as a message.
function act(action) {
  try {
    action();
    showMessage('Spremljeno.');
  } catch (err) {
    showMessage(err.message, true);
  }
  saveStore(store);
  render();
}

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
      const option = el('option', `${dayFormat.format(new Date(session.startsAt))} ${timeFormat.format(new Date(session.startsAt))} · ${session.name}`);
      option.value = session.id;
      option.selected = session.id === classId;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
}

function renderSummary(session, now) {
  const start = Date.parse(session.startsAt);
  const instructor = store.instructors.find((i) => i.id === session.instructorId)?.name ?? '';
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
}

function actionButtons(booking, session, now) {
  const buttons = [];
  const ended = now.getTime() >= endOf(session);

  if (!ended && booking.status === 'booked') {
    if (checkInOpen(session, now)) {
      const button = el('button', 'Dolazak', 'btn');
      button.addEventListener('click', () => act(() => checkIn(store, booking.id, new Date())));
      buttons.push(button);
    }
    if (now.getTime() >= Date.parse(session.startsAt)) {
      const button = el('button', 'No-show', 'btn secondary');
      button.addEventListener('click', () => act(() => markNoShow(store, booking.id)));
      buttons.push(button);
    }
  }

  if (ended) {
    for (const [status, label] of [['attended', 'Označi dolazak'], ['no_show', 'Označi no-show']]) {
      if (booking.status === status) continue;
      const button = el('button', label, 'btn secondary');
      button.addEventListener('click', () => act(() => correctStatus(store, booking.id, status, new Date())));
      buttons.push(button);
    }
  }
  return buttons;
}

function renderBookings(now) {
  const session = store.classes.find((c) => c.id === classId);
  const list = $('bookings');
  list.replaceChildren();
  $('close').hidden = !(now.getTime() >= endOf(session) && store.bookings.some((b) => b.classId === classId && b.status === 'booked'));

  const rows = store.bookings
    .filter((b) => b.classId === classId)
    .sort((a, b) => a.bikeNo - b.bikeNo);

  if (rows.length === 0) {
    list.append(el('p', 'Još nema rezervacija za ovaj trening.', 'empty'));
    return;
  }

  for (const booking of rows) {
    const account = store.accounts.find((a) => a.id === booking.accountId);
    const row = el('article', undefined, `row row-${booking.status}`);
    const who = el('div', undefined, 'who');
    who.append(el('div', account?.name ?? '', 'name'));
    if (booking.guestName) who.append(el('div', `Gost: ${booking.guestName}`, 'meta'));
    const buttons = el('div', undefined, 'actions');
    buttons.append(el('span', STATUS_TEXT[booking.status], `pill pill-${booking.status}`), ...actionButtons(booking, session, now));
    row.append(el('div', String(booking.bikeNo), 'bike-badge'), who, buttons);
    list.append(row);
  }
}

export function render() {
  const now = new Date();
  renderClassPicker(now);
  const session = store.classes.find((c) => c.id === classId);
  renderSummary(session, now);
  renderBookings(now);
}

$('class').addEventListener('change', (event) => {
  classId = event.target.value;
  showMessage('');
  render();
});

$('close').addEventListener('click', () => {
  act(() => closeClass(store, classId, new Date()));
});

render();
