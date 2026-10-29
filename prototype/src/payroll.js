// Monthly instructor report: classes taught, substitutions, pay and the attendance bonus.
// Pay is for classes that have ended and were not cancelled, at the rate of whoever actually taught.
import { studioTime, hrDate } from './time.js';

const MIN_MS = 60 * 1000;

export class PayrollError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayrollError';
  }
}

// Who actually taught: the substitute if there is one, else the scheduled instructor.
export const taughtBy = (session) => session.actualInstructorId ?? session.instructorId;

// The rate in force on a studio date ("YYYY-MM-DD"): the latest entry that started on or before it.
export function rateOn(instructor, date) {
  const rates = (instructor.rates ?? []).filter((r) => r.from <= date).sort((a, b) => a.from.localeCompare(b.from));
  return rates.at(-1)?.eur ?? 0;
}

export function setActualInstructor(store, classId, instructorId) {
  const session = store.classes.find((c) => c.id === classId);
  if (!session) throw new PayrollError(`Unknown class ${classId}`);
  if (!store.instructors.some((i) => i.id === instructorId)) throw new PayrollError(`Unknown instructor ${instructorId}`);
  if (instructorId === session.instructorId) delete session.actualInstructorId;
  else session.actualInstructorId = instructorId;
}

// A change applies from `from` on. Changing it again the same day replaces that entry.
export function setInstructorRate(store, instructorId, eur, from) {
  const instructor = store.instructors.find((i) => i.id === instructorId);
  if (!instructor) throw new PayrollError(`Unknown instructor ${instructorId}`);
  if (!Number.isFinite(eur) || eur < 0) throw new PayrollError('Rate must be zero or more');
  instructor.rates = (instructor.rates ?? []).filter((r) => r.from !== from);
  instructor.rates.push({ from, eur });
  instructor.rates.sort((a, b) => a.from.localeCompare(b.from));
}

export function setBonusSettings(store, { threshold, eur }) {
  const bikes = store.classes[0]?.bikeCount ?? 20;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > bikes) throw new PayrollError(`Threshold must be 0 to ${bikes}`);
  if (!Number.isFinite(eur) || eur < 0) throw new PayrollError('Bonus must be zero or more');
  store.settings.bonusThreshold = threshold;
  store.settings.bonusEur = eur;
}

// `month` is "YYYY-MM" in studio time, first day to last day.
export function monthReport(store, month, now) {
  const threshold = store.settings.bonusThreshold ?? 15;
  const bonusEur = store.settings.bonusEur ?? 2;
  const rows = store.instructors.map((instructor) => ({
    instructorId: instructor.id, name: instructor.name, taught: 0, substitutedIn: 0, substitutedOut: 0,
    cancelled: 0, upcoming: 0, riders: 0, fee: 0, bonus: 0, total: 0, classes: [],
  }));
  const byId = new Map(rows.map((r) => [r.instructorId, r]));
  const needsCheckIn = [];

  const inMonth = store.classes
    .filter((c) => studioTime.localDate(c.startsAt).slice(0, 7) === month)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  for (const session of inMonth) {
    const date = studioTime.localDate(session.startsAt);
    const actualId = taughtBy(session);
    const attended = store.bookings.filter((b) => b.classId === session.id && b.status === 'attended').length;
    const ended = Date.parse(session.startsAt) + session.durationMin * MIN_MS <= now.getTime();
    const status = session.cancelled ? 'cancelled' : ended ? 'done' : 'upcoming';
    const open = store.bookings.filter((b) => b.classId === session.id && b.status === 'booked').length;
    if (status === 'done' && open) needsCheckIn.push({ classId: session.id, name: session.name, startsAt: session.startsAt, open });
    const base = { classId: session.id, startsAt: session.startsAt, name: session.name, scheduledId: session.instructorId, actualId, attended, bikeCount: session.bikeCount, status };

    const scheduled = byId.get(session.instructorId);
    const actual = byId.get(actualId);
    if (session.cancelled) {
      if (scheduled) { scheduled.cancelled += 1; scheduled.classes.push({ ...base, role: 'cancelled', fee: 0, bonus: 0 }); }
      continue;
    }
    if (actualId !== session.instructorId && scheduled) {
      scheduled.classes.push({ ...base, role: 'out', fee: 0, bonus: 0 });
      scheduled.substitutedOut += 1;
    }
    if (!actual) continue;
    const role = actualId === session.instructorId ? 'taught' : 'in';
    if (status === 'upcoming') {
      actual.upcoming += 1;
      actual.classes.push({ ...base, role, fee: 0, bonus: 0 });
      continue;
    }
    const fee = rateOn(store.instructors.find((i) => i.id === actualId), date);
    const bonus = Math.max(0, attended - threshold) * bonusEur;
    actual.taught += 1;
    if (role === 'in') actual.substitutedIn += 1;
    actual.riders += attended;
    actual.fee += fee;
    actual.bonus += bonus;
    actual.classes.push({ ...base, role, fee, bonus });
  }

  for (const r of rows) {
    r.total = r.fee + r.bonus;
    r.classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return { month, threshold, bonusEur, rows, needsCheckIn };
}

// A month's payout, marked paid with the amount at that moment, so a later change is noticed.
export function setPaid(store, month, instructorId, { on, total, now }) {
  store.payouts ??= {};
  const key = `${month}:${instructorId}`;
  if (on) store.payouts[key] = { at: now.toISOString(), total };
  else delete store.payouts[key];
}

export const paidEntry = (store, month, instructorId) => store.payouts?.[`${month}:${instructorId}`] ?? null;

const euro = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' });
const lineDate = hrDate({ weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Plain text of one instructor's month, for sharing: the basis for their invoice.
export function summaryText(report, row, monthLabel, nameOf) {
  const lines = [
    `${monthLabel}: ${row.name}`,
    `Održano treninga: ${row.taught} (preuzeto: ${row.substitutedIn}, predano: ${row.substitutedOut})`,
    `Honorar: ${euro.format(row.fee)}`,
    `Bonus: ${euro.format(row.bonus)} (bicikli iznad ${report.threshold})`,
    `Ukupno: ${euro.format(row.total)}`,
    '',
    'Treninzi:',
  ];
  const tags = { out: (c) => `zamjena: ${nameOf(c.actualId)}`, in: (c) => `zamjena za ${nameOf(c.scheduledId)}`, cancelled: () => 'otkazano' };
  for (const c of row.classes) {
    const parts = [`${lineDate.format(new Date(c.startsAt))} ${c.name}`];
    if (c.role !== 'cancelled') parts.push(c.status === 'upcoming' ? 'predstoji' : `${c.attended}/${c.bikeCount} došlo`);
    if (c.fee + c.bonus) parts.push(euro.format(c.fee + c.bonus));
    if (tags[c.role]) parts.push(tags[c.role](c));
    lines.push(`- ${parts.join(', ')}`);
  }
  return lines.join('\n');
}
