import { newId } from './model.js';
import { studioTime } from './time.js';
import { send } from './outbox.js';

// Sculpt Room: trainers rent it one calendar month at a time and book whole hours.
// Messages are Croatian because they are shown to the trainer as they are.
export class SculptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SculptError';
    this.code = code;
  }
}

const monthName = new Intl.DateTimeFormat('hr-HR', { timeZone: 'UTC', month: 'long' });
export const monthLabel = (month) => monthName.format(new Date(`${month}-15T12:00:00Z`));
const hoursText = (n) => `${n} ${n === 1 ? 'sat' : 'sata'}`;

export const monthOf = (date) => date.slice(0, 7);
const todayOf = (now) => studioTime.localDate(now.toISOString());
const startOf = (date, hour) => Date.parse(studioTime.toUtc(`${date}T${String(hour).padStart(2, '0')}:00`));
const isPaid = (store, trainerId, month) => store.sculpt.paidMonths.some((p) => p.trainerId === trainerId && p.month === month);
const trainerOf = (store, trainerId) => store.sculpt.trainers.find((t) => t.id === trainerId);

export function nextMonth(month) {
  const [year, m] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

// Why this hour cannot be booked by this trainer, or null when it can. The slot being taken
// is checked by the callers that need to tell "mine" from "someone else's".
function problem(store, { trainerId, date, hour, now }) {
  const { settings, closedDays, slots } = store.sculpt;
  if (!Number.isInteger(hour) || hour < settings.openHour || hour >= settings.closeHour) {
    return ['hour_range', 'Sat je izvan radnog vremena.'];
  }
  if (startOf(date, hour) <= now.getTime()) return ['past', 'Taj sat je prošao.'];
  if (date > studioTime.addDays(todayOf(now), settings.daysAhead)) {
    return ['too_far', `Moguće je rezervirati do ${settings.daysAhead} dana unaprijed.`];
  }
  if (closedDays.includes(date)) return ['closed_day', 'Studio je taj dan zatvoren.'];
  if (!isPaid(store, trainerId, monthOf(date))) {
    const label = monthLabel(monthOf(date));
    return ['unpaid', `${label[0].toUpperCase()}${label.slice(1)} nije plaćen. Javi se vlasnici.`];
  }
  if (slots.some((s) => s.date === date && s.hour === hour)) return ['taken', 'Sat je već zauzet.'];
  const mine = slots.filter((s) => s.trainerId === trainerId && s.date === date).length;
  if (mine >= settings.maxHoursPerDay) return ['day_full', `Najviše ${hoursText(settings.maxHoursPerDay)} dnevno.`];
  return null;
}

export function bookSlot(store, { trainerId, date, hour, now }) {
  const found = problem(store, { trainerId, date, hour, now });
  if (found) throw new SculptError(...found);
  const slot = { id: newId('slot'), trainerId, date, hour };
  store.sculpt.slots.push(slot);
  return slot;
}

// A trainer gives back their own slot, any time before it starts.
export function cancelSlot(store, { slotId, trainerId, now }) {
  const slot = store.sculpt.slots.find((s) => s.id === slotId);
  if (!slot || slot.trainerId !== trainerId) throw new SculptError('not_yours', 'To nije tvoj termin.');
  if (startOf(slot.date, slot.hour) <= now.getTime()) throw new SculptError('past', 'Taj sat je prošao.');
  store.sculpt.slots.splice(store.sculpt.slots.indexOf(slot), 1);
}

// The owner removes a slot. The trainer is told why.
export function removeSlot(store, { slotId, reason, now }) {
  const slot = store.sculpt.slots.find((s) => s.id === slotId);
  if (!slot) throw new SculptError('missing', 'Termin ne postoji.');
  const trainer = trainerOf(store, slot.trainerId);
  store.sculpt.slots.splice(store.sculpt.slots.indexOf(slot), 1);
  const when = `${Number(slot.date.slice(8))}.${Number(slot.date.slice(5, 7))}. u ${String(slot.hour).padStart(2, '0')}:00`;
  send(store, {
    to: trainer.email,
    subject: 'Tvoj termin u Sculpt Roomu je uklonjen',
    body: `Termin ${when} je uklonjen. Razlog: ${reason}.`,
  }, now);
  return slot;
}

// The owner marks a month paid (cash today). The record keeps date, amount and a note.
export function markMonthPaid(store, { trainerId, month, now, note = '' }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new SculptError('bad_month', 'Mjesec mora biti oblika GGGG-MM.');
  if (isPaid(store, trainerId, month)) throw new SculptError('already_paid', `${monthLabel(month)} je već plaćen.`);
  const entry = { trainerId, month, paidOn: todayOf(now), amountEur: store.sculpt.settings.rentalEur, note };
  store.sculpt.paidMonths.push(entry);
  return entry;
}

// Slots already booked in that month stay. Only new bookings are blocked.
export function unmarkMonthPaid(store, { trainerId, month }) {
  const { paidMonths } = store.sculpt;
  const index = paidMonths.findIndex((p) => p.trainerId === trainerId && p.month === month);
  if (index === -1) throw new SculptError('not_paid', 'Taj mjesec nije označen kao plaćen.');
  paidMonths.splice(index, 1);
}

export function addClosedDay(store, date) {
  const { closedDays, slots } = store.sculpt;
  if (closedDays.includes(date)) return;
  if (slots.some((s) => s.date === date)) throw new SculptError('has_slots', 'Taj dan već ima rezervacije. Prvo ih makni.');
  closedDays.push(date);
  closedDays.sort();
}

export function removeClosedDay(store, date) {
  store.sculpt.closedDays = store.sculpt.closedDays.filter((d) => d !== date);
}

// What the trainer's hour list shows for one hour.
export function cellState(store, trainerId, date, hour, now) {
  const slot = store.sculpt.slots.find((s) => s.date === date && s.hour === hour);
  if (slot?.trainerId === trainerId) return { state: 'mine', slot };
  if (slot) return { state: 'taken', slot, by: trainerOf(store, slot.trainerId).name.split(' ')[0] };
  const found = problem(store, { trainerId, date, hour, now });
  return found ? { state: 'blocked', code: found[0], reason: found[1] } : { state: 'free' };
}

export function mySlots(store, trainerId, now) {
  return store.sculpt.slots
    .filter((s) => s.trainerId === trainerId && startOf(s.date, s.hour) > now.getTime())
    .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}

// Today and every day up to the booking limit.
export function bookableDates(store, now) {
  const today = todayOf(now);
  return Array.from({ length: store.sculpt.settings.daysAhead + 1 }, (_, i) => studioTime.addDays(today, i));
}

// For the owner's reminder: this month unpaid is "lapsed", the last week of the last paid month is "ending".
export function rentalStatus(store, trainerId, now) {
  const today = todayOf(now);
  const month = monthOf(today);
  const lastDay = studioTime.addDays(`${nextMonth(month)}-01`, -1);
  const daysLeft = (Date.parse(lastDay) - Date.parse(today)) / 86400000;
  if (!isPaid(store, trainerId, month)) return { status: 'lapsed', month };
  if (!isPaid(store, trainerId, nextMonth(month)) && daysLeft < 7) return { status: 'ending', month, daysLeft };
  return { status: 'ok', month };
}
