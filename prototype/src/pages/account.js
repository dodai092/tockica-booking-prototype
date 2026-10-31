import { hrDate } from '../time.js';
import { taughtBy } from '../payroll.js';
import { priceFor } from '../admin.js';
import { balance, creditsEnabled } from '../ledger.js';
import { creditLots, nextTraining, pastBookings, waitlistEntries, rideProgress, introOffer } from '../dashboard.js';
import { upcomingBookings } from '../booking.js';
import { loadStore, saveStore, getDemoAccount, setDemoAccount, isCustomer } from './session.js';
import { showBanner, fadeIn } from './motion.js';
import { askCancel, openBuy } from './schedule.js';
import { keepFocus } from './focus.js';

const STATUS_TEXT = {
  attended: 'Došao',
  no_show: 'No-show',
  cancelled: 'Otkazano',
  late_cancel: 'Kasno otkazano',
};
const STATUS_NOTE = {
  attended: '',
  no_show: 'Kredit je potrošen.',
  cancelled: 'Kredit je vraćen.',
  late_cancel: 'Kredit nije vraćen.',
};
const STATUS_NOTE_NO_CREDITS = {
  attended: '',
  no_show: 'Naplaćuje se trening.',
  cancelled: 'Bez naplate.',
  late_cancel: 'Naplaćuje se trening.',
};
const HISTORY_LIMIT = 10;

