import { keep, restored } from './keep.js';
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
import { keepFocus } from './focus.js';
import { t, plural } from '../i18n.js';

const DAY_NAMES = [t('Pon'), t('Uto'), t('Sri'), t('Čet'), t('Pet'), t('Sub'), t('Ned')];
const WEEKS_SHOWN = 3;
const LOW_CREDITS = 2;

const ERROR_TEXT = {
  BikeTakenError: t('Bicikl je upravo zauzet.'),
  NoCreditError: t('Nemaš kredita. Kupi paket.'),
  NotBookableError: t('Ovaj trening još nije otvoren za rezervacije.'),
  NotFullError: t('Ima slobodnih bicikala, rezerviraj jedan.'),
  AlreadyBookedError: t('Već imaš bicikl na ovom treningu.'),
  WaiverRequiredError: t('Prije prve vožnje potpiši izjavu o odgovornosti.'),
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

// Open on the first day that still has a class to book, so the page is not a list of ended classes.
// If nothing is left, fall back to the first day from today on, then to today.
const today = studioTime.localDate(now.toISOString());
const days = (list) => list.map((c) => studioTime.localDate(c.startsAt)).filter((day) => studioTime.dayOfWeek(`${day}T12:00:00Z`) !== 7).sort();
const firstDay = days(store.classes.filter((c) => Date.parse(c.startsAt) > now.getTime())).at(0)
  ?? days(store.classes).find((day) => day >= today)
  ?? (studioTime.dayOfWeek(`${today}T12:00:00Z`) === 7 ? studioTime.addDays(today, 1) : today);
const keptDay = restored('schedule');
let selectedDay = keptDay && store.classes.some((c) => studioTime.localDate(c.startsAt) === keptDay) ? keptDay : firstDay;
keep('schedule', () => selectedDay);
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

// The banner floats over the page (see #s-message), so it clears itself instead of staying.
let messageTimer;
function showMessage(text, isError = false, node = $('message')) {
  showBanner(node, text, isError);
  clearTimeout(messageTimer);
  if (text) messageTimer = setTimeout(() => showBanner(node, ''), 6000);
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
    // No credits (December): no balance card, just a price list link under the account.
    $('nocredit').hidden = true;
    wrap.hidden = true;
    $('price').hidden = false;
    return;
  }
  $('price').hidden = true;
  const credits = balance(store, select.value, new Date());
  // With no credits the balance card gives way to a banner with the buy button.
  $('nocredit').hidden = credits > 0;
  $('balance').closest('.balance-wrap').hidden = credits === 0;
  const text = `${credits} ${plural(credits, ['kredit', 'kredita', 'kredita'], ['credit', 'credits'])}`;
  if ($('balance').textContent && $('balance').textContent !== text) pop($('balance'), 0.85);
  $('balance').textContent = text;
  const expiry = nextExpiry(store, select.value, new Date());
  $('expiry').textContent = expiry ? t('ističe {day}', { day: dayMonthFormat.format(new Date(expiry)) }) : '';
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
  prev.setAttribute('aria-label', t('Prethodni tjedan'));
  prev.disabled = weekOffset === 0;
  prev.addEventListener('click', () => move(() => {
    weekOffset -= 1;
    selectedDay = studioTime.addDays(monday, -7);
  }));
  const next = el('button', '›', 'nav-week');
  next.setAttribute('aria-label', t('Sljedeći tjedan'));
  next.disabled = weekOffset === WEEKS_SHOWN - 1;
  next.addEventListener('click', () => move(() => {
    weekOffset += 1;
    selectedDay = studioTime.addDays(monday, 7);
  }));
  const range = t('{from} do {to}', { from: dayMonthFormat.format(asDate(monday)), to: dayMonthFormat.format(asDate(studioTime.addDays(monday, 5))) });
  const head = el('div', undefined, 'week-head');
  head.append(prev, el('span', range, 'week-label'), next);
  nav.append(head);

  for (let i = 0; i < 6; i += 1) {
    const day = studioTime.addDays(monday, i);
    const isToday = day === today;
    const button = el('button', undefined, 'day');
    button.setAttribute('aria-pressed', String(day === selectedDay));
    const dot = el('span', undefined, myDays.has(day) ? 'dot mine-dot' : classDays.has(day) ? 'dot' : 'dot none');
    // The space keeps the text "Pon 02" in the DOM, the same as the name. The small label is a block, so the space is not drawn.
    button.append(el('small', isToday ? t('Danas') : DAY_NAMES[i]), ' ', el('strong', day.slice(8)), dot);
    // The visible small label is "Danas" on today, so the name starts with that word.
    const notes = [myDays.has(day) && t('imaš rezervaciju')].filter(Boolean);
    button.setAttribute('aria-label', [`${isToday ? t('Danas') : DAY_NAMES[i]} ${day.slice(8)}`, ...notes].join(', '));
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
    const cancelled = el('button', t('otkazano'), 'btn');
    cancelled.disabled = true;
    return cancelled;
  }
  if (current.getTime() >= startsAt) {
    const past = el('button', t('završeno'), 'btn');
    past.disabled = true;
    return past;
  }
  if (!isBookable(session, current)) {
    const soon = el('button', t('uskoro'), 'btn');
    soon.disabled = true;
    return soon;
  }
  if (takenBikes(store, session.id).length >= session.bikeCount) {
    if (store.waitlist.some((w) => w.classId === session.id && w.accountId === $('account').value)) {
      const waiting = el('button', t('na listi'), 'btn secondary');
      waiting.disabled = true;
      waiting.dataset.waiting = 'yes';
      return waiting;
    }
    const waitlist = el('button', t('lista čekanja'), 'btn');
    waitlist.addEventListener('click', () => joinList(session.id));
    return waitlist;
  }
  // Adding a bike is rare, so it is a quiet link inside the "your bike" block, not a second main button.
  const button = hasBike ? el('button', t('+ dodaj bicikl'), 'add-bike') : el('button', t('rezerviraj'), 'btn');
  button.dataset.action = hasBike ? 'add-bike' : 'book';
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
    list.append(el('p', t('Za ovaj dan nema treninga.'), 'meta'));
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
      info.append(el('div', t('Trening je otkazan'), 'meta few'));
    } else if (current.getTime() < Date.parse(session.releaseOpensAt)) {
      info.append(el('div', t('Otvara se {when}', { when: whenFormat.format(new Date(session.releaseOpensAt)) }), 'meta'));
    } else if (current.getTime() < Date.parse(session.startsAt) && isBookable(session, current)) {
      const free = session.bikeCount - takenBikes(store, session.id).length;
      // The bar is the share of free bikes, so a long bar and a big number say the same thing.
      const capacity = el('div', undefined, free <= 3 ? 'cap few' : 'cap');
      const bar = el('span', undefined, 'bar');
      bar.setAttribute('aria-hidden', 'true');
      const fill = el('i');
      fill.style.width = `${(free / session.bikeCount) * 100}%`;
      bar.append(fill);
      capacity.append(bar, el('span', free === 0 ? t('Popunjeno') : t('{n} slobodno', { n: free })));
      info.append(capacity);
    }
    const action = nameForClass(statusButton(session, current, mine.length > 0), session);
    if (action.dataset.waiting) {
      const leave = nameForClass(el('button', t('napusti listu'), 'link-btn'), session);
      leave.addEventListener('click', () => leaveList(session.id));
      info.append(leave);
    }
    const upcomingMine = mine.length > 0 && current.getTime() < Date.parse(session.startsAt);
    const mineBlock = () => {
      const bikes = mine.map((b) => (b.guestName ? `${b.bikeNo} (${b.guestName})` : b.bikeNo)).join(', ');
      const block = el('div', undefined, 'mine-block');
      block.dataset.bookings = mine.map((b) => b.id).join(' ');
      block.append(el('div', `${mine.length > 1 ? t('Tvoji bicikli') : t('Tvoj bicikl')}: ${bikes}`, 'mine'));
      return block;
    };
    if (action.dataset.action === 'add-bike' && upcomingMine) {
      // Count and bar stay on the left; the right column holds the button with "your bike" under it,
      // so booking adds no height to the card.
      const act = el('div', undefined, 'act');
      act.append(action, mineBlock());
      card.append(info, act);
    } else {
      card.append(info, action.dataset.action === 'book' ? withCost(action) : action);
      if (upcomingMine) info.append(mineBlock());
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

const finishedWord = (n) => (n === 1 ? t('završen trening') : n <= 4 ? t('završena treninga') : t('završenih treninga'));

// Card buttons repeat on every card, so the name adds the class it acts on after the visible text.
function nameForClass(button, session) {
  button.setAttribute('aria-label', `${button.textContent} ${session.name} ${timeFormat.format(new Date(session.startsAt))}`);
  return button;
}

// A booking costs one credit. Saying so under the button helps a first-time customer.
function withCost(button) {
  const wrap = el('div', undefined, 'act');
  wrap.append(button);
  if (creditsEnabled(store)) wrap.append(el('span', t('1 kredit'), 'cost'));
  return wrap;
}

function cancelNote(session, current) {
  const deadline = cancelDeadline(session);
  return current < deadline
    ? t('Besplatno otkazivanje do {when}', { when: whenFormat.format(deadline) })
    : creditsEnabled(store) ? t('Manje od 6 sati: kredit propada') : t('Manje od 6 sati: naplaćuje se trening');
}

// Cancelling asks first, in a small sheet that says what happens to the credit.
function cancelButton(booking, session, label) {
  const cancel = el('button', label, 'btn secondary cancel');
  cancel.setAttribute('aria-label', `${label} ${session.name}, ${whenFormat.format(new Date(session.startsAt))}`);
  cancel.addEventListener('click', () => askCancel(booking, session));
  return cancel;
}

let cancelling = null;
export function askCancel(booking, session) {
  const free = new Date() < cancelDeadline(session);
  const refund = creditsEnabled(store)
    ? (free ? t('Kredit se vraća.') : t('Kredit se ne vraća.'))
    : (free ? t('Bez naplate.') : t('Naplaćuje se jedan trening.'));
  cancelling = booking.id;
  $('cancel-title').textContent = t('Otkazati bicikl {n}?', { n: booking.bikeNo });
  $('cancel-text').textContent = `${session.name}, ${whenFormat.format(new Date(session.startsAt))}. ${refund}`;
  $('cancel-yes').textContent = t('Otkaži bicikl {n}', { n: booking.bikeNo });
  openSheet($('cancel-sheet'));
}

function renderMineCount() {
  const count = upcomingBookings(store, $('account').value, new Date()).length;
  reveal(document.getElementById('badge-raspored'), count > 0, String(count), (n) => pop(n, 0.6), popOut);
  // The link keeps its line even with no bookings, so it fading in never pushes the schedule down.
  const link = $('mine-link');
  if (count > 0) link.textContent = t('Moje rezervacije ({n})', { n: count });
  link.classList.toggle('is-empty', count === 0);
}

function renderMine() {
  const section = $('mine');
  renderMineCount();
  section.replaceChildren(el('h2', t('Moje rezervacije')));
  const current = new Date();
  const rows = upcomingBookings(store, $('account').value, current);
  if (rows.length === 0) {
    const empty = el('p', t('Nemaš nadolazećih rezervacija.'), 'meta empty');
    section.append(empty);
    return;
  }
  section.append(el('p', t('Besplatno otkazivanje do 6 sati prije treninga.'), 'meta'));
  // A customer sees the next booking here and the rest in Profil. Staff work on a picked account, so they see all.
  const shown = isCustomer() ? rows.slice(0, 1) : rows;
  for (const { booking, session } of shown) {
    const card = el('article', undefined, 'card');
    card.dataset.booking = booking.id;
    const info = el('div');
    const guest = booking.guestName ? ` (${booking.guestName})` : '';
    info.append(
      el('div', whenFormat.format(new Date(session.startsAt)), 'time'),
      el('div', session.name, 'name'),
      el('div', `${t('Bicikl {n}', { n: booking.bikeNo })}${guest} · ${instructorName(taughtBy(session))}`, 'meta'),
      el('div', cancelNote(session, current), 'meta'),
    );
    info.append(cancelButton(booking, session, t('otkaži')));
    card.append(info);
    section.append(card);
  }
  if (shown.length < rows.length) {
    const more = el('button', t('Sve rezervacije ({n}) u profilu', { n: rows.length }), 'g-text accent');
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
  first.append(sw, el('span', t('Prvi put vozim')));
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
    name.setAttribute('aria-label', t('Ime i prezime za potpis'));
    const error = el('p', undefined, 'field-error');
    error.id = 'waiver-name-error';
    name.setAttribute('aria-describedby', error.id);
    name.addEventListener('input', () => {
      if (!name.value.trim()) return;
      error.textContent = '';
      name.removeAttribute('aria-invalid');
    });
    const sign = el('button', t('Potpisujem izjavu'), 'btn');
    sign.addEventListener('click', () => {
      if (!name.value.trim()) {
        error.textContent = t('Upiši ime i prezime.');
        name.setAttribute('aria-invalid', 'true');
        name.focus({ preventScroll: true });
        return;
      }
      signWaiver(store, { accountId: account.id, name: name.value.trim(), now: new Date() });
      saveStore(store);
      renderBikes();
    });
    block.append(text, name, error, sign);
    nodes.push(block);
  }
  return nodes;
}

function renderBikes() {
  keepFocus(drawBikes);
}

function drawBikes() {
  if (!openClassId) return;
  const panel = $('bikes');
  const taken = takenBikes(store, openClassId);
  panel.replaceChildren();

  const session = store.classes.find((c) => c.id === openClassId);
  const legend = el('div', undefined, 'bike-legend');
  for (const [name, label] of [['free', t('slobodan')], ['taken', t('zauzet')], ['picked', t('odabran')]]) {
    legend.append(el('span', undefined, name));
    legend.lastChild.append(el('i'), label);
  }
  const grid = el('div', undefined, 'bike-grid');
  grid.append(legend);
  // The block marks the front of the room, so the caption says who stands there.
  const stage = el('div', undefined, 'stage');
  stage.append(el('small', t('instruktor')), instructorName(taughtBy(session)).split(' ')[0] || '');
  grid.append(stage);
  for (let bikeNo = 1; bikeNo <= session.bikeCount; bikeNo += 1) {
    const button = el('button', String(bikeNo), 'bike');
    button.setAttribute('aria-label', t('Bicikl {n}', { n: bikeNo }));
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
  toggle.append(sw, el('span', t('Za gosta')));
  const guest = el('div', undefined, 'guest');
  guest.hidden = !guestOpen;
  const guestInput = el('input');
  guestInput.type = 'text';
  guestInput.placeholder = t('Ime gosta');
  guestInput.setAttribute('aria-label', t('Ime gosta'));
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
  const bookLabel = pickedBike
    ? `${t('Rezerviraj {n}', { n: pickedBike })}${creditsEnabled(store) ? ` · ${t('1 kredit')}` : ''}`
    : t('Odaberi bicikl');
  const book = el('button', mustSign ? t('Prvo potpiši izjavu') : bookLabel, 'btn');
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
  return store.outbox.length ? ` ${t('Poslano mailova: {n}.', { n: store.outbox.length })}` : '';
}

function joinList(classId) {
  try {
    joinWaitlist(store, { classId, accountId: $('account').value, now: new Date() });
    showMessage(`${t('Na listi čekanja. Dobit ćeš mail kad se mjesto oslobodi.')}${mailCount()}`);
  } catch (err) {
    showMessage(ERROR_TEXT[err.name] ?? t('Nešto je pošlo krivo.'), true);
    if (err.name !== 'NotFullError' && err.name !== 'AlreadyBookedError') throw err;
  }
  render();
}

function leaveList(classId) {
  leaveWaitlist(store, { classId, accountId: $('account').value });
  showMessage(t('Maknuto s liste čekanja.'));
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
      ? `${t('Kasno otkazivanje: {cost}.', { cost: creditsEnabled(store) ? t('kredit se ne vraća') : t('naplaćuje se jedan trening') })}${mailCount()}`
      : `${t('Otkazano. {refund}', { refund: creditsEnabled(store) ? t('Kredit je vraćen.') : t('Bez naplate.') })}${mailCount()}`,
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
      const credit = creditsEnabled(store) ? ` ${t('Kredit: {n}.', { n: balance(store, $('account').value, new Date()) })}` : '';
      showMessage(`${t('Rezervirano: bicikl {n}.', { n: bikeNo })}${credit}`);
      render();
      expand(document.querySelector(`#s-classes .mine-block[data-bookings~="${booking.id}"]`));
    });
  } catch (err) {
    haptic([8, 40, 8]);
    showMessage(ERROR_TEXT[err.name] ?? t('Nešto je pošlo krivo.'), true, $('book-message'));
    if (!(err instanceof BikeTakenError || err instanceof NoCreditError || err instanceof NotBookableError)) {
      throw err;
    }
    if (err instanceof BikeTakenError) pickedBike = null;
    renderBikes();
  }
}

