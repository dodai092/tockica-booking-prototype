import { studioTime, hrDate } from './time.js';
import { cancelDeadline } from './booking.js';
import { send } from './outbox.js';

// Working name from ADR 0005, not final.
const APP_URL = 'https://rezervacije.tockicanai.hr/';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const timeFormat = hrDate({ hour: '2-digit', minute: '2-digit' });
const dateFormat = hrDate({ weekday: 'long', day: 'numeric', month: 'numeric' });

// "danas" or "sutra", for a moment within the next day.
const dayWord = (when, now) => (studioTime.localDate(when.toISOString()) === studioTime.localDate(now.toISOString()) ? 'danas' : 'sutra');

// "bicikl 4" or "bicikli 4, 5 (Ana)": a guest's bike carries the guest's name.
function bikeList(bookings) {
  const bikes = bookings.map((b) => (b.guestName ? `${b.bikeNo} (${b.guestName})` : String(b.bikeNo)));
  return `${bookings.length === 1 ? 'bicikl' : 'bicikli'} ${bikes.join(', ')}`;
}

// Mails every account with booked bikes in a class that starts within the next 24 hours, one mail per account
// and class. Each booking is mailed once, so this can run as often as the scheduler likes. Real sending waits for the backend.
// The cancel link travels as `action`, so the mail shows a button instead of a bare URL.
// The late-cancel line says a class is charged, which is true with and without credits.
export function sendReminders(store, now, baseUrl = APP_URL) {
  const groups = new Map();
  for (const booking of store.bookings) {
    if (booking.status !== 'booked' || booking.reminderSentAt) continue;
    const session = store.classes.find((c) => c.id === booking.classId);
    const start = Date.parse(session.startsAt);
    if (session.cancelled || start <= now.getTime() || start > now.getTime() + DAY_MS) continue;
    const key = `${booking.classId}|${booking.accountId}`;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }

  const mails = [];
  for (const bookings of groups.values()) {
    const session = store.classes.find((c) => c.id === bookings[0].classId);
    const account = store.accounts.find((a) => a.id === bookings[0].accountId);
    const start = new Date(session.startsAt);
    const deadline = cancelDeadline(session);
    const hours = (start - deadline) / HOUR_MS;
    const cancelLine = now <= deadline
      ? `Otkazivanje je besplatno do ${timeFormat.format(deadline)} ${dayWord(deadline, now)} (${hours} sati prije treninga). Nakon toga se naplaćuje jedan trening.`
      : 'Besplatno otkazivanje je prošlo, naplaćuje se jedan trening.';
    const day = dayWord(start, now);
    const subjectWhen = `${day[0].toUpperCase()}${day.slice(1)} u ${timeFormat.format(start)}`;
    const mail = send(
      store,
      {
        to: account.email,
        subject: `${subjectWhen}: ${session.name}`,
        body: `Bok ${account.name.split(' ')[0]},\n\n${day} (${dateFormat.format(start)}) u ${timeFormat.format(start)} te čeka ${session.name}, ${bikeList(bookings)}.\n\n${cancelLine}\n\nTočkica na i`,
      },
      now,
    );
    // One link per mail: a multi-bike mail points at the first booking, and Moj profil lists the rest.
    mail.action = { label: 'Otkaži rezervaciju', url: `${baseUrl}#racun/otkazi/${bookings[0].id}` };
    mails.push(mail);
    for (const booking of bookings) booking.reminderSentAt = now.toISOString();
  }
  return mails;
}

// Where owner notes go. A studio setting once there is a real mailbox for it.
const OWNER_EMAIL = 'info@tockicanai.hr';
const MILESTONES = [50, 100];

// The day before a rider's 50th or 100th class, the owner gets one mail so she can mark it. Guest rides do not count.
export function sendMilestoneNotes(store, now) {
  const mails = [];
  for (const booking of store.bookings) {
    if (booking.status !== 'booked' || booking.guestName || booking.milestoneNotedAt) continue;
    const session = store.classes.find((c) => c.id === booking.classId);
    const start = new Date(session.startsAt);
    if (session.cancelled || start <= now || start.getTime() > now.getTime() + DAY_MS) continue;

    const rides = store.bookings.filter((b) => b.accountId === booking.accountId && b.status === 'attended' && !b.guestName).length;
    const milestone = MILESTONES.find((m) => m === rides + 1);
    if (!milestone) continue;

    const account = store.accounts.find((a) => a.id === booking.accountId);
    mails.push(send(
      store,
      {
        to: OWNER_EMAIL,
        subject: `${milestone}. trening: ${account.name}`,
        body: `${dayWord(start, now)[0].toUpperCase()}${dayWord(start, now).slice(1)} u ${timeFormat.format(start)} (${session.name}) ${account.name} dolazi na svoj ${milestone}. trening.`,
      },
      now,
    ));
    booking.milestoneNotedAt = now.toISOString();
  }
  return mails;
}
