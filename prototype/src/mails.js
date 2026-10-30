import { hrDate } from './time.js';

// Working name from ADR 0005, not final.
export const APP_URL = 'https://rezervacije.tockicanai.hr/';
const HOUR_MS = 60 * 60 * 1000;
const timeFormat = hrDate({ hour: '2-digit', minute: '2-digit' });
const dateFormat = hrDate({ weekday: 'long', day: 'numeric', month: 'numeric' });

const firstName = (account) => account.name.split(' ')[0];
const when = (session) => `${dateFormat.format(new Date(session.startsAt))} u ${timeFormat.format(new Date(session.startsAt))}`;
const bike = (booking) => `bicikl ${booking.bikeNo}${booking.guestName ? ` (${booking.guestName})` : ''}`;

// Mail texts for one booking. `deadline` is the last moment a cancel is free.
// The late-cancel line says a class is charged, which is true with and without credits.
export function confirmationMail(store, booking, session, account, deadline) {
  const hours = (Date.parse(session.startsAt) - deadline.getTime()) / HOUR_MS;
  return {
    to: account.email,
    subject: `Rezervirano: ${session.name}`,
    body: `Bok ${firstName(account)},\n\nrezervirano: ${session.name}, ${when(session)}, ${bike(booking)}.\n\nOtkazivanje je besplatno do ${timeFormat.format(deadline)}, ${dateFormat.format(deadline)} (${hours} sati prije treninga).\n\nTočkica na i`,
    action: { label: 'Otkaži rezervaciju', url: `${store.settings.appUrl ?? APP_URL}#racun/otkazi/${booking.id}` },
  };
}

export function cancellationMail(booking, session, account, free, hours) {
  const outcome = free
    ? 'Otkazano na vrijeme, bez naplate.'
    : `Otkazano manje od ${hours} sati prije treninga, naplaćuje se jedan trening.`;
  return {
    to: account.email,
    subject: `Otkazano: ${session.name}`,
    body: `Bok ${firstName(account)},\n\notkazana je rezervacija: ${session.name}, ${when(session)}, ${bike(booking)}.\n\n${outcome}\n\nTočkica na i`,
  };
}
