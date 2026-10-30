import { hrDate, studioTime } from '../time.js';
import { bookSlot, cancelSlot, cellState, mySlots, bookableDates, SculptError } from '../sculpt.js';
import { loadStore, saveStore, getLogin } from './session.js';
import { showBanner, fadeIn } from './motion.js';

const dayFormat = hrDate({ weekday: 'short', day: '2-digit', month: '2-digit' });
// Reasons that hold for the whole day are said once above the list, not on every hour.
const DAY_LEVEL = ['unpaid', 'closed_day', 'too_far', 'day_full'];

const $ = (id) => document.getElementById('t-' + id);
const store = loadStore();
saveStore(store);
let day = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const hourText = (hour) => `${String(hour).padStart(2, '0')}:00 - ${String(hour + 1).padStart(2, '0')}:00`;
const dateText = (date) => dayFormat.format(new Date(studioTime.toUtc(`${date}T12:00`)));

function showMessage(text, isError = false) {
  showBanner($('message'), text, isError);
}

function act(action, text) {
  try {
    action();
    showMessage(text);
  } catch (err) {
    if (!(err instanceof SculptError)) throw err;
    showMessage(err.message, true);
  }
  saveStore(store);
  render();
}

function renderDayPicker(now) {
  const select = $('day');
  const dates = bookableDates(store, now);
  if (!day || !dates.includes(day)) day = dates[0];
  select.replaceChildren();
  for (const date of dates) {
    const suffix = date === dates[0] ? ' · danas' : store.sculpt.closedDays.includes(date) ? ' · zatvoreno' : '';
    const option = el('option', dateText(date) + suffix);
    option.value = date;
    option.selected = date === day;
    select.append(option);
  }
}

function renderHours(now, trainerId) {
  const { openHour, closeHour } = store.sculpt.settings;
  const cells = [];
  for (let hour = openHour; hour < closeHour; hour += 1) cells.push([hour, cellState(store, trainerId, day, hour, now)]);

  const dayLevel = cells.find(([, c]) => c.state === 'blocked' && DAY_LEVEL.includes(c.code));
  const notice = $('notice');
  notice.hidden = !dayLevel;
  notice.replaceChildren();
  if (dayLevel) notice.append(el('span', dayLevel[1].reason));

  const rows = cells.map(([hour, cell]) => {
    const row = el('div', undefined, 'g-row t-row');
    row.append(el('div', hourText(hour), 'g-main g-title'));
    if (cell.state === 'free') {
      const book = el('button', 'Rezerviraj', 'btn');
      book.setAttribute('aria-label', `Rezerviraj ${hourText(hour)}`);
      book.addEventListener('click', () => act(() => bookSlot(store, { trainerId, date: day, hour, now: new Date() }), `Rezervirano: ${dateText(day)}, ${hourText(hour)}.`));
      row.append(book);
    } else if (cell.state === 'mine') {
      row.append(el('span', 'Moj termin', 'pill pill-attended'), cancelButton(cell.slot, trainerId));
    } else if (cell.state === 'taken') {
      row.classList.add('off');
      row.append(el('span', cell.by, 'g-trail'));
    } else {
      row.classList.add('off');
      row.append(el('span', cell.code === 'past' ? 'prošlo' : 'nedostupno', 'g-trail'));
    }
    return row;
  });
  $('hours').replaceChildren(...rows);
}

function cancelButton(slot, trainerId) {
  const button = el('button', 'Otkaži', 'g-text destructive');
  button.setAttribute('aria-label', `Otkaži ${dateText(slot.date)}, ${hourText(slot.hour)}`);
  button.addEventListener('click', () => act(() => cancelSlot(store, { slotId: slot.id, trainerId, now: new Date() }), `Otkazano: ${dateText(slot.date)}, ${hourText(slot.hour)}.`));
  return button;
}

function renderMine(now, trainerId) {
  const slots = mySlots(store, trainerId, now);
  const rows = slots.map((slot) => {
    const row = el('div', undefined, 'g-row');
    const main = el('div', undefined, 'g-main');
    main.append(el('div', dateText(slot.date), 'g-title'), el('div', hourText(slot.hour), 'g-sub'));
    row.append(main, cancelButton(slot, trainerId));
    return row;
  });
  if (rows.length === 0) {
    const empty = el('div', undefined, 'g-row');
    empty.append(el('span', 'Još nemaš rezervacija.', 'g-sub'));
    rows.push(empty);
  }
  $('mine').replaceChildren(...rows);
}

export function render() {
  const trainerId = getLogin();
  if (!store.sculpt.trainers.some((t) => t.id === trainerId)) return;
  const now = new Date();
  renderDayPicker(now);
  renderHours(now, trainerId);
  renderMine(now, trainerId);
}

$('day').addEventListener('change', (event) => {
  day = event.target.value;
  showMessage('');
  render();
  fadeIn($('hours'), 6);
});
