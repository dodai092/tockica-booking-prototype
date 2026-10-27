// Demo-only helpers for the owner page. They let the demo reach states that real use
// would take days to reach: a full class, and a class that is about to start.
import { newId } from './model.js';
import { grantPack } from './ledger.js';
import { bookBike, takenBikes } from './booking.js';

const SOON_MIN = 20;
const FILLER = { id: 'acc_demo', name: 'Demo punjenje', email: 'demo@example.com', multisportTag: false };

// A class starting in 20 minutes, bookable now.
export function addSoonClass(store, now) {
  const session = {
    id: newId('cls'),
    name: `Demo: za ${SOON_MIN} min`,
    instructorId: 'ins_1',
    themeName: null,
    startsAt: new Date(now.getTime() + SOON_MIN * 60 * 1000).toISOString(),
    durationMin: 60,
    bikeCount: 20,
    releaseOpensAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
  };
  store.classes.push(session);
  return session;
}

// Books every free bike in the class on a filler account, so the class is full.
export function fillClass(store, classId, now) {
  if (!store.accounts.some((a) => a.id === FILLER.id)) store.accounts.push({ ...FILLER });

  const free = 20 - takenBikes(store, classId).length;
  for (let i = 0; i < Math.ceil(free / 5); i += 1) grantPack(store, FILLER.id, 'pk_5', now);

  for (let bikeNo = 1; bikeNo <= 20; bikeNo += 1) {
    if (!takenBikes(store, classId).includes(bikeNo)) {
      bookBike(store, { classId, bikeNo, accountId: FILLER.id, now });
    }
  }
}
