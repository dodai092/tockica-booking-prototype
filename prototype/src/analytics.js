// Owner analytics: which slots and instructors are busiest, and how many classes each client has ridden.
// Popularity counts every rider on a booking (guests fill bikes too). Rides count only the account
// holder's own attended classes, so a guest never moves someone toward the 50th or 100th class.
const DEMAND = ['booked', 'attended', 'no_show'];
export const MILESTONES = [50, 100];

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekdayNumber = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', weekday: 'short' });

function demandByClass(store) {
  const counts = new Map();
  for (const booking of store.bookings) {
    if (DEMAND.includes(booking.status)) counts.set(booking.classId, (counts.get(booking.classId) ?? 0) + 1);
  }
  return counts;
}

const byCount = (a, b) => b.count - a.count;

// Busiest weekly slots (weekday and start time), most booked first.
export function popularSlots(store) {
  const slots = new Map();
  for (const [classId, count] of demandByClass(store)) {
    const session = store.classes.find((c) => c.id === classId);
    if (!session) continue;
    const date = new Date(session.startsAt);
    const dayOfWeek = weekdayNumber[weekdayFormat.format(date)];
    const time = timeFormat.format(date);
    const key = `${dayOfWeek} ${time}`;
    slots.set(key, { dayOfWeek, time, count: (slots.get(key)?.count ?? 0) + count });
  }
  return [...slots.values()].sort(byCount);
}

// Busiest instructors, most booked first.
export function popularInstructors(store) {
  const totals = new Map();
  for (const [classId, count] of demandByClass(store)) {
    const session = store.classes.find((c) => c.id === classId);
    if (session) totals.set(session.instructorId, (totals.get(session.instructorId) ?? 0) + count);
  }
  return [...totals]
    .map(([id, count]) => ({ id, name: store.instructors.find((i) => i.id === id)?.name ?? '', count }))
    .sort(byCount);
}

// Attended classes per account holder, with the next milestone (50th, then 100th), how far off it is,
// and `milestone` when the count sits exactly on one (time to celebrate).
export function clientRides(store) {
  return store.accounts.map((account) => {
    const rides = store.bookings.filter((b) => b.accountId === account.id && b.status === 'attended' && !b.guestName).length;
    const next = MILESTONES.find((m) => m > rides) ?? null;
    return { accountId: account.id, name: account.name, rides, next, toNext: next ? next - rides : 0, milestone: MILESTONES.includes(rides) ? rides : null };
  });
}
