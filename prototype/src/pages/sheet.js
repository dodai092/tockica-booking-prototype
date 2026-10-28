// Shared open/close animation for native <dialog> sheets: a bottom sheet on phones, a centred card on larger screens.
import { EASE, EASE_OUT_STRONG, EASE_DRAWER, haptic } from './motion.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => window.matchMedia('(max-width: 640px)').matches;

export function openSheet(sheet) {
  sheet.showModal();
  if (reduced()) {
    // Reduced motion: a dissolve instead of a slide.
    sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, pseudoElement: '::backdrop' });
    return;
  }
  const from = narrow() ? 'translateY(100%)' : 'translateY(24px) scale(.97)';
  sheet.animate([{ transform: from, opacity: narrow() ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: EASE });
  sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 340, pseudoElement: '::backdrop' });
}

// While a sheet is being dragged, a paused animation on ::backdrop holds the scrim at the drag progress.
const scrims = new WeakMap();
const scrimOpacity = (sheet) => {
  const scrim = scrims.get(sheet);
  return scrim ? 1 - scrim.currentTime / 1000 : 1;
};
function dropScrim(sheet) {
  scrims.get(sheet)?.cancel();
  scrims.delete(sheet);
}

// Slides away first, then closes. The dialog's own close (Esc) goes through here too.
// The slide-away holds its end state (fill: forwards) until the dialog is really closed, and
// is then cancelled. Left running, it would keep the sheet off screen the next time it opens.
// A drag release passes the offset (px) and speed (px/ms) it was let go at, so the slide carries on from there.
const closing = new WeakSet();
export function closeSheet(sheet, fromY = 0, velocity = 0) {
  if (closing.has(sheet) || !sheet.open) return Promise.resolve();
  closing.add(sheet);
  sheet.style.transform = '';
  const scrim = scrimOpacity(sheet);
  dropScrim(sheet);
  let backdrop;
  let slide;
  if (reduced()) {
    backdrop = sheet.animate([{ opacity: scrim }, { opacity: 0 }], { duration: 160, pseudoElement: '::backdrop', fill: 'forwards' });
    slide = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
  } else {
    const to = narrow() ? 'translateY(100%)' : 'translateY(24px) scale(.97)';
    const start = fromY ? `translateY(${fromY}px)` : 'none';
    // Dragged away: leave fast, in proportion to what is left. Tapped away: the open path, mirrored.
    const duration = fromY ? Math.min(280, Math.max(180, (sheet.offsetHeight - fromY) / Math.max(velocity, 0.8))) : 280;
    backdrop = sheet.animate([{ opacity: scrim }, { opacity: 0 }], { duration, pseudoElement: '::backdrop', fill: 'forwards' });
    slide = sheet.animate([{ transform: start, opacity: 1 }, { transform: to, opacity: narrow() ? 1 : 0 }], { duration, easing: fromY ? EASE_OUT_STRONG : EASE_DRAWER, fill: 'forwards' });
  }
  const done = () => {
    sheet.close();
    backdrop.cancel();
    slide.cancel();
    closing.delete(sheet);
  };
  return slide.finished.then(done, done);
}

const SLOP = 6; // px of movement before a press on the header becomes a drag
const WINDOW = 80; // ms of pointer history that the release speed is averaged over
const PROJECT = 499; // ms: 0.998 / (1 - 0.998), how far a flick would carry on
const RUBBER = 40; // px: the most a sheet can be pulled up

const rubber = (x) => (x * RUBBER * 0.55) / (RUBBER + 0.55 * x);

// Drag the header down to dismiss (phones). Pulling up resists, letting go short of the
// point of no return springs back, and a flick is judged by where it would end up.
function bindDrag(sheet) {
  const head = sheet.querySelector('.sheet-head');
  if (!head) return;
  let base = 0; // offset the sheet was at when grabbed (non-zero when grabbed mid-animation)
  let startY = 0;
  let pressed = false;
  let moving = false;
  let samples = [];
  const offsetOf = (dy) => (dy > 0 ? dy : -rubber(-dy));

  const speed = () => {
    const last = samples[samples.length - 1];
    const first = samples.find((s) => last.t - s.t <= WINDOW);
    return last && first && last !== first ? (last.y - first.y) / (last.t - first.t) : 0;
  };

  head.addEventListener('pointerdown', (event) => {
    if (!narrow() || closing.has(sheet) || event.target.closest('button')) return;
    // Grab the sheet where it is on screen, even in the middle of its open or spring-back animation.
    base = new DOMMatrix(getComputedStyle(sheet).transform).m42;
    sheet.getAnimations().forEach((animation) => animation.cancel());
    if (base) sheet.style.transform = `translateY(${base}px)`;
    pressed = true;
    moving = false;
    startY = event.clientY;
    samples = [{ y: event.clientY, t: event.timeStamp }];
    head.setPointerCapture(event.pointerId);
  });

  head.addEventListener('pointermove', (event) => {
    if (!pressed) return;
    if (!moving) {
      if (Math.abs(event.clientY - startY) < SLOP) return;
      moving = true;
      startY = event.clientY;
      if (!reduced() && !scrims.has(sheet)) {
        const scrim = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1000, pseudoElement: '::backdrop', fill: 'both' });
        scrim.pause();
        scrims.set(sheet, scrim);
      }
    }
    samples.push({ y: event.clientY, t: event.timeStamp });
    samples = samples.filter((s) => event.timeStamp - s.t <= WINDOW * 2);
    const offset = offsetOf(base + event.clientY - startY);
    sheet.style.transform = `translateY(${offset}px)`;
    const scrim = scrims.get(sheet);
    if (scrim) scrim.currentTime = Math.min(1, Math.max(0, offset / sheet.offsetHeight)) * 1000;
  });

  const release = (event) => {
    if (!pressed) return;
    pressed = false;
    if (!moving) {
      if (base) sheet.style.transform = '';
      return;
    }
    const offset = offsetOf(base + event.clientY - startY);
    const v = speed();
    // A cancelled gesture never dismisses; a flick up, or a pull short of where a flick would land, springs back.
    if (event.type === 'pointerup' && offset > 0 && v >= 0 && offset + v * PROJECT > sheet.offsetHeight * 0.5) {
      haptic(6);
      closeSheet(sheet, offset, v);
      return;
    }
    const opacity = scrimOpacity(sheet);
    dropScrim(sheet);
    sheet.style.transform = '';
    if (reduced()) return;
    if (offset) sheet.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], { duration: 300, easing: EASE_DRAWER });
    sheet.animate([{ opacity }, { opacity: 1 }], { duration: 300, easing: EASE_DRAWER, pseudoElement: '::backdrop' });
  };
  head.addEventListener('pointerup', release);
  head.addEventListener('pointercancel', release);
}

// Esc and a tap on the dimmed area close the sheet through the animated path.
export function bindSheet(sheet) {
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSheet(sheet);
  });
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet(sheet);
  });
  sheet.addEventListener('scroll', () => sheet.classList.toggle('scrolled', sheet.scrollTop > 0), { passive: true });
  bindDrag(sheet);
}
