import { getLang } from './i18n.js';

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

// Studio date formatter. Numbers always use the Croatian pattern ("29.10.", 24-hour time), without the space
// after the dot ("29. 10." becomes "29.10."). In English, weekday and month names come from en-GB.
export function hrDate(options) {
  const numeric = new Intl.DateTimeFormat('hr-HR', { timeZone: STUDIO_TZ, ...options });
  const namedMonth = options.month === 'long' || options.month === 'short';
  const englishName = (type, date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: STUDIO_TZ, [type]: options[type] })
      .formatToParts(date).find((part) => part.type === type).value;
  return {
    format(date) {
      const english = getLang() === 'en';
      const text = numeric.formatToParts(date).map((part) => {
        const isName = part.type === 'weekday' || (part.type === 'month' && namedMonth);
        return english && isName ? englishName(part.type, date) : part.value;
      }).join('');
      return text.replace(/\.\s(?=\d{1,4}\.)/g, '.');
    },
  };
}