const whenFormat = hrDate({ weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayFormat = hrDate({ day: 'numeric', month: 'numeric' });

const $ = (id) => document.getElementById('m-' + id);
const store = loadStore();

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function row(main, sub, trail, warn = false) {
  const node = el('div', undefined, 'g-row');
  const text = el('div', undefined, 'g-main');
  text.append(el('div', main, 'g-title'));
  if (sub) text.append(el('div', sub, warn ? 'g-sub few' : 'g-sub'));
  node.append(text);
  if (trail) node.append(trail);
  return node;
}

const accountId = () => $('account').value;
const instructor = (session) => store.instructors.find((i) => i.id === taughtBy(session))?.name ?? '';
const goTo = (tab) => window.dispatchEvent(new CustomEvent('tockica:tab', { detail: tab }));

function button(text, className, onClick) {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function group(title, ...rows) {
  const wrap = el('div');
  wrap.append(el('h2', title, 'g-header'));
  const list = el('div', undefined, 'group');
  list.append(...rows);
  wrap.append(list);
  return wrap;
}

// The next ride, big, with what cancelling would cost. With no booking it is a way back to the schedule.
function nextCard(now) {
  const card = el('section', undefined, 'summary');
  const info = el('div');
  const next = nextTraining(store, accountId(), now);
  if (!next) {
    info.append(el('div', 'Nema rezervacije', 's-name'), el('div', 'Odaberi trening i bicikl.', 's-meta'));
    card.append(info, button('Rezerviraj', 'btn', () => goTo('raspored')));
    return card;
  }
  const { booking, session } = next;
  const guest = booking.guestName ? ` (${booking.guestName})` : '';
  info.append(
    el('div', 'Sljedeći trening', 's-meta'),
    el('div', whenFormat.format(new Date(session.startsAt)), 's-name'),
    el('div', `${session.name} · bicikl ${booking.bikeNo}${guest}`, 's-meta'),
    el('div', next.freeCancel ? `Besplatno otkazivanje do ${whenFormat.format(next.deadline)}` : `Manje od 6 sati: ${creditsEnabled(store) ? 'kredit se ne vraća' : 'naplaćuje se trening'}`, 's-meta'),
  );
  card.append(info, button('Otkaži', 'btn secondary', () => askCancel(booking, session)));
  return card;
}

function otherUpcoming(now) {
  const rest = upcomingBookings(store, accountId(), now).slice(1);
  if (rest.length === 0) return null;
  return group('Nadolazeće', ...rest.map(({ booking, session }) => {
    const guest = booking.guestName ? ` (${booking.guestName})` : '';
    return row(`${whenFormat.format(new Date(session.startsAt))} · ${session.name}`, `Bicikl ${booking.bikeNo}${guest} · ${instructor(session)}`,
      button('Otkaži', 'g-text destructive', () => askCancel(booking, session)));
  }));
}

function waitlistGroup(now) {
  const entries = waitlistEntries(store, accountId(), now);
  if (entries.length === 0) return null;
  return group('Lista čekanja', ...entries.map(({ session }) => row(`${whenFormat.format(new Date(session.startsAt))} · ${session.name}`, 'Dobit ćeš mail kad se mjesto oslobodi.')));
}

function creditsGroup(now) {
  if (!creditsEnabled(store)) return null;
  const lots = creditLots(store, accountId(), now);
  const rows = [];
  const soon = lots.filter((l) => l.expiringSoon);
  if (soon.length) {
    const count = soon.reduce((sum, l) => sum + l.remaining, 0);
    const text = `Ističe ${dayFormat.format(new Date(soon[0].expiresAt))}: ${count} ${count === 1 ? 'kredit' : 'kredita'}`;
    const warning = row(text, 'Rezerviraj prije isteka.', button('Rezerviraj', 'btn', () => goTo('raspored')), true);
    warning.classList.add('credit-warning');
    rows.push(warning);
  }
  rows.push(row(`Kredit: ${balance(store, accountId(), now)}`));
  for (const lot of lots) {
    const origin = lot.origin === 'returned' ? 'Vraćeni kredit' : lot.packName;
    rows.push(row(`${origin}: ${lot.remaining}`, `Ističe ${dayFormat.format(new Date(lot.expiresAt))}`));
  }
  const buy = el('button', undefined, 'g-row g-action');
  buy.type = 'button';
  buy.append(el('span', 'Kupi paket', 'g-main g-title accent-text'));
  buy.addEventListener('click', openBuy);
  rows.push(buy);
  return group('Krediti', ...rows);
}

// A first-time account gets the intro packs; once it has ridden, the bar to the next milestone.
function ridesGroup() {
  const offer = introOffer(store, accountId());
  if (offer.length) {
    return group('Za početak', ...offer.map((pack) => row(pack.name, `${priceFor(store, accountId(), pack.id)} €, vrijedi ${pack.validDays} dana`, creditsEnabled(store) ? button('Kupi', 'btn', openBuy) : undefined)));
  }
  const { rides, next, toNext, percent } = rideProgress(store, accountId());
  if (rides === 0) return null;
  const bar = el('div', undefined, 'progress');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Napredak do sljedeće prekretnice');
  bar.setAttribute('aria-valuenow', String(percent));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.append(el('span'));
  bar.firstChild.style.width = `${percent}%`;
  const line = row(`${rides} ${rides === 1 ? 'vožnja' : 'vožnji'}`, next ? `Još ${toNext} do ${next}. sata` : 'Sve prekretnice su iza tebe');
  line.classList.add('wrap');
  line.append(bar);
  return group('Vožnje', line);
}

function historyGroup() {
  const past = pastBookings(store, accountId(), HISTORY_LIMIT);
  if (past.length === 0) return null;
  return group('Povijest', ...past.map(({ booking, session }) => {
    const guest = booking.guestName ? ` (${booking.guestName})` : '';
    const note = [`Bicikl ${booking.bikeNo}${guest}`, (creditsEnabled(store) ? STATUS_NOTE : STATUS_NOTE_NO_CREDITS)[booking.status]].filter(Boolean).join(' · ');
    return row(`${whenFormat.format(new Date(session.startsAt))} · ${session.name}`, note, el('span', STATUS_TEXT[booking.status], `pill pill-${booking.status}`));
  }));
}

function profileGroup() {
  const account = store.accounts.find((a) => a.id === accountId());
  const marketing = el('input', undefined, 'switch');
  marketing.type = 'checkbox';
  marketing.setAttribute('role', 'switch');
  marketing.checked = Boolean(account.marketingOptIn);
  marketing.setAttribute('aria-label', 'Primaj obavijesti o akcijama');
  marketing.addEventListener('change', () => {
    account.marketingOptIn = marketing.checked;
    saveStore(store);
  });
  const marketingRow = el('label', undefined, 'g-row');
  const text = el('span', undefined, 'g-main');
  text.append(el('div', 'Obavijesti o akcijama', 'g-title'), el('div', 'Odvojeno od obavijesti o rezervacijama.', 'g-sub'));
  marketingRow.append(text, marketing);
  const referral = el('label', undefined, 'g-row');
  const referralText = el('span', undefined, 'g-main');
  referralText.append(el('div', 'Preporučio/la te prijatelj?', 'g-title'), el('div', 'Upiši ime i prezime prijatelja, ako jest.', 'g-sub'));
  const referrer = el('input', undefined, 'g-input');
  referrer.value = account.referredBy ?? '';
  referrer.addEventListener('change', () => {
    account.referredBy = referrer.value.trim() || null;
    saveStore(store);
  });
  referral.append(referralText, referrer);
  return group('Podaci',
    row('Ime', undefined, el('span', account.name, 'g-trail')),
    row('Email', undefined, el('span', account.email, 'g-trail')),
    row('Telefon', undefined, el('span', account.phone ?? '', 'g-trail')),
    row('Multisport', 'Oznaku postavlja studio.', el('span', account.multisportTag ? 'Da' : 'Ne', 'g-trail')),
    referral,
    marketingRow);
}

export function render() {
  keepFocus(draw);
}

function draw() {
  const now = new Date();
  const select = $('account');
  if (select.options.length === 0) {
    for (const account of store.accounts) {
      const option = el('option', account.name);
      option.value = account.id;
      select.append(option);
    }
    select.addEventListener('change', () => {
      setDemoAccount(select.value);
      showBanner($('message'), '');
      render();
      fadeIn($('body'), 6);
    });
  }
  if (getDemoAccount()) select.value = getDemoAccount();
  select.closest('.group').hidden = isCustomer();

  const blocks = [nextCard(now), otherUpcoming(now), waitlistGroup(now), creditsGroup(now), ridesGroup(), historyGroup(), profileGroup()];
  $('body').replaceChildren(...blocks.filter(Boolean));
}

// A cancel or purchase made through the shared sheets reports here as well.
window.addEventListener('tockica:changed', (event) => {
  showBanner($('message'), event.detail);
  render();
});
