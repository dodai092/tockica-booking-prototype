import { studioTime, hrDate } from '../time.js';
import { isBookable } from '../schedule.js';
import { taughtBy } from '../payroll.js';
import { bikePosition } from '../layout.js';
import { balance, nextExpiry, NoCreditError, creditsEnabled } from '../ledger.js';
import { creditLots } from '../dashboard.js';
import { purchasePack, canPurchase } from '../purchase.js';
import { priceFor } from '../admin.js';
import {
  bookBike,
  takenBikes,
  cancelBooking,
  cancelDeadline,
  upcomingBookings,
  joinWaitlist,
  leaveWaitlist,
  BikeTakenError,
  NotBookableError,
} from '../booking.js';
import { needsWaiver, signWaiver } from '../waiver.js';
import { loadStore, saveStore, mondayOf, getDemoAccount, setDemoAccount, isCustomer } from './session.js';
import { fadeIn, slideIn, pop, popOut, expand, collapse, release, reveal, showBanner, haptic } from './motion.js';
import { openSheet, closeSheet, bindSheet } from './sheet.js';

const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
const WEEKS_SHOWN = 3;
const LOW_CREDITS = 2;

const ERROR_TEXT = {
  BikeTakenError: 'Bicikl je upravo zauzet.',
  NoCreditError: 'Nemaš kredita. Kupi paket.',
  NotBookableError: 'Ovaj trening još nije otvoren za rezervacije.',
  NotFullError: 'Ima slobodnih bicikala, rezerviraj jedan.',
  AlreadyBookedError: 'Već imaš bicikl na ovom treningu.',
  WaiverRequiredError: 'Prije prve vožnje potpiši izjavu o odgovornosti.',
};

const timeFormat = new Intl.DateTimeFormat('hr-HR', {
  timeZone: 'Europe/Zagreb',
  hour: '2-digit',
  minute: '2-digit',
});

const dayMonthFormat = hrDate({ day: 'numeric', month: 'numeric' });

const whenFormat = hrDate({
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
let guestOpen = false;
let openClassId = null;
let endedOpen = false;

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
      setDemoAccount(select.value);
      openClassId = null;
      render();
      fadeIn($('classes'), 6);
      fadeIn($('mine'), 6);
    });
  }
  if (getDemoAccount() && select.value !== getDemoAccount()) select.value = getDemoAccount();
  // A customer is signed in as one account. Only staff choose whose bookings they work on.
  select.closest('label').hidden = isCustomer();
  const wrap = $('balance').closest('.balance-wrap');
  if (!creditsEnabled(store)) {
    // No credits (December): the balance gives way to a price list button.
    $('nocredit').hidden = true;
    wrap.hidden = false;
    wrap.classList.remove('few');
    $('balance').textContent = '';
    $('expiry').textContent = '';
    $('buy').textContent = 'Cjenik';
    return;
  }
  $('buy').textContent = 'Kupi paket';
  const credits = balance(store, select.value, new Date());
  // With no credits the balance card gives way to a banner with the buy button.
  $('nocredit').hidden = credits > 0;
  $('balance').closest('.balance-wrap').hidden = credits === 0;
  const text = `${credits} ${credits === 1 ? 'kredit' : 'kredita'}`;
  if ($('balance').textContent && $('balance').textContent !== text) pop($('balance'), 0.85);
  $('balance').textContent = text;
  const expiry = nextExpiry(store, select.value, new Date());
  $('expiry').textContent = expiry ? `ističe ${dayMonthFormat.format(new Date(expiry))}` : '';
  // Orange when the balance is low or a pack runs out within a week.
  const expiring = creditLots(store, select.value, new Date()).some((l) => l.expiringSoon);
  $('balance').closest('.balance-wrap').classList.toggle('few', credits <= LOW_CREDITS || expiring);
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
  const asDate = (ymd) => new Date(`${ymd}T12:00:00Z`);
  const prev = el('button', '‹', 'nav-week');
  prev.setAttribute('aria-label', 'Prethodni tjedan');
  prev.disabled = weekOffset === 0;
  prev.addEventListener('click', () => move(() => {
    weekOffset -= 1;
    selectedDay = studioTime.addDays(monday, -7);
  }));
  const next = el('button', '›', 'nav-week');
  next.setAttribute('aria-label', 'Sljedeći tjedan');
  next.disabled = weekOffset === WEEKS_SHOWN - 1;
  next.addEventListener('click', () => move(() => {
    weekOffset += 1;
    selectedDay = studioTime.addDays(monday, 7);
  }));
  const range = `${dayMonthFormat.format(asDate(monday))} do ${dayMonthFormat.format(asDate(studioTime.addDays(monday, 6)))}`;
  const head = el('div', undefined, 'week-head');
  head.append(prev, el('span', range, 'week-label'), next);
  nav.append(head);

  for (let i = 0; i < 7; i += 1) {
    const day = studioTime.addDays(monday, i);
    const isToday = day === today;
    const button = el('button', undefined, 'day');
    button.setAttribute('aria-pressed', String(day === selectedDay));
    const dot = el('span', undefined, myDays.has(day) ? 'dot mine-dot' : classDays.has(day) ? 'dot' : 'dot none');
    button.append(el('small', isToday ? 'Danas' : DAY_NAMES[i]), el('strong', day.slice(8)), dot);
    const notes = [isToday && 'danas', myDays.has(day) && 'imaš rezervaciju'].filter(Boolean);
    if (notes.length) button.setAttribute('aria-label', `${DAY_NAMES[i]} ${day.slice(8)}, ${notes.join(', ')}`);
    button.addEventListener('click', () => move(() => {
      selectedDay = day;
    }));
    nav.append(button);
  }
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
  if (takenBikes(store, session.id).length >= session.bikeCount) {
    if (store.waitlist.some((w) => w.classId === session.id && w.accountId === $('account').value)) {
      const waiting = el('button', 'na listi', 'btn secondary');
      waiting.disabled = true;
      waiting.dataset.waiting = 'yes';
      return waiting;
    }
    const waitlist = el('button', 'lista čekanja', 'btn');
    waitlist.addEventListener('click', () => joinList(session.id));
    return waitlist;
  }
  // Adding a bike is rare, so it is a quiet link inside the "your bike" block, not a second main button.
  const button = hasBike ? el('button', '+ dodaj bicikl', 'add-bike') : el('button', 'rezerviraj', 'btn');
  button.addEventListener('click', () => openBooking(session));
  return button;
}

