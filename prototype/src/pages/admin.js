import { studioTime, hrDate } from '../time.js';
import { balance } from '../ledger.js';
import {
  restoreCredit,
  removeFromClass,
  setMultisportTag,
  setPackPrices,
  setReleaseSettings,
  addTemplateEntry,
  removeTemplateEntry,
  cancelClass,
  editClass,
} from '../admin.js';
import {
  markMonthPaid,
  unmarkMonthPaid,
  removeSlot,
  addClosedDay,
  removeClosedDay,
  rentalStatus,
  monthLabel,
  monthOf,
  nextMonth,
} from '../sculpt.js';
import { addSoonClass, fillClass } from '../demo.js';
import { sendReminders, sendMilestoneNotes } from '../reminders.js';
import { owedClasses, markCharged } from '../owed.js';
import { creditsEnabled } from '../ledger.js';
import { loadStore, saveStore, resetStore, generateUpcoming } from './session.js';
import { showBanner, expand, collapse, release, pop } from './motion.js';
import { keepFocus } from './focus.js';

const timeFormat = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit' });
const dayFormat = hrDate({ weekday: 'short', day: '2-digit', month: '2-digit' });

const DAY_NAMES = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];

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
function act(action, rerender = true, text = 'Spremljeno.') {
  let ok = true;
  try {
    action();
    showMessage(typeof text === 'function' ? text() : text);
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

// Rows that were not on screen at the last render grow in. `seen` holds the keys already
// shown; null means nothing has rendered yet, so the first paint stays still.
const seen = { bookings: null, mails: null };

function growIn(kind, key, item, shown) {
  shown.add(key);
  if (!seen[kind] || seen[kind].has(key)) return item;
  const inner = el('div', undefined, 'g-enter-in');
  inner.append(item);
  const wrap = el('div', undefined, 'g-enter');
  wrap.append(inner);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  return wrap;
}

function main(title, ...subs) {
  const node = el('div', undefined, 'g-main');
  node.append(el('div', title, 'g-title'), ...subs.filter(Boolean).map((text) => el('div', text, 'g-sub')));
  return node;
}

export function chevron() {
  const node = el('span', undefined, 'g-chevron');
  node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  return node;
}

// A row that folds a panel open and shut.
export function foldToggle(toggle, panel, focusNode) {
  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) {
      panel.hidden = false;
      expand(panel);
      focusNode?.focus();
    } else {
      collapse(panel).then(() => {
        release(panel);
        panel.hidden = true;
      });
    }
  });
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
    const who = main(account.name, account.email, account.referredBy ? `Preporuka: ${account.referredBy}` : null);
    group.append(row(...(creditsEnabled(store) ? [who, trail] : [who])));

    const switchRow = el('label', undefined, 'g-row');
    const box = el('input', undefined, 'switch');
    box.type = 'checkbox';
    box.setAttribute('role', 'switch');
    box.setAttribute('aria-label', `Multisport ${account.name}`);
    box.checked = account.multisportTag;
    box.addEventListener('change', () => act(() => setMultisportTag(store, account.id, box.checked), false));
    switchRow.append(el('span', 'Multisport', 'g-main g-title'), box);
    group.append(switchRow);

    if (!creditsEnabled(store)) {
      section.append(group);
      continue;
    }
    const { form, reason } = restoreForm(account, trail);
    const toggle = el('button', undefined, 'g-row g-action');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(el('span', 'Vrati kredit', 'g-main g-title'), chevron());
    foldToggle(toggle, form, reason);
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
    seen.bookings = new Set();
    return;
  }

  const shown = new Set();
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
        `Makni ${account?.name ?? 'klijenta'} (bicikl ${booking.bikeNo}) s treninga ${session.name}?\n${creditsEnabled(store) ? 'Kredit se vraća, a klijent' : 'Klijent'} dobiva mail.`,
      );
      if (!sure) return;
      // The banner shows at once while the row folds away.
      const ok = act(() => removeFromClass(store, { bookingId: booking.id, reason: reason.trim(), now: new Date() }), false);
      if (ok) collapse(item).then(render);
    });
    item.append(remove);
    section.append(growIn('bookings', booking.id, item, shown));
  }
  seen.bookings = shown;
}

