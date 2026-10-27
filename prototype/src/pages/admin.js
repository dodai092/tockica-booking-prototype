import { studioTime } from '../time.js';
import { balance } from '../ledger.js';
import {
  restoreCredit,
  removeFromClass,
  setMultisportTag,
  setPackPrices,
} from '../admin.js';
import { addSoonClass, fillClass } from '../demo.js';
import { loadStore, saveStore, resetStore } from './session.js';

const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', weekday: 'short', day: '2-digit', month: '2-digit' });

const $ = (id) => document.getElementById(id);
const store = loadStore();
saveStore(store);

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

// Runs an admin action, saves, and re-renders. Errors show as a message.
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

function renderAccounts(now) {
  const section = $('accounts');
  section.replaceChildren();
  for (const account of store.accounts) {
    const card = el('article', undefined, 'card');
    const info = el('div');
    info.append(
      el('div', account.name, 'name'),
      el('div', `${account.email} · kredit: ${balance(store, account.id, now)}`, 'meta'),
    );

    const tag = el('label', undefined, 'toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = account.multisportTag;
    box.addEventListener('change', () => act(() => setMultisportTag(store, account.id, box.checked)));
    tag.append(box, ' Multisport');

    const restore = el('form', undefined, 'restore');
    const count = el('input');
    count.type = 'number';
    count.min = '1';
    count.value = '1';
    count.setAttribute('aria-label', 'Broj kredita');
    const reason = el('input');
    reason.placeholder = 'Razlog';
    reason.setAttribute('aria-label', 'Razlog');
    const submit = el('button', 'Vrati kredit', 'btn secondary');
    submit.type = 'submit';
    restore.append(count, reason, submit);
    restore.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!reason.value.trim()) {
        showMessage('Upiši razlog.', true);
        return;
      }
      const sure = window.confirm(`Vratiti ${count.value} kredita za ${account.name}?\nRazlog: ${reason.value.trim()}`);
      if (!sure) return;
      act(() => restoreCredit(store, {
        accountId: account.id,
        count: Number(count.value),
        reason: reason.value.trim(),
        now: new Date(),
      }));
    });

    card.append(info, tag, restore);
    section.append(card);
  }
}

function renderBookings(now) {
  const section = $('bookings');
  section.replaceChildren();
  const upcoming = store.bookings
    .filter((b) => b.status === 'booked')
    .map((b) => ({ booking: b, session: store.classes.find((c) => c.id === b.classId) }))
    .filter(({ session }) => Date.parse(session.startsAt) > now.getTime())
    .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));

  if (upcoming.length === 0) {
    section.append(el('p', 'Nema nadolazećih rezervacija.', 'meta'));
    return;
  }

  for (const { booking, session } of upcoming) {
    const account = store.accounts.find((a) => a.id === booking.accountId);
    const card = el('article', undefined, 'card');
    const info = el('div');
    info.append(
      el('div', `${session.name} · ${dayFormat.format(new Date(session.startsAt))} ${timeFormat.format(new Date(session.startsAt))}`, 'name'),
      el('div', `Bajk ${booking.bikeNo} · ${account?.name ?? ''}`, 'meta'),
    );
    const remove = el('button', 'Makni s treninga', 'btn secondary');
    remove.addEventListener('click', () => {
      const reason = window.prompt('Razlog za micanje s treninga:');
      if (!reason || !reason.trim()) return;
      const sure = window.confirm(
        `Makni ${account?.name ?? 'klijenta'} (bajk ${booking.bikeNo}) s treninga ${session.name}?\nKredit se vraća, a klijent dobiva mail.`,
      );
      if (!sure) return;
      act(() => removeFromClass(store, { bookingId: booking.id, reason: reason.trim(), now: new Date() }));
    });
    card.append(info, remove);
    section.append(card);
  }
}

function renderPacks() {
  const section = $('packs');
  section.replaceChildren();
  for (const pack of store.packs) {
    const form = el('form', undefined, 'pack');
    const price = el('input');
    price.type = 'number';
    price.min = '0';
    price.value = String(pack.priceEur);
    price.setAttribute('aria-label', `Cijena: ${pack.name}`);
    const multi = el('input');
    multi.type = 'number';
    multi.min = '0';
    multi.value = pack.multisportPriceEur === null ? '' : String(pack.multisportPriceEur);
    multi.placeholder = 'Multisport (prazno = nema)';
    multi.setAttribute('aria-label', `Multisport cijena: ${pack.name}`);
    const submit = el('button', 'Spremi', 'btn secondary');
    submit.type = 'submit';
    form.append(el('strong', pack.name), price, el('span', '€'), multi, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      act(() => setPackPrices(store, pack.id, {
        priceEur: Number(price.value),
        multisportPriceEur: multi.value === '' ? null : Number(multi.value),
      }));
    });
    section.append(form);
  }
}

function renderDemoClasses(now) {
  const select = $('demo-class');
  const previous = select.value;
  select.replaceChildren();
  const upcoming = store.classes
    .filter((c) => Date.parse(c.startsAt) > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const session of upcoming) {
    const option = el('option', `${dayFormat.format(new Date(session.startsAt))} ${timeFormat.format(new Date(session.startsAt))} · ${session.name}`);
    option.value = session.id;
    select.append(option);
  }
  if (upcoming.some((c) => c.id === previous)) select.value = previous;
}

function render() {
  const now = new Date();
  renderAccounts(now);
  renderBookings(now);
  renderPacks();
  renderDemoClasses(now);
}

$('reset').addEventListener('click', () => {
  resetStore();
  window.location.reload();
});

$('fill').addEventListener('click', () => {
  const classId = $('demo-class').value;
  if (!classId) return;
  act(() => fillClass(store, classId, new Date()));
});

$('soon').addEventListener('click', () => {
  act(() => addSoonClass(store, new Date()));
});

render();
