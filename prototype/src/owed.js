// December has no credits, so a late cancel or a no-show is charged by hand. This is the list of what is still owed.
const OWED = ['late_cancel', 'no_show'];

export function owedClasses(store) {
  return store.bookings
    .filter((b) => OWED.includes(b.status) && !b.chargedAt)
    .map((booking) => ({
      booking,
      session: store.classes.find((c) => c.id === booking.classId),
      account: store.accounts.find((a) => a.id === booking.accountId),
    }))
    .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
}

export function markCharged(store, bookingId, now) {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!OWED.includes(booking.status)) throw new Error(`Booking ${bookingId} is ${booking.status}`);
  booking.chargedAt = now.toISOString();
  return booking;
}