export function render() {
  keepFocus(draw);
}

function draw() {
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
    const priceText = creditsEnabled(store) ? '' : `${price} €, `;
    const multisport = tagged && price !== pack.priceEur ? `, ${t('Multisport cijena')}` : '';
    const sub = `${priceText}${t('vrijedi {days} dana', { days: pack.validDays })}${multisport}`;
    const text = el('div', undefined, 'g-main');
    text.append(el('div', pack.name, 'g-title'), el('div', sub, 'g-sub'));
    if (!creditsEnabled(store)) {
      const row = el('div', undefined, 'g-row');
      row.append(text);
      list.append(row);
      continue;
    }
    const bought = !canPurchase(store, accountId, pack.id);
    const buy = el('button', bought ? t('kupljeno') : `${price} €`, 'btn');
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
    announce(t('Kupljeno: {name}. Kredit: {n}.', { name: pack.name, n: balance(store, $('account').value, new Date()) }));
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
  $('buy-title').textContent = priceListOnly ? t('Cjenik') : t('Kupi paket');
  buySheet.querySelector('.g-footer').textContent = priceListOnly
    ? t('Plaćanje je u studiju, na licu mjesta.')
    : t('Plaćanje još nije spojeno. Ovo je simulacija: paket se odmah upiše na račun.');
  renderPacks();
  openSheet(buySheet);
}
