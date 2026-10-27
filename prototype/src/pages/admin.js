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
import { showBanner, expand, collapse, release, pop } from './motion.js';

const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', weekday: 'short', day: '2-digit', month: '2-digit' });

const $ = (id) => document.getElementById('a-' + id);
const store = loadStore();
saveStore(store);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showMessage(text, isError = false) {
  showBanner($('message'), text, isError);
}

// Runs an admin action, saves, and re-renders. Errors show as a message. Edits that already
// show on screen (a switch, a price) pass rerender = false, so focus and the switch's own
// animation are not thrown away. Returns whether the action worked.
function act(action, rerender = true) {
  let ok = true;
  try {
    action();
    showMessage('Spremljeno.');
  } catch (err) {
    ok = false;
    showMessage(err.message, true);
  }
  saveStore(store);
  if (rerender) render();
  return ok;
}

function row(...children) {
  const node = el('div', undefined, 'g-row');
  node.append(...children);
  return node;
}

function main(title, ...subs) {
  const node = el('div', undefined, 'g-main');
  node.append(el('div', title, 'g-title'), ...subs.filter(Boolean).map((text) => el('div', text, 'g-sub')));
  return node;
}

function chevron() {
  const node = el('span', undefined, 'g-chevron');
  node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  return node;
}

function restoreForm(account, trail) {
  const form = el('form', undefined, 'g-form');
  form.hidden = true;
  const count = el('input', undefined, 'g-input g-count');
  count.type = 'number';
  count.min = '1';
  count.value = '1';
  count.setAttribute('aria-label', 'Broj kredita');
  const reason = el('input', undefined, 'g-input g-reason');
  reason.placeholder = 'Razlog';
  reason.setAttribute('aria-label', 'Razlog');
  const submit = el('button', 'Vrati', 'btn');
  submit.type = 'submit';
  form.append(count, reason, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!reason.value.trim()) {
      showMessage('Upiši razlog.', true);
      return;
    }
    const sure = window.confirm(`Vratiti ${count.value} kredita za ${account.name}?\nRazlog: ${reason.value.trim()}`);
    if (!sure) return;
    const ok = act(() => restoreCredit(store, {
      accountId: account.id,
      count: Number(count.value),
      reason: reason.value.trim(),
      now: new Date(),
    }), false);
    if (!ok) return;
    // The new credit shows at once while the form folds shut.
    trail.textContent = `Kredit ${balance(store, account.id, new Date())}`;
    pop(trail, 0.85);
    collapse(form).then(render);
  });
  return { form, reason };
}

function renderAccounts(now) {
  const section = $('accounts');
  section.replaceChildren();
  for (const account of store.accounts) {
    const group = el('div', undefined, 'group');
    const trail = el('span', `Kredit ${balance(store, account.id, now)}`, 'g-trail');
    group.append(row(main(account.name, account.email), trail));

    const switchRow = el('label', undefined, 'g-row');
    const box = el('input', undefined, 'switch');
    box.type = 'checkbox';
    box.setAttribute('role', 'switch');
    box.checked = account.multisportTag;
    box.addEventListener('change', () => act(() => setMultisportTag(store, account.id, box.checked), false));
    switchRow.append(el('span', 'Multisport', 'g-main g-title'), box);
    group.append(switchRow);

    const { form, reason } = restoreForm(account, trail);
    const toggle = el('button', undefined, 'g-row g-action');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(el('span', 'Vrati kredit', 'g-main g-title'), chevron());
    toggle.addEventListener('click', () => {
      const opening = form.hidden;
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening) {
        form.hidden = false;
        expand(form);
        reason.focus();
      } else {
        collapse(form).then(() => {
          release(form);
          form.hidden = true;
        });
      }
    });
    group.append(toggle, form);
    section.append(group);
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
    section.append(row(el('span', 'Nema nadolazećih rezervacija.', 'g-sub')));
    return;
  }

  for (const { booking, session } of upcoming) {
    const account = store.accounts.find((a) => a.id === booking.accountId);
    const when = `${dayFormat.format(new Date(session.startsAt))} ${timeFormat.format(new Date(session.startsAt))}`;
    const guest = booking.guestName ? ` · Gost: ${booking.guestName}` : '';
    const item = row(main(session.name, when, `Bicikl ${booking.bikeNo} · ${account?.name ?? ''}${guest}`));
    const remove = el('button', 'Makni', 'g-text destructive');
    remove.setAttribute('aria-label', `Makni s treninga: ${account?.name ?? ''}, bicikl ${booking.bikeNo}`);
    remove.addEventListener('click', () => {
      const reason = window.prompt('Razlog za micanje s treninga:');
      if (!reason || !reason.trim()) return;
      const sure = window.confirm(
        `Makni ${account?.name ?? 'klijenta'} (bicikl ${booking.bikeNo}) s treninga ${session.name}?\nKredit se vraća, a klijent dobiva mail.`,
      );
      if (!sure) return;
      // The banner shows at once while the row folds away.
      const ok = act(() => removeFromClass(store, { bookingId: booking.id, reason: reason.trim(), now: new Date() }), false);
      if (ok) collapse(item).then(render);
    });
    item.append(remove);
    section.append(item);
  }
}

function priceRow(label, value, placeholder) {
  const input = el('input', undefined, 'g-input g-price');
  input.type = 'number';
  input.min = '0';
  input.inputMode = 'decimal';
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  const node = el('label', undefined, 'g-row');
  node.append(el('span', label, 'g-main g-title'), input, el('span', '€', 'g-trail'));
  return { node, input };
}

function renderPacks() {
  const section = $('packs');
  section.replaceChildren();
  for (const pack of store.packs) {
    const group = el('div', undefined, 'group');
    group.append(row(main(pack.name, `${pack.validDays} dana`)));
    const price = priceRow('Cijena', String(pack.priceEur), '0');
    const multi = priceRow('Multisport cijena', pack.multisportPriceEur ?? '', 'nema');
    const save = () => act(() => setPackPrices(store, pack.id, {
      priceEur: Number(price.input.value),
      multisportPriceEur: multi.input.value === '' ? null : Number(multi.input.value),
    }), false);
    price.input.addEventListener('change', save);
    multi.input.addEventListener('change', save);
    group.append(price.node, multi.node);
    section.append(group);
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

export function render() {
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
