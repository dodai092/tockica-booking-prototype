import { studioTime } from '../time.js';
import { isBookable } from '../schedule.js';
import { balance, NoCreditError } from '../ledger.js';
import {
  bookBike,
  takenBikes,
  cancelBooking,
  cancelDeadline,
  upcomingBookings,
  joinWaitlist,
  BikeTakenError,
  NotBookableError,
} from '../booking.js';
import { loadStore, saveStore, mondayOf } from './session.js';

const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const BIKE_COUNT = 20;
const WEEKS_SHOWN = 3;

const ERROR_TEXT = {
  BikeTakenError: 'Bajk je upravo zauzet.',
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

const whenFormat = new Intl.DateTimeFormat('hr-HR', {
  timeZone: 'Europe/Zagreb',
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const now = new Date();
const store = loadStore();
saveStore(store);
let pickedBike = null;
let guestName = '';
let confirmingId = null;
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
  const classDays = new Set(store.classes.map((c) => studioTime.localDate(c.startsAt)));
  const myDays = new Set(
    upcomingBookings(store, $('account').value, new Date()).map(({ session }) => studioTime.localDate(session.startsAt)),
  );
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
    const dot = el('span', undefined, myDays.has(day) ? 'dot mine-dot' : classDays.has(day) ? 'dot' : 'dot none');
    button.append(el('small', DAY_NAMES[i]), el('strong', day.slice(8)), dot);
    if (myDays.has(day)) button.setAttribute('aria-label', `${DAY_NAMES[i]} ${day.slice(8)}, imaš rezervaciju`);
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

function statusButton(session, current, hasBike) {
  const startsAt = Date.parse(session.startsAt);
  if (current.getTime() >= startsAt) return el('button', 'prošlo', 'btn');
  if (!isBookable(session, current)) return el('button', 'uskoro', 'btn');
  if (takenBikes(store, session.id).length >= BIKE_COUNT) {
    const waitlist = el('button', 'lista čekanja', 'btn');
    waitlist.addEventListener('click', () => joinList(session.id));
    return waitlist;
  }
  const isOpen = openClassId === session.id;
  const button = el('button', isOpen ? 'zatvori' : hasBike ? 'dodaj bajk' : 'rezerviraj', isOpen ? 'btn secondary' : 'btn');
  button.addEventListener('click', () => {
    openClassId = isOpen ? null : session.id;
    pickedBike = null;
    guestName = '';
    render();
  });
  return button;
}

function renderClasses() {
  const list = $('classes');
  // Park the bike panel outside the list so replaceChildren does not detach it.
  list.after($('bikes'));
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
    const mine = store.bookings
      .filter((b) => b.classId === session.id && b.accountId === $('account').value && b.status === 'booked')
      .sort((a, b) => a.bikeNo - b.bikeNo);
    if (current.getTime() < Date.parse(session.startsAt) && isBookable(session, current)) {
      const free = BIKE_COUNT - takenBikes(store, session.id).length;
      const text = free === 0 ? 'Popunjeno' : free <= 3 ? `Posljednja mjesta: ${free}` : `Slobodnih bajkova: ${free}`;
      info.append(el('div', text, free <= 3 ? 'meta few' : 'meta'));
    }
    card.append(info, statusButton(session, current, mine.length > 0));
    if (mine.length && current.getTime() < Date.parse(session.startsAt)) {
      const bikes = mine.map((b) => (b.guestName ? `${b.bikeNo} (${b.guestName})` : b.bikeNo)).join(', ');
      info.append(el('div', `${mine.length > 1 ? 'Tvoji bajkovi' : 'Tvoj bajk'}: ${bikes}`, 'mine'));
      for (const booking of mine) {
        info.append(...cancelControl(booking, session, current, mine.length > 1 ? `otkaži bajk ${booking.bikeNo}` : 'otkaži'));
      }
      info.append(el('div', cancelNote(session, current, true), 'meta'));
    }
    if (openClassId) card.classList.toggle('dimmed', session.id !== openClassId);
    if (session.id === openClassId) card.append($('bikes'));
    list.append(card);
  }
}

function cancelNote(session, current, short = false) {
  const deadline = cancelDeadline(session);
  if (short) {
    return current < deadline
      ? `Besplatno otkazivanje do ${whenFormat.format(deadline)}`
      : 'Manje od 6 sati: kredit propada';
  }
  return current < deadline
    ? `Otkazivanje je besplatno do ${whenFormat.format(deadline)} (6 sati prije treninga). Nakon toga kredit propada.`
    : 'Manje od 6 sati do treninga: ako otkažeš, kredit propada.';
}

// One extra step so a stray tap does not cancel. The question says what happens to the credit.
function cancelControl(booking, session, current, label) {
  if (confirmingId !== booking.id) {
    const cancel = el('button', label, 'btn secondary cancel');
    cancel.addEventListener('click', () => {
      confirmingId = booking.id;
      render();
    });
    return [cancel];
  }
  const refund = current < cancelDeadline(session) ? 'Kredit se vraća.' : 'Kredit se ne vraća.';
  const yes = el('button', 'Da, otkaži', 'btn secondary cancel');
  yes.addEventListener('click', () => cancelMine(booking.id));
  const no = el('button', 'Ne', 'btn secondary cancel');
  no.addEventListener('click', () => {
    confirmingId = null;
    render();
  });
  return [el('div', `Otkazati bajk ${booking.bikeNo}? ${refund}`, 'mine'), yes, no];
}

function renderMine() {
  const section = $('mine');
  const count = upcomingBookings(store, $('account').value, new Date()).length;
  $('mine-link').hidden = count === 0;
  $('mine-link').textContent = `Moje rezervacije (${count})`;
  section.replaceChildren(el('h2', 'Moje rezervacije'));
  const current = new Date();
  const rows = upcomingBookings(store, $('account').value, current);
  if (rows.length === 0) {
    section.append(el('p', 'Nemaš nadolazećih rezervacija.', 'meta'));
    return;
  }
  for (const { booking, session } of rows) {
    const card = el('article', undefined, 'card');
    const info = el('div');
    const guest = booking.guestName ? ` (${booking.guestName})` : '';
    info.append(
      el('div', whenFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', `Bajk ${booking.bikeNo}${guest} · ${instructorName(session.instructorId)}`, 'meta'),
      el('div', cancelNote(session, current), 'meta'),
    );
    info.append(...cancelControl(booking, session, current, 'otkaži'));
    card.append(info);
    section.append(card);
  }
}

function renderBikes() {
  const panel = $('bikes');
  if (!openClassId) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }

  const taken = takenBikes(store, openClassId);
  panel.hidden = false;
  panel.replaceChildren();

  panel.append(el('h2', 'Odaberi bajk'));

  panel.append(el('div', 'Instruktor', 'stage'));
  const grid = el('div', undefined, 'bike-grid');
  for (let bikeNo = 1; bikeNo <= BIKE_COUNT; bikeNo += 1) {
    const button = el('button', String(bikeNo), 'bike');
    button.disabled = taken.includes(bikeNo);
    button.setAttribute('aria-pressed', String(bikeNo === pickedBike));
    button.addEventListener('click', () => {
      pickedBike = bikeNo;
      render();
    });
    grid.append(button);
  }
  panel.append(grid);

  const guest = el('label', 'Ime gosta (ako rezerviraš za nekoga drugog)', 'meta guest');
  const guestInput = el('input');
  guestInput.type = 'text';
  guestInput.value = guestName;
  guestInput.addEventListener('input', () => {
    guestName = guestInput.value;
  });
  guest.append(guestInput);
  panel.append(guest);

  const confirm = el('div', undefined, 'confirm');
  if (pickedBike) {
    const book = el('button', `Rezerviraj bajk ${pickedBike}`, 'btn');
    book.addEventListener('click', () => reserve(pickedBike));
    const cancel = el('button', 'Odustani', 'btn secondary');
    cancel.addEventListener('click', () => {
      openClassId = null;
      pickedBike = null;
      render();
    });
    confirm.append(el('span', 'Rezervacija košta 1 kredit.', 'meta'), book, cancel);
  } else {
    confirm.append(el('span', 'Odaberi slobodan bajk. Rezervacija košta 1 kredit.', 'meta'));
  }
  panel.append(confirm);
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
  confirmingId = null;
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
      guestName: guestName.trim() || null,
      now: new Date(),
    });
    showMessage(`Rezervirano: bajk ${bikeNo}. Kredit: ${balance(store, $('account').value, new Date())}.`);
    openClassId = null;
    pickedBike = null;
    guestName = '';
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
  renderMine();
}

render();
