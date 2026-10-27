import { studioTime } from '../time.js';
import { isBookable } from '../schedule.js';
import { balance, nextExpiry, NoCreditError } from '../ledger.js';
import { purchasePack, canPurchase } from '../purchase.js';
import { priceFor } from '../admin.js';
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
import { fadeIn, slideIn, pop, popOut, expand, collapse, reveal, showBanner } from './motion.js';
import { openSheet, closeSheet, bindSheet } from './sheet.js';

const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const BIKE_COUNT = 20;
const WEEKS_SHOWN = 3;

const ERROR_TEXT = {
  BikeTakenError: 'Bicikl je upravo zauzet.',
  NoCreditError: 'Nemaš kredita. Kupi paket.',
  NotBookableError: 'Ovaj trening još nije otvoren za rezervacije.',
  NotFullError: 'Ima slobodnih bicikala, rezerviraj jedan.',
  AlreadyBookedError: 'Već imaš bicikl na ovom treningu.',
};

const timeFormat = new Intl.DateTimeFormat('hr-HR', {
  timeZone: 'Europe/Zagreb',
  hour: '2-digit',
  minute: '2-digit',
});

const dayMonthFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', day: 'numeric', month: 'numeric' });

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

const $ = (id) => document.getElementById('s-' + id);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showMessage(text, isError = false, node = $('message')) {
  showBanner(node, text, isError);
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
      fadeIn($('classes'), 6);
      fadeIn($('mine'), 6);
    });
  }
  const text = `Kredit: ${balance(store, select.value, new Date())}`;
  if ($('balance').textContent && $('balance').textContent !== text) pop($('balance'), 0.85);
  $('balance').textContent = text;
  const expiry = nextExpiry(store, select.value, new Date());
  $('expiry').textContent = expiry ? `ističe ${dayMonthFormat.format(new Date(expiry))}` : '';
}

// Moves to another day or week, sliding the list from the side the new day sits on.
function move(change) {
  const dayBefore = selectedDay;
  const weekBefore = weekOffset;
  change();
  openClassId = null;
  render();
  if (selectedDay === dayBefore) return;
  const direction = selectedDay > dayBefore ? 1 : -1;
  slideIn($('classes'), direction);
  if (weekOffset !== weekBefore) slideIn($('week'), direction);
  pop($('week').querySelector('.day[aria-pressed="true"]'), 0.92);
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
  prev.addEventListener('click', () => move(() => {
    weekOffset -= 1;
    selectedDay = studioTime.addDays(monday, -7);
  }));
  nav.append(prev);

  for (let i = 0; i < 7; i += 1) {
    const day = studioTime.addDays(monday, i);
    const button = el('button', undefined, 'day');
    button.setAttribute('aria-pressed', String(day === selectedDay));
    const dot = el('span', undefined, myDays.has(day) ? 'dot mine-dot' : classDays.has(day) ? 'dot' : 'dot none');
    button.append(el('small', DAY_NAMES[i]), el('strong', day.slice(8)), dot);
    if (myDays.has(day)) button.setAttribute('aria-label', `${DAY_NAMES[i]} ${day.slice(8)}, imaš rezervaciju`);
    button.addEventListener('click', () => move(() => {
      selectedDay = day;
    }));
    nav.append(button);
  }

  const next = el('button', '›', 'nav-week');
  next.disabled = weekOffset === WEEKS_SHOWN - 1;
  next.addEventListener('click', () => move(() => {
    weekOffset += 1;
    selectedDay = studioTime.addDays(monday, 7);
  }));
  nav.append(next);
}

function instructorName(id) {
  return store.instructors.find((i) => i.id === id)?.name ?? '';
}

function statusButton(session, current, hasBike) {
  const startsAt = Date.parse(session.startsAt);
  if (session.cancelled) {
    const cancelled = el('button', 'otkazano', 'btn');
    cancelled.disabled = true;
    return cancelled;
  }
  if (current.getTime() >= startsAt) {
    const past = el('button', 'završeno', 'btn');
    past.disabled = true;
    return past;
  }
  if (!isBookable(session, current)) {
    const soon = el('button', 'uskoro', 'btn');
    soon.disabled = true;
    return soon;
  }
  if (takenBikes(store, session.id).length >= BIKE_COUNT) {
    const waitlist = el('button', 'lista čekanja', 'btn');
    waitlist.addEventListener('click', () => joinList(session.id));
    return waitlist;
  }
  const button = el('button', hasBike ? 'dodaj bicikl' : 'rezerviraj', 'btn');
  button.addEventListener('click', () => openBooking(session));
  return button;
}

