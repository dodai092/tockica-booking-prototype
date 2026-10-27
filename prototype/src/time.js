const STUDIO_TZ = 'Europe/Zagreb';

const WEEKDAY_NUMBER = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDIO_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const weekdayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDIO_TZ,
  weekday: 'short',
});

// en-CA formats dates as YYYY-MM-DD.
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Offset of studio wall time from UTC at a given instant, in ms.
function zagrebOffsetMs(utcMs) {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(new Date(utcMs)).map((p) => [p.type, Number(p.value)]),
  );
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallAsUtc - (utcMs - (utcMs % 1000));
}

export const studioTime = {
  // "YYYY-MM-DDTHH:mm" in Europe/Zagreb wall time to UTC ISO string.
  toUtc(localIso) {
    const [datePart, timePart] = localIso.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const firstGuess = wallAsUtc - zagrebOffsetMs(wallAsUtc);
    const corrected = wallAsUtc - zagrebOffsetMs(firstGuess);
    return new Date(corrected).toISOString();
  },

  // 1 for Monday through 7 for Sunday, in studio time.
  dayOfWeek(iso) {
    return WEEKDAY_NUMBER[weekdayFormat.format(new Date(iso))];
  },

  // "YYYY-MM-DD" studio date of a UTC instant.
  localDate(iso) {
    return dateFormat.format(new Date(iso));
  },

  // Adds whole days to a "YYYY-MM-DD" studio date.
  addDays(ymd, days) {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  },
};
