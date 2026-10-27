import { studioTime } from '../time.js';
import { isBookable } from '../schedule.js';
import { balance, NoCreditError } from '../ledger.js';
import {
  bookBike,
  takenBikes,
  cancelBooking,
  joinWaitlist,
  BikeTakenError,
  NotBookableError,
} from '../booking.js';
import { loadStore, saveStore, mondayOf } from './session.js';

const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const BIKE_COUNT = 20;
const WEEKS_SHOWN = 3;

const ERROR_TEXT = {
  BikeTakenError: 'Bicikl je upravo zauzet.',
  NoCreditError: 'Nemaš kredita. Kupi paket.',
  NotBookableError: 'Ovaj trening još nije otvoren za rezervacije.',
  NotFullError: 'Ima slobodnih bajkova, rezerviraj jedan.',
  AlreadyBookedError: 'Već imaš bajk na ovom treningu.',
};

const timeFormat = new Intl.DateTimeFormat('hr-HR', {
  timeZone: 'Europe/Zagreb',
  hour: '2-digit',
  minute: '2-digit',
});

const now = new Date();
const store = loadStore();
saveStore(store);
let openClassId = null;

const thisMonday = mondayOf(now);

// Open on the first day with a class from today on, so the page is never empty.
const today = studioTime.localDate(now.toISOString());
let selectedDay = store.classes
  .map((c) => studioTime.localDate(c.startsAt))
  .sort()
  .find((day) => day >= today) ?? today;
let weekOffset = Math.floor(
  (Date.parse(`${selectedDay}T00:00:00Z`) - Date.parse(`${thisMonday}T00:00:00Z`)) / (7 * 24 * 60 * 60 * 1000),
);

const $ = (id) => document.getElementById(id);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showMessage(text, isError = false) {
  const node = $('message');
  node.textContent = text;
  node.classList.toggle('error', isError);
}

function renderAccount() {
  const select = $('account');
  if (select.options.length === 0) {
    for (const account of store.accounts) {
      const option = el('option', account.name);
      option.value = account.id;
      select.append(option);
    }
    select.addEventListener('change', () => {
      openClassId = null;
      render();
    });
  }
  $('balance').textContent = `Kredit: ${balance(store, select.value, new Date())}`;
}

function renderWeek() {
  const nav = $('week');
  nav.replaceChildren();

  const monday = studioTime.addDays(thisMonday, 7 * weekOffset);
  const prev = el('button', '‹', 'nav-week');
  prev.disabled = weekOffset === 0;
  prev.addEventListener('click', () => {
    weekOffset -= 1;
    selectedDay = studioTime.addDays(monday, -7);
    render();
  });
  nav.append(prev);

  for (let i = 0; i < 7; i += 1) {
    const day = studioTime.addDays(monday, i);
    const button = el('button', undefined, 'day');
    button.setAttribute('aria-pressed', String(day === selectedDay));
    button.append(el('small', DAY_NAMES[i]), el('strong', day.slice(8)));
    button.addEventListener('click', () => {
      selectedDay = day;
      openClassId = null;
      render();
    });
    nav.append(button);
  }

  const next = el('button', '›', 'nav-week');
  next.disabled = weekOffset === WEEKS_SHOWN - 1;
  next.addEventListener('click', () => {
    weekOffset += 1;
    selectedDay = studioTime.addDays(monday, 7);
    render();
  });
  nav.append(next);
}

function instructorName(id) {
  return store.instructors.find((i) => i.id === id)?.name ?? '';
}

function statusButton(session, current) {
  const startsAt = Date.parse(session.startsAt);
  if (current.getTime() >= startsAt) return el('button', 'prošlo', 'btn');
  if (!isBookable(session, current)) return el('button', 'uskoro', 'btn');
  if (takenBikes(store, session.id).length >= BIKE_COUNT) {
    const waitlist = el('button', 'lista čekanja', 'btn');
    waitlist.addEventListener('click', () => joinList(session.id));
    return waitlist;
  }
  const button = el('button', 'rezerviraj', 'btn');
  button.addEventListener('click', () => {
    openClassId = session.id;
    render();
  });
  return button;
}