function openBooking(session) {
  openClassId = session.id;
  pickedBike = null;
  guestName = '';
  $('book-title').textContent = session.name;
  $('book-sub').textContent = [whenFormat.format(new Date(session.startsAt)), instructorName(session.instructorId)].filter(Boolean).join(' · ');
  showMessage('', false, $('book-message'));
  renderBikes();
  openSheet($('book-sheet'));
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
    card.dataset.classId = session.id;
    const info = el('div');
    info.append(
      el('div', timeFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', [instructorName(session.instructorId), session.themeName].filter(Boolean).join(' · '), 'meta'),
    );
    const mine = store.bookings
      .filter((b) => b.classId === session.id && b.accountId === $('account').value && b.status === 'booked')
      .sort((a, b) => a.bikeNo - b.bikeNo);
    if (session.cancelled) {
      info.append(el('div', 'Trening je otkazan', 'meta few'));
    } else if (current.getTime() < Date.parse(session.releaseOpensAt)) {
      info.append(el('div', `Otvara se ${whenFormat.format(new Date(session.releaseOpensAt))}`, 'meta'));
    } else if (current.getTime() < Date.parse(session.startsAt) && isBookable(session, current)) {
      const free = BIKE_COUNT - takenBikes(store, session.id).length;
      const text = free === 0 ? 'Popunjeno' : free <= 3 ? `Posljednja mjesta: ${free}` : `Slobodnih bicikala: ${free}`;
      info.append(el('div', text, free <= 3 ? 'meta few' : 'meta'));
    }
    card.append(info, statusButton(session, current, mine.length > 0));
    if (mine.length && current.getTime() < Date.parse(session.startsAt)) {
      const bikes = mine.map((b) => (b.guestName ? `${b.bikeNo} (${b.guestName})` : b.bikeNo)).join(', ');
      const block = el('div', undefined, 'mine-block');
      block.dataset.bookings = mine.map((b) => b.id).join(' ');
      block.append(el('div', `${mine.length > 1 ? 'Tvoji bicikli' : 'Tvoj bicikl'}: ${bikes}`, 'mine'));
      for (const booking of mine) {
        block.append(...cancelControl(booking, session, current, mine.length > 1 ? `otkaži bicikl ${booking.bikeNo}` : 'otkaži'));
      }
      block.append(el('div', cancelNote(session, current, true), 'meta'));
      info.append(block);
    }
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
    const cancel = el('button', label, 'btn secondary cancel cancel-ctl');
    cancel.addEventListener('click', () => toggleConfirm(booking.id));
    return [cancel];
  }
  const refund = current < cancelDeadline(session) ? 'Kredit se vraća.' : 'Kredit se ne vraća.';
  const yes = el('button', 'Da, otkaži', 'btn secondary cancel cancel-ctl');
  yes.addEventListener('click', () => cancelMine(booking.id));
  const no = el('button', 'Ne', 'btn secondary cancel cancel-ctl');
  no.addEventListener('click', () => toggleConfirm(null));
  return [el('div', `Otkazati bicikl ${booking.bikeNo}? ${refund}`, 'mine cancel-ctl'), yes, no];
}

function toggleConfirm(bookingId) {
  confirmingId = bookingId;
  render();
  for (const node of document.querySelectorAll('#panel-raspored .cancel-ctl')) fadeIn(node, 4, 180);
}

function renderMineCount() {
  const count = upcomingBookings(store, $('account').value, new Date()).length;
  reveal(document.getElementById('badge-raspored'), count > 0, String(count), (n) => pop(n, 0.6), popOut);
  reveal($('mine-link'), count > 0, `Moje rezervacije (${count})`, expand, collapse);
}