function priceRow(label, value, placeholder, packName) {
  const input = el('input', undefined, 'g-input g-price');
  input.type = 'number';
  input.min = '0';
  input.inputMode = 'decimal';
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', `${label} ${packName}`);
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
    const price = priceRow('Cijena', String(pack.priceEur), '0', pack.name);
    const multi = priceRow('Multisport cijena', pack.multisportPriceEur ?? '', 'nema', pack.name);
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

function selectRow(label, options, value, onChange) {
  const select = el('select', undefined, 'g-select');
  select.setAttribute('aria-label', label);
  for (const [optionValue, text] of options) {
    const option = el('option', text);
    option.value = optionValue;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select));
  const node = el('label', undefined, 'g-row');
  node.append(el('span', label, 'g-main g-title'), select);
  return node;
}

function upcomingClasses(now) {
  return store.classes
    .filter((c) => Date.parse(c.startsAt) > now.getTime() && !c.cancelled)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

const classLabel = (c) => `${dayFormat.format(new Date(c.startsAt))} ${timeFormat.format(new Date(c.startsAt))} · ${c.name}`;

function renderSchedule(now) {
  const section = $('schedule');
  section.replaceChildren();
  const instructors = store.instructors.map((i) => [i.id, i.name]);
  const days = DAY_NAMES.map((name, i) => [String(i + 1), name]);

  // When bookings open.
  const { settings } = store;
  const setting = (key) => (select) => act(() => setReleaseSettings(store, { ...settings, [key]: Number(select.value) }), false);
  const opens = el('div', undefined, 'group');
  opens.append(
    selectRow('Rezervacije se otvaraju (dan)', days, String(settings.dayOfWeek), setting('dayOfWeek')),
    selectRow('Sat otvaranja', Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, '0')}:00`]), String(settings.hour), setting('hour')),
    selectRow('Tjedana unaprijed', Array.from({ length: 8 }, (_, w) => [String(w + 1), String(w + 1)]), String(settings.weeksAhead), setting('weeksAhead')),
  );
  section.append(opens);

  // The weekly template: list and add form.
  const template = el('div', undefined, 'group');
  const listToggle = el('button', undefined, 'g-row g-action');
  listToggle.type = 'button';
  listToggle.setAttribute('aria-expanded', 'false');
  listToggle.append(el('span', `Tjedni predložak (${store.template.length})`, 'g-main g-title'), chevron());
  const list = el('div', undefined, 'g-list');
  list.hidden = true;
  store.template.forEach((entry, index) => {
    const item = row(main(`${DAY_NAMES[entry.dayOfWeek - 1]} ${entry.time} ${entry.name}`, store.instructors.find((i) => i.id === entry.instructorId)?.name));
    const remove = el('button', 'Makni', 'g-text destructive');
    remove.setAttribute('aria-label', `Makni iz predloška: ${entry.name}`);
    remove.addEventListener('click', () => {
      if (act(() => removeTemplateEntry(store, index), false)) collapse(item).then(render);
    });
    item.append(remove);
    list.append(item);
  });
  foldToggle(listToggle, list);

  const addToggle = el('button', undefined, 'g-row g-action');
  addToggle.type = 'button';
  addToggle.setAttribute('aria-expanded', 'false');
  addToggle.append(el('span', 'Dodaj termin', 'g-main g-title'), chevron());
  const form = el('form', undefined, 'g-form wrap');
  form.hidden = true;
  const day = el('select', undefined, 'g-select');
  day.setAttribute('aria-label', 'Dan');
  for (const [value, text] of days) {
    const option = el('option', text);
    option.value = value;
    day.append(option);
  }
  const time = el('input', undefined, 'g-input');
  time.type = 'time';
  time.value = '18:00';
  time.setAttribute('aria-label', 'Vrijeme');
  const name = el('input', undefined, 'g-input g-name');
  name.placeholder = 'Ime treninga';
  name.setAttribute('aria-label', 'Ime treninga');
  const instructor = el('select', undefined, 'g-select');
  instructor.setAttribute('aria-label', 'Instruktor');
  for (const [value, text] of instructors) {
    const option = el('option', text);
    option.value = value;
    instructor.append(option);
  }
  const submit = el('button', 'Dodaj', 'btn');
  submit.type = 'submit';
  form.append(name, day, time, instructor, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ok = act(() => {
      addTemplateEntry(store, { dayOfWeek: Number(day.value), time: time.value, name: name.value, instructorId: instructor.value });
      generateUpcoming(store, new Date());
    }, false);
    if (ok) collapse(form).then(render);
  });
  foldToggle(addToggle, form, name);
  template.append(listToggle, list, addToggle, form);
  section.append(template);

  // The studio cancels a class.
  const cancel = el('div', undefined, 'group');
  const classes = upcomingClasses(now);
  const picker = selectRow('Otkaži trening', classes.map((c) => [c.id, classLabel(c)]), classes[0]?.id ?? '', () => {});
  const go = el('button', 'Otkaži odabrani trening', 'g-row g-action destructive');
  go.type = 'button';
  go.disabled = classes.length === 0;
  go.addEventListener('click', () => {
    const picked = classes.find((c) => c.id === picker.querySelector('select').value);
    const booked = store.bookings.filter((b) => b.classId === picked.id && b.status === 'booked').length;
    if (!window.confirm(`Otkazati trening ${picked.name}?\nRezervacija: ${booked}. Svi dobivaju ${creditsEnabled(store) ? 'kredit natrag i ' : ''}mail.`)) return;
    let result;
    act(() => {
      result = cancelClass(store, picked.id, new Date());
    }, true, () => (creditsEnabled(store) ? `Trening otkazan. Kredit vraćen: ${result.cancelledBookings}.` : `Trening otkazan. Obaviješteno: ${result.cancelledBookings}.`));
  });
  cancel.append(picker, go);
  section.append(cancel);

  // The owner edits one class in one week. Riders who booked it get a mail.
  const edit = el('div', undefined, 'group');
  const editForm = el('form', undefined, 'g-form wrap');
  const editName = el('input', undefined, 'g-input g-name');
  editName.setAttribute('aria-label', 'Ime treninga za uređivanje');
  const editTime = el('input', undefined, 'g-input');
  editTime.type = 'time';
  editTime.setAttribute('aria-label', 'Vrijeme treninga za uređivanje');
  const editInstructor = el('select', undefined, 'g-select');
  editInstructor.setAttribute('aria-label', 'Instruktor treninga za uređivanje');
  for (const instructor of store.instructors) {
    const option = el('option', instructor.name);
    option.value = instructor.id;
    editInstructor.append(option);
  }
  const editTheme = el('input', undefined, 'g-input');
  editTheme.placeholder = 'Tema (nije obavezno)';
  editTheme.setAttribute('aria-label', 'Tema treninga za uređivanje');
  const editBikes = el('input', undefined, 'g-input');
  editBikes.type = 'number';
  editBikes.min = '1';
  editBikes.max = '20';
  editBikes.setAttribute('aria-label', 'Broj bicikala na treningu');
  const save = el('button', 'Spremi', 'btn');
  save.type = 'submit';
  const bikesField = el('label', undefined, 'g-field');
  bikesField.append(editBikes, el('span', 'bicikala'));
  editForm.append(editName, editTime, bikesField, editInstructor, editTheme, save);
  const fill = (id) => {
    const picked = classes.find((c) => c.id === id);
    if (!picked) return;
    editName.value = picked.name;
    editTime.value = timeFormat.format(new Date(picked.startsAt));
    editInstructor.value = picked.instructorId;
    editTheme.value = picked.themeName ?? '';
    editBikes.value = picked.bikeCount;
  };
  const editPicker = selectRow('Uredi trening', classes.map((c) => [c.id, classLabel(c)]), classes[0]?.id ?? '', (select) => fill(select.value));
  fill(classes[0]?.id);
  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = editPicker.querySelector('select').value;
    if (!id) return;
    act(() => editClass(store, { classId: id, name: editName.value, time: editTime.value, instructorId: editInstructor.value, themeName: editTheme.value.trim(), bikeCount: Number(editBikes.value), now: new Date() }), true, 'Trening je uređen.');
  });
  edit.append(editPicker, editForm);
  section.append(edit);
}

// What is owed for late cancels and no-shows. Only while there are no credits, since a credit already covers it.
function renderOwed() {
  const section = $('owed');
  const on = !creditsEnabled(store);
  for (const node of [$('owed-title'), section, $('owed-note')]) node.hidden = !on;
  section.replaceChildren();
  if (!on) return;
  const owed = owedClasses(store);
  if (owed.length === 0) {
    section.append(row(el('span', 'Ništa za naplatiti.', 'g-sub')));
    return;
  }
  for (const { booking, session, account } of owed) {
    const what = booking.status === 'late_cancel' ? 'Kasno otkazano' : 'No-show';
    const charged = el('button', 'Naplaćeno', 'g-text accent');
    charged.setAttribute('aria-label', `Naplaćeno ${account.name}, ${what} · ${classLabel(session)}`);
    charged.addEventListener('click', () => act(() => markCharged(store, booking.id, new Date()), true, 'Označeno kao naplaćeno.'));
    section.append(row(main(account.name, `${what} · ${classLabel(session)}`), charged));
  }
}

const slotDate = (date) => dayFormat.format(new Date(studioTime.toUtc(`${date}T12:00`)));
const slotHour = (hour) => `${String(hour).padStart(2, '0')}:00 - ${String(hour + 1).padStart(2, '0')}:00`;
// "2026-11-20" as "20.11." (no space after the dot).
const shortDate = (date) => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}.`;

function sculptWarning(status) {
  if (status.status === 'lapsed') return `${monthLabel(status.month)} nije plaćen.`;
  if (status.status === 'ending') return `Plaćeno do kraja mjeseca, još ${status.daysLeft + 1} dana. Označi sljedeći mjesec.`;
  return null;
}

function renderTrainer(trainer, now) {
  const group = el('div', undefined, 'group');
  const warning = sculptWarning(rentalStatus(store, trainer.id, now));
  const head = row(main(trainer.name, trainer.email, warning));
  if (warning) head.classList.add('credit-warning');
  group.append(head);

  const paid = store.sculpt.paidMonths.filter((p) => p.trainerId === trainer.id).sort((a, b) => a.month.localeCompare(b.month));
  for (const entry of paid) {
    const detail = `Plaćeno ${shortDate(entry.paidOn)} · ${entry.amountEur} €${entry.note ? ` · ${entry.note}` : ''}`;
    const item = row(main(`${monthLabel(entry.month)} ${entry.month.slice(0, 4)}`, detail));
    const undo = el('button', 'Poništi', 'g-text destructive');
    undo.setAttribute('aria-label', `Poništi plaćanje: ${trainer.name}, ${monthLabel(entry.month)}`);
    undo.addEventListener('click', () => {
      if (!window.confirm(`Poništiti plaćanje za ${monthLabel(entry.month)} (${trainer.name})?\nVeć rezervirani sati ostaju, novi se ne mogu rezervirati.`)) return;
      act(() => unmarkMonthPaid(store, { trainerId: trainer.id, month: entry.month }));
    });
    item.append(undo);
    group.append(item);
  }

  const thisMonth = monthOf(studioTime.localDate(now.toISOString()));
  const options = [thisMonth, nextMonth(thisMonth), nextMonth(nextMonth(thisMonth))]
    .filter((m) => !paid.some((p) => p.month === m))
    .map((m) => [m, `${monthLabel(m)} ${m.slice(0, 4)}`]);
  if (options.length > 0) {
    const form = el('form', undefined, 'g-form wrap');
    const month = el('select', undefined, 'g-select');
    month.setAttribute('aria-label', 'Mjesec');
    for (const [value, text] of options) month.append(Object.assign(el('option', text), { value }));
    const note = el('input', undefined, 'g-input g-name');
    note.placeholder = 'Napomena (npr. gotovina)';
    note.setAttribute('aria-label', 'Napomena');
    const submit = el('button', 'Označi plaćeno', 'btn');
    submit.type = 'submit';
    form.append(month, note, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      act(() => markMonthPaid(store, { trainerId: trainer.id, month: month.value, note: note.value.trim(), now: new Date() }));
    });
    group.append(form);
  }
  return group;
}

function renderSculpt(now) {
  const section = $('sculpt');
  section.replaceChildren();
  for (const trainer of store.sculpt.trainers) section.append(renderTrainer(trainer, now));

  // Booked hours, with the owner's remove.
  section.append(el('h3', 'Rezervirani sati', 'g-header'));
  const booked = el('div', undefined, 'group');
  const today = studioTime.localDate(now.toISOString());
  const upcoming = store.sculpt.slots
    .filter((slot) => slot.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  if (upcoming.length === 0) booked.append(row(el('span', 'Nema rezerviranih sati.', 'g-sub')));
  for (const slot of upcoming) {
    const trainer = store.sculpt.trainers.find((t) => t.id === slot.trainerId);
    const item = row(main(trainer.name, `${slotDate(slot.date)} ${slotHour(slot.hour)}`));
    const remove = el('button', 'Makni', 'g-text destructive');
    remove.setAttribute('aria-label', `Makni termin: ${trainer.name}, ${slotDate(slot.date)} ${slotHour(slot.hour)}`);
    remove.addEventListener('click', () => {
      const reason = window.prompt('Razlog za micanje termina:');
      if (!reason || !reason.trim()) return;
      if (!window.confirm(`Maknuti termin ${slotDate(slot.date)} ${slotHour(slot.hour)} (${trainer.name})?\nTrener dobiva mail.`)) return;
      act(() => removeSlot(store, { slotId: slot.id, reason: reason.trim(), now: new Date() }));
    });
    item.append(remove);
    booked.append(item);
  }
  section.append(booked);

  // Closed days: the room cannot be booked on them.
  section.append(el('h3', 'Zatvoreni dani', 'g-header'));
  const closed = el('div', undefined, 'group');
  for (const date of store.sculpt.closedDays) {
    const item = row(el('span', slotDate(date), 'g-main g-title'));
    const open = el('button', 'Makni', 'g-text destructive');
    open.setAttribute('aria-label', `Makni zatvoreni dan ${slotDate(date)}`);
    open.addEventListener('click', () => act(() => removeClosedDay(store, date)));
    item.append(open);
    closed.append(item);
  }
  const form = el('form', undefined, 'g-form wrap');
  const date = el('input', undefined, 'g-input');
  date.type = 'date';
  date.min = today;
  date.required = true;
  date.setAttribute('aria-label', 'Datum');
  const submit = el('button', 'Zatvori dan', 'btn');
  submit.type = 'submit';
  form.append(date, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    act(() => addClosedDay(store, date.value));
  });
  closed.append(form);
  section.append(closed);
}

function renderMails() {
  const section = $('mails');
  section.replaceChildren();
  if (store.outbox.length === 0) {
    section.append(row(el('span', 'Još nema poslanih mailova.', 'g-sub')));
    seen.mails = new Set();
    return;
  }
  const shown = new Set();
  for (const mail of [...store.outbox].reverse().slice(0, 8)) {
    const text = main(mail.subject, `Za: ${mail.to}`, mail.body);
    if (mail.action) {
      const link = el('a', mail.action.label, 'g-link');
      link.href = mail.action.url;
      text.append(link);
    }
    const item = row(text);
    item.classList.add('g-mail');
    section.append(growIn('mails', `${mail.sentAt} ${mail.to} ${mail.subject}`, item, shown));
  }
  seen.mails = shown;
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
  keepFocus(draw);
}

function draw() {
  const now = new Date();
  renderAccounts(now);
  renderBookings(now);
  renderOwed();
  renderPacks();
  renderSchedule(now);
  renderSculpt(now);
  renderMails();
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

$('remind').addEventListener('click', () => {
  act(() => {
    sendReminders(store, new Date(), location.origin + location.pathname);
    sendMilestoneNotes(store, new Date());
  });
});

function renderCreditsMode() {
  $('credits').textContent = creditsEnabled(store) ? 'Način: Q1, s kreditima (promijeni na prosinac)' : 'Način: prosinac, bez kredita (promijeni na Q1)';
}
$('credits').addEventListener('click', () => {
  act(() => {
    store.settings.credits = !creditsEnabled(store);
  }, false);
  renderCreditsMode();
});
renderCreditsMode();

render();