function openBooking(session) {
  openClassId = session.id;
  pickedBike = null;
  guestName = '';
  guestOpen = false;
  $('book-title').textContent = session.name;
  $('book-sub').textContent = [whenFormat.format(new Date(session.startsAt)), instructorName(taughtBy(session))].filter(Boolean).join(' · ');
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

  const buildCard = (session) => {
    const card = el('article', undefined, 'card');
    card.dataset.classId = session.id;
    const info = el('div');
    info.append(
      el('div', timeFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', [instructorName(taughtBy(session)), session.themeName].filter(Boolean).join(' · '), 'meta'),
    );
    const mine = store.bookings
      .filter((b) => b.classId === session.id && b.accountId === $('account').value && b.status === 'booked')
      .sort((a, b) => a.bikeNo - b.bikeNo);
    if (session.cancelled) {
      info.append(el('div', 'Trening je otkazan', 'meta few'));
    } else if (current.getTime() < Date.parse(session.releaseOpensAt)) {
      info.append(el('div', `Otvara se ${whenFormat.format(new Date(session.releaseOpensAt))}`, 'meta'));
    } else if (current.getTime() < Date.parse(session.startsAt) && isBookable(session, current)) {
      const free = session.bikeCount - takenBikes(store, session.id).length;
      // The bar is the share of free bikes, so a long bar and a big number say the same thing.
      const capacity = el('div', undefined, free <= 3 ? 'cap few' : 'cap');
      const bar = el('span', undefined, 'bar');
      bar.setAttribute('aria-hidden', 'true');
      const fill = el('i');
      fill.style.width = `${(free / session.bikeCount) * 100}%`;
      bar.append(fill);
      capacity.append(bar, el('span', free === 0 ? 'Popunjeno' : `${free} slobodno`));
      info.append(capacity);
    }
    const action = statusButton(session, current, mine.length > 0);
    if (action.dataset.waiting) {
      const leave = el('button', 'napusti listu', 'link-btn');
      leave.addEventListener('click', () => leaveList(session.id));
      info.append(leave);
    }
    if (!action.classList.contains('add-bike')) card.append(info, action.textContent === 'rezerviraj' ? withCost(action) : action);
    else {
      // No button column, so the card is one column and the block reaches the right padding.
      card.classList.add('solo');
      card.append(info);
    }
    if (mine.length && current.getTime() < Date.parse(session.startsAt)) {
      const bikes = mine.map((b) => (b.guestName ? `${b.bikeNo} (${b.guestName})` : b.bikeNo)).join(', ');
      const block = el('div', undefined, 'mine-block');
      block.dataset.bookings = mine.map((b) => b.id).join(' ');
      block.append(el('div', `${mine.length > 1 ? 'Tvoji bicikli' : 'Tvoj bicikl'}: ${bikes}`, 'mine'));
      if (action.classList.contains('add-bike')) block.append(action);
      info.append(block);
    }
    return card;
  };

  // Classes that already started fold into one line, so what you can still book comes first.
  const started = (session) => Date.parse(session.startsAt) <= current.getTime();
  const upcoming = sessions.filter((s) => !started(s));
  const finished = sessions.filter(started);
  for (const session of upcoming) list.append(buildCard(session));
  if (finished.length) {
    const fold = el('details', undefined, 'ended');
    fold.open = endedOpen || upcoming.length === 0;
    fold.addEventListener('toggle', () => {
      if (upcoming.length) endedOpen = fold.open;
    });
    fold.append(el('summary', `${finished.length} ${finishedWord(finished.length)}`));
    for (const session of finished) fold.append(buildCard(session));
    list.append(fold);
  }
}

const finishedWord = (n) => (n === 1 ? 'završen trening' : n <= 4 ? 'završena treninga' : 'završenih treninga');

// A booking costs one credit. Saying so under the button helps a first-time customer.
function withCost(button) {
  const wrap = el('div', undefined, 'act');
  wrap.append(button);
  if (creditsEnabled(store)) wrap.append(el('span', '1 kredit', 'cost'));
  return wrap;
}

function cancelNote(session, current) {
  const deadline = cancelDeadline(session);
  return current < deadline
    ? `Besplatno otkazivanje do ${whenFormat.format(deadline)}`
    : creditsEnabled(store) ? 'Manje od 6 sati: kredit propada' : 'Manje od 6 sati: naplaćuje se trening';
}

// Cancelling asks first, in a small sheet that says what happens to the credit.
function cancelButton(booking, session, label) {
  const cancel = el('button', label, 'btn secondary cancel');
  cancel.addEventListener('click', () => askCancel(booking, session));
  return cancel;
}

let cancelling = null;
export function askCancel(booking, session) {
  const free = new Date() < cancelDeadline(session);
  const refund = creditsEnabled(store)
    ? (free ? 'Kredit se vraća.' : 'Kredit se ne vraća.')
    : (free ? 'Bez naplate.' : 'Naplaćuje se jedan trening.');
  cancelling = booking.id;
  $('cancel-title').textContent = `Otkazati bicikl ${booking.bikeNo}?`;
  $('cancel-text').textContent = `${session.name}, ${whenFormat.format(new Date(session.startsAt))}. ${refund}`;
  $('cancel-yes').textContent = `Otkaži bicikl ${booking.bikeNo}`;
  openSheet($('cancel-sheet'));
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
  section.append(el('p', 'Besplatno otkazivanje do 6 sati prije treninga.', 'meta'));
  // A customer sees the next booking here and the rest in Profil. Staff work on a picked account, so they see all.
  const shown = isCustomer() ? rows.slice(0, 1) : rows;
  // The "no bookings" line folds away as the first booking opens in.
  if (ghost) {
    section.append(ghost);
    collapse(ghost).then(() => ghost.remove());
  }
  for (const { booking, session } of shown) {
    const card = el('article', undefined, 'card');
    card.dataset.booking = booking.id;
    const info = el('div');
    const guest = booking.guestName ? ` (${booking.guestName})` : '';
    info.append(
      el('div', whenFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', `Bicikl ${booking.bikeNo}${guest} · ${instructorName(taughtBy(session))}`, 'meta'),
      el('div', cancelNote(session, current), 'meta'),
    );
    info.append(cancelButton(booking, session, 'otkaži'));
    card.append(info);
    section.append(card);
  }
  if (shown.length < rows.length) {
    const more = el('button', `Sve rezervacije (${rows.length}) u profilu`, 'g-text accent');
    more.type = 'button';
    more.addEventListener('click', () => window.dispatchEvent(new CustomEvent('tockica:tab', { detail: 'racun' })));
    section.append(more);
  }
}

// "First time ride?" switch. Switched on, it shows the waiver to sign before the first booking.
function waiverNodes() {
  const account = store.accounts.find((a) => a.id === $('account').value);
  if (store.waivers.some((w) => w.accountId === account.id)) return [];
  const first = el('label', undefined, 'guest-switch');
  const sw = el('input', undefined, 'switch');
  sw.type = 'checkbox';
  sw.setAttribute('role', 'switch');
  sw.checked = account.firstRide === true;
  first.append(sw, el('span', 'Prvi put vozim'));
  sw.addEventListener('change', () => {
    account.firstRide = sw.checked;
    saveStore(store);
    renderBikes();
  });
  const nodes = [first];
  if (account.firstRide) {
    const block = el('div', undefined, 'guest');
    const text = el('div', store.waiverText.text, 'g-sub');
    const name = el('input');
    name.type = 'text';
    name.value = account.name;
    name.setAttribute('aria-label', 'Ime i prezime za potpis');
    const sign = el('button', 'Potpisujem izjavu', 'btn');
    sign.addEventListener('click', () => {
      if (!name.value.trim()) return;
      signWaiver(store, { accountId: account.id, name: name.value.trim(), now: new Date() });
      saveStore(store);
      renderBikes();
    });
    block.append(text, name, sign);
    nodes.push(block);
  }
  return nodes;
}

function renderBikes() {
  if (!openClassId) return;
  const panel = $('bikes');
  const taken = takenBikes(store, openClassId);
  panel.replaceChildren();

  const session = store.classes.find((c) => c.id === openClassId);
  const legend = el('div', undefined, 'bike-legend');
  for (const [name, label] of [['free', 'slobodan'], ['taken', 'zauzet'], ['picked', 'odabran']]) {
    legend.append(el('span', undefined, name));
    legend.lastChild.append(el('i'), label);
  }
  const grid = el('div', undefined, 'bike-grid');
  grid.append(legend);
  // The block marks the front of the room, so the caption says who stands there.
  const stage = el('div', undefined, 'stage');
  stage.append(el('small', 'instruktor'), instructorName(taughtBy(session)).split(' ')[0] || '');
  grid.append(stage);
  for (let bikeNo = 1; bikeNo <= session.bikeCount; bikeNo += 1) {
    const button = el('button', String(bikeNo), 'bike');
    button.disabled = taken.includes(bikeNo);
    button.setAttribute('aria-pressed', String(bikeNo === pickedBike));
    const { column, row } = bikePosition(bikeNo);
    button.style.gridArea = `${row} / ${column}`;
    button.addEventListener('click', () => {
      const first = pickedBike === null;
      pickedBike = bikeNo;
      renderBikes();
      pop($('bikes').querySelector('.bike[aria-pressed="true"]'), 0.85);
      if (first) fadeIn($('book-bar'), 6, 200);
    });
    grid.append(button);
  }
  panel.append(grid);

  // Booking for someone else is the rare case, so the name field sits behind a switch.
  const toggle = el('label', undefined, 'guest-switch');
  const sw = el('input', undefined, 'switch');
  sw.type = 'checkbox';
  sw.setAttribute('role', 'switch');
  sw.checked = guestOpen;
  toggle.append(sw, el('span', 'Za gosta'));
  sw.setAttribute('aria-label', 'Rezerviram za nekoga drugog');
  const guest = el('div', undefined, 'guest');
  guest.hidden = !guestOpen;
  const guestInput = el('input');
  guestInput.type = 'text';
  guestInput.placeholder = 'Ime gosta';
  guestInput.setAttribute('aria-label', 'Ime gosta');
  guestInput.value = guestName;
  guestInput.addEventListener('input', () => {
    guestName = guestInput.value;
  });
  guest.append(guestInput);
  sw.addEventListener('change', () => {
    guestOpen = sw.checked;
    if (guestOpen) {
      release(guest);
      guest.hidden = false;
      expand(guest);
      guestInput.focus({ preventScroll: true });
    } else {
      guestName = '';
      collapse(guest).then(() => {
        if (guestOpen) return;
        guestInput.value = '';
        guest.hidden = true;
        release(guest);
      });
    }
  });
  const bar = $('book-bar');
  const waiverBlock = waiverNodes();
  const mustSign = needsWaiver(store, $('account').value);
  const book = el('button', mustSign ? 'Prvo potpiši izjavu' : pickedBike ? `Rezerviraj ${pickedBike}${creditsEnabled(store) ? ' · 1 kredit' : ''}` : 'Odaberi bicikl', 'btn');
  book.disabled = !pickedBike || mustSign;
  book.addEventListener('click', () => reserve(pickedBike));
  bar.replaceChildren(...waiverBlock, guest, toggle, book);
}

// The banner on Raspored, plus a signal for Moj profil, which shows the same text on its own page.
function announce(text) {
  showMessage(text);
  window.dispatchEvent(new CustomEvent('tockica:changed', { detail: text }));
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

function leaveList(classId) {
  leaveWaitlist(store, { classId, accountId: $('account').value });
  showMessage('Maknuto s liste čekanja.');
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
  announce(
    booking.status === 'late_cancel'
      ? `Kasno otkazivanje: ${creditsEnabled(store) ? 'kredit se ne vraća' : 'naplaćuje se jedan trening'}.${mailCount()}`
      : `Otkazano. ${creditsEnabled(store) ? 'Kredit je vraćen.' : 'Bez naplate.'}${mailCount()}`,
  );
  saveStore(store);
  renderAccount();
  renderMineCount();
  Promise.all(leaving.map((node) => collapse(node))).then(() => {
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
    haptic(12);
    // Slide the sheet away, then banner, credit and the new booking all arrive together.
    closeSheet($('book-sheet')).then(() => {
      showMessage(`Rezervirano: bicikl ${bikeNo}.${creditsEnabled(store) ? ` Kredit: ${balance(store, $('account').value, new Date())}.` : ''}`);
      render();
      expand(document.querySelector(`#s-mine [data-booking="${booking.id}"]`));
      expand(document.querySelector(`#s-classes .mine-block[data-bookings~="${booking.id}"]`));
    });
  } catch (err) {
    haptic([8, 40, 8]);
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
    const sub = `${creditsEnabled(store) ? '' : `${price} €, `}vrijedi ${pack.validDays} dana${tagged && price !== pack.priceEur ? ', Multisport cijena' : ''}`;
    const text = el('div', undefined, 'g-main');
    text.append(el('div', pack.name, 'g-title'), el('div', sub, 'g-sub'));
    if (!creditsEnabled(store)) {
      const row = el('div', undefined, 'g-row');
      row.append(text);
      list.append(row);
      continue;
    }
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
    announce(`Kupljeno: ${pack.name}. Kredit: ${balance(store, $('account').value, new Date())}.`);
    render();
  });
}

const cancelSheet = $('cancel-sheet');
bindSheet(cancelSheet);
$('cancel-no').addEventListener('click', () => closeSheet(cancelSheet));
$('cancel-yes').addEventListener('click', () => {
  const id = cancelling;
  closeSheet(cancelSheet).then(() => cancelMine(id));
});

const buySheet = $('buy-sheet');
bindSheet(buySheet);
$('buy-close').addEventListener('click', () => closeSheet(buySheet));
// Also opened from Moj profil, so the buy and cancel sheets stay the only copy of that flow.
export function openBuy() {
  const priceListOnly = !creditsEnabled(store);
  $('buy-title').textContent = priceListOnly ? 'Cjenik' : 'Kupi paket';
  buySheet.querySelector('.g-footer').textContent = priceListOnly
    ? 'Plaćanje je u studiju, na licu mjesta.'
    : 'Plaćanje još nije spojeno. Ovo je simulacija: paket se odmah upiše na račun.';
  renderPacks();
  openSheet(buySheet);
}
$('buy').addEventListener('click', openBuy);
$('nocredit-buy').addEventListener('click', openBuy);

const bookSheet = $('book-sheet');
bindSheet(bookSheet);
$('book-close').addEventListener('click', () => closeSheet(bookSheet));
bookSheet.addEventListener('close', () => {
  openClassId = null;
  pickedBike = null;
  guestName = '';
  guestOpen = false;
});

$('mine-link').addEventListener('click', (event) => {
  event.preventDefault();
  $('mine').scrollIntoView({ behavior: 'smooth' });
});

render();
