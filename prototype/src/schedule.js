import { newId } from './model.js';
import { studioTime } from './time.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLASS_MIN = 60;

// Release instant (UTC ISO) on a given studio date, e.g. "2026-10-26".
function releaseOn(settings, ymd) {
  return studioTime.toUtc(`${ymd}T${String(settings.hour).padStart(2, '0')}:00`);
}

// Latest release at or before the instant, looking back at most one week.
function latestReleaseAtOrBefore(settings, iso) {
  const target = Date.parse(iso);
  const today = studioTime.localDate(iso);
  for (let back = 0; back <= 7; back += 1) {
    const day = studioTime.addDays(today, -back);
    const noonUtc = studioTime.toUtc(`${day}T12:00`);
    if (studioTime.dayOfWeek(noonUtc) !== settings.dayOfWeek) continue;
    const release = releaseOn(settings, day);
    if (Date.parse(release) <= target) return release;
  }
  throw new Error('No release found within a week');
}

export function releaseWindowOpensAt(settings, now) {
  return latestReleaseAtOrBefore(settings, now.toISOString());
}

export function nextRelease(settings, now) {
  // Releases are weekly, so the latest one within 7 days ahead is the next one after now.
  return latestReleaseAtOrBefore(settings, new Date(now.getTime() + 7 * DAY_MS).toISOString());
}

// Creates the classes for the week that starts on the Monday containing weekStartIso.
// Each class stores the release that opened it, so later template edits leave it alone.
export function generateWeek(store, weekStartIso) {
  const monday = studioTime.localDate(weekStartIso);
  for (const entry of store.template) {
    const day = studioTime.addDays(monday, entry.dayOfWeek - 1);
    if (store.sculpt?.closedDays.includes(day)) continue;
    const startsAt = studioTime.toUtc(`${day}T${entry.time}`);
    // A class the owner edited no longer matches its entry, so the entry's key keeps the week from refilling.
    const templateKey = `${startsAt}|${entry.name}|${entry.instructorId}`;
    const exists = store.classes.some(
      (c) => c.templateKey === templateKey
        || (c.startsAt === startsAt && c.name === entry.name && c.instructorId === entry.instructorId),
    );
    if (exists) continue;
    store.classes.push({
      id: newId('cls'),
      templateKey,
      name: entry.name,
      instructorId: entry.instructorId,
      themeName: entry.themeName,
      startsAt,
      durationMin: CLASS_MIN,
      bikeCount: 20,
      releaseOpensAt: latestReleaseAtOrBefore(
        store.settings,
        new Date(Date.parse(startsAt) - store.settings.weeksAhead * 7 * DAY_MS).toISOString(),
      ),
    });
  }
  return store.classes;
}

export function isBookable(session, now) {
  const t = now.getTime();
  return !session.cancelled && t >= Date.parse(session.releaseOpensAt) && t < Date.parse(session.startsAt);
}