function renderClasses() {
  const list = $('classes');
  list.replaceChildren();
  const current = new Date();
  const sessions = store.classes
    .filter((c) => studioTime.localDate(c.startsAt) === selectedDay)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  if (sessions.length === 0) {
    list.append(el('p', 'Za ovaj dan nema treninga.', 'meta'));
    return;
  }

  for (const session of sessions) {
    const card = el('article', undefined, 'card');
    const info = el('div');
    info.append(
      el('div', timeFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', [instructorName(session.instructorId), session.themeName].filter(Boolean).join(' · '), 'meta'),
    );
    card.append(info, statusButton(session, current));
    const mine = store.bookings.find(
      (b) => b.classId === session.id && b.accountId === $('account').value && b.status === 'booked',
    );
    if (mine && current.getTime() < Date.parse(session.startsAt)) {
      const cancel = el('button', 'otkaži', 'btn secondary');
      cancel.addEventListener('click', () => cancelMine(mine.id));
      info.append(cancel);
    }
    list.append(card);
  }
}

function renderBikes() {
  const panel = $('bikes');
  if (!openClassId) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }

  const session = store.classes.find((c) => c.id === openClassId);
  const taken = takenBikes(store, openClassId);
  panel.hidden = false;
  panel.replaceChildren();

  panel.append(
    el('h2', `Odaberi bicikl: ${session.name}`),
    el('p', `${instructorName(session.instructorId)} · ${timeFormat.format(new Date(session.startsAt))}`, 'sub'),
  );

  const grid = el('div', undefined, 'bike-grid');
  for (let bikeNo = 1; bikeNo <= BIKE_COUNT; bikeNo += 1) {
    const button = el('button', String(bikeNo), 'bike');
    button.disabled = taken.includes(bikeNo);
    button.addEventListener('click', () => reserve(bikeNo));
    grid.append(button);
  }
  panel.append(grid);
}

function mailCount() {
  return store.outbox.length ? ` Poslano mailova: ${store.outbox.length}.` : '';
}

function joinList(classId) {
  try {
    joinWaitlist(store, { classId, accountId: $('account').value, now: new Date() });
    showMessage(`Na listi čekanja. Dobit ćeš mail kad se mjesto oslobodi.${mailCount()}`);
  } catch (err) {
    showMessage(ERROR_TEXT[err.name] ?? 'Nešto je pošlo krivo.', true);
    if (err.name !== 'NotFullError' && err.name !== 'AlreadyBookedError') throw err;
  }
  render();
}

function cancelMine(bookingId) {
  const current = new Date();
  const booking = cancelBooking(store, bookingId, current);
  const session = store.classes.find((c) => c.id === booking.classId);
  const cutoffPassed = booking.status === 'late_cancel';
  showMessage(
    cutoffPassed
      ? `Kasno otkazivanje: kredit se ne vraća.${mailCount()}`
      : `Otkazano. Kredit je vraćen.${mailCount()}`,
    false,
  );
  if (session) openClassId = null;
  render();
}

function reserve(bikeNo) {
  try {
    bookBike(store, {
      classId: openClassId,
      bikeNo,
      accountId: $('account').value,
      now: new Date(),
    });
    showMessage(`Rezervirano: bicikl ${bikeNo}.`);
    openClassId = null;
  } catch (err) {
    showMessage(ERROR_TEXT[err.name] ?? 'Nešto je pošlo krivo.', true);
    if (!(err instanceof BikeTakenError || err instanceof NoCreditError || err instanceof NotBookableError)) {
      throw err;
    }
  }
  render();
}

function render() {
  saveStore(store);
  renderAccount();
  renderWeek();
  renderClasses();
  renderBikes();
}

render();
