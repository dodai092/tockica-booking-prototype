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

const $ = (id) => document.getElementById(id);
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
  if (!classId) {
    classId = (sorted.find((c) => endOf(c) > now.getTime()) ?? sorted[0]).id;
  }
  select.replaceChildren();
  for (const session of sorted) {
    const option = el('option', `${dayFormat.format(new Date(session.startsAt))} ${timeFormat.format(new Date(session.startsAt))} · ${session.name}`);
    option.value = session.id;
    option.selected = session.id === classId;
    select.append(option);
  }
}

function renderState(session, now) {
  const start = Date.parse(session.startsAt);
  let text;
  if (now.getTime() >= endOf(session)) text = 'Trening je završio.';
  else if (checkInOpen(session, now)) text = 'Check-in je otvoren.';
  else text = `Check-in se otvara u ${timeFormat.format(new Date(start - 30 * CLASS_MIN_MS))}.`;
  $('state').textContent = text;
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
    list.append(el('p', 'Nema rezervacija za ovaj trening.', 'meta'));
    return;
  }

  for (const booking of rows) {
    const account = store.accounts.find((a) => a.id === booking.accountId);
    const row = el('article', undefined, 'card');
    const info = el('div');
    info.append(
      el('div', `Bicikl ${booking.bikeNo}`, 'name'),
      el('div', [account?.name, booking.guestName].filter(Boolean).join(' · '), 'meta'),
      el('div', STATUS_TEXT[booking.status], 'time'),
    );
    const buttons = el('div', undefined, 'actions');
    buttons.append(...actionButtons(booking, session, now));
    row.append(info, buttons);
    list.append(row);
  }
}

function render() {
  const now = new Date();
  renderClassPicker(now);
  const session = store.classes.find((c) => c.id === classId);
  renderState(session, now);
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