function renderMine() {
  const section = $('mine');
  renderMineCount();
  const hadCards = section.querySelector('.card') !== null;
  const ghost = section.querySelector('.empty');
  section.replaceChildren(el('h2', 'Moje rezervacije'));
  const current = new Date();
  const rows = upcomingBookings(store, $('account').value, current);
  if (rows.length === 0) {
    const empty = el('p', 'Nemaš nadolazećih rezervacija.', 'meta empty');
    section.append(empty);
    if (hadCards) expand(empty);
    return;
  }
  // The "no bookings" line folds away as the first booking opens in.
  if (ghost) {
    section.append(ghost);
    collapse(ghost).then(() => ghost.remove());
  }
  for (const { booking, session } of rows) {
    const card = el('article', undefined, 'card');
    card.dataset.booking = booking.id;
    const info = el('div');
    const guest = booking.guestName ? ` (${booking.guestName})` : '';
    info.append(
      el('div', whenFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', `Bicikl ${booking.bikeNo}${guest} · ${instructorName(session.instructorId)}`, 'meta'),
      el('div', cancelNote(session, current), 'meta'),
    );
    info.append(...cancelControl(booking, session, current, 'otkaži'));
    card.append(info);
    section.append(card);
  }
}

function renderBikes() {
  if (!openClassId) return;
  const panel = $('bikes');
  const taken = takenBikes(store, openClassId);
  panel.replaceChildren();

  panel.append(el('div', 'Instruktor', 'stage'));
  const grid = el('div', undefined, 'bike-grid');
  for (let bikeNo = 1; bikeNo <= BIKE_COUNT; bikeNo += 1) {
    const button = el('button', String(bikeNo), 'bike');
    button.disabled = taken.includes(bikeNo);
    button.setAttribute('aria-pressed', String(bikeNo === pickedBike));
    button.addEventListener('click', () => {
      const first = pickedBike === null;
      pickedBike = bikeNo;
      renderBikes();
      pop($('bikes').querySelector('.bike[aria-pressed="true"]'), 0.85);
      if (first) fadeIn($('book-bar'), 6, 200);
    });
    grid.append(button);
    // Two rows of 10 with a gap after bike 5 and bike 15.
    if (bikeNo % 10 === 5) grid.append(el('span', undefined, 'aisle'));
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

  const bar = $('book-bar');
  const book = el('button', pickedBike ? `Rezerviraj bicikl ${pickedBike}` : 'Rezerviraj bicikl', 'btn');
  book.disabled = !pickedBike;
  book.addEventListener('click', () => reserve(pickedBike));
  bar.replaceChildren(el('span', pickedBike ? 'Rezervacija košta 1 kredit.' : 'Odaberi slobodan bicikl. Rezervacija košta 1 kredit.', 'meta'), book);
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

// The cancel takes effect at once: banner, credit and counters change while the booking's card,
// and its line in the class card, fold away. The lists are re-rendered when the fold is done.
function cancelMine(bookingId) {
  const leaving = [
    document.querySelector(`#s-mine [data-booking="${bookingId}"]`),
    document.querySelector(`#s-classes .mine-block[data-bookings="${bookingId}"]`),
  ];
  const booking = cancelBooking(store, bookingId, new Date());
  showMessage(
    booking.status === 'late_cancel'
      ? `Kasno otkazivanje: kredit se ne vraća.${mailCount()}`
      : `Otkazano. Kredit je vraćen.${mailCount()}`,
    false,
  );
  saveStore(store);
  renderAccount();
  renderMineCount();
  Promise.all(leaving.map((node) => collapse(node))).then(() => {
    confirmingId = null;
    render();
  });
}

function reserve(bikeNo) {
  try {
    const booking = bookBike(store, {
      classId: openClassId,
      bikeNo,
      accountId: $('account').value,
      guestName: guestName.trim() || null,
      now: new Date(),
    });
    // Slide the sheet away, then banner, credit and the new booking all arrive together.
    closeSheet($('book-sheet')).then(() => {
      showMessage(`Rezervirano: bicikl ${bikeNo}. Kredit: ${balance(store, $('account').value, new Date())}.`);
      render();
      expand(document.querySelector(`#s-mine [data-booking="${booking.id}"]`));
      expand(document.querySelector(`#s-classes .mine-block[data-bookings~="${booking.id}"]`));
    });
  } catch (err) {
    showMessage(ERROR_TEXT[err.name] ?? 'Nešto je pošlo krivo.', true, $('book-message'));
    if (!(err instanceof BikeTakenError || err instanceof NoCreditError || err instanceof NotBookableError)) {
      throw err;
    }
    if (err instanceof BikeTakenError) pickedBike = null;
    renderBikes();
  }
}

export function render() {
  saveStore(store);
  renderAccount();
  renderWeek();
  renderClasses();
  renderBikes();
  renderMine();
}

function renderPacks() {
  const accountId = $('account').value;
  const tagged = store.accounts.find((a) => a.id === accountId).multisportTag;
  const list = $('packs');
  list.replaceChildren();
  for (const pack of store.packs) {
    const price = priceFor(store, accountId, pack.id);
    const sub = `Vrijedi ${pack.validDays} dana${tagged && price !== pack.priceEur ? ', Multisport cijena' : ''}`;
    const text = el('div', undefined, 'g-main');
    text.append(el('div', pack.name, 'g-title'), el('div', sub, 'g-sub'));
    const bought = !canPurchase(store, accountId, pack.id);
    const buy = el('button', bought ? 'kupljeno' : `${price} €`, 'btn');
    buy.disabled = bought;
    buy.addEventListener('click', () => buyPack(pack));
    const row = el('div', undefined, 'g-row');
    row.append(text, buy);
    list.append(row);
  }
}

function buyPack(pack) {
  purchasePack(store, $('account').value, pack.id, new Date());
  saveStore(store);
  closeSheet($('buy-sheet')).then(() => {
    showMessage(`Kupljeno: ${pack.name}. Kredit: ${balance(store, $('account').value, new Date())}.`);
    render();
  });
}

const buySheet = $('buy-sheet');
bindSheet(buySheet);
$('buy-close').addEventListener('click', () => closeSheet(buySheet));
$('buy').addEventListener('click', () => {
  renderPacks();
  openSheet(buySheet);
});

const bookSheet = $('book-sheet');
bindSheet(bookSheet);
$('book-close').addEventListener('click', () => closeSheet(bookSheet));
bookSheet.addEventListener('close', () => {
  openClassId = null;
  pickedBike = null;
  guestName = '';
});

$('mine-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('mine').scrollIntoView({ behavior: 'smooth' });
});

render();
