// The (i) button in the top bar opens a bottom sheet with the studio's contact details.
const sheet = document.getElementById('info-sheet');
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => window.matchMedia('(max-width: 640px)').matches;

function open() {
  sheet.showModal();
  if (reduced()) return;
  const from = narrow() ? 'translateY(100%)' : 'translateY(24px) scale(.97)';
  sheet.animate([{ transform: from, opacity: narrow() ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, pseudoElement: '::backdrop' });
}

// Slides away first, then closes. The dialog's own close (Esc) goes through here too.
// The slide-away holds its end state (fill: forwards) until the dialog is really closed, and
// is then cancelled. Left running, it would keep the sheet off screen the next time it opens.
let closing = false;
function close() {
  if (closing || !sheet.open) return;
  closing = true;
  if (reduced()) {
    sheet.close();
    closing = false;
    return;
  }
  const to = narrow() ? 'translateY(100%)' : 'translateY(24px) scale(.97)';
  const backdrop = sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, pseudoElement: '::backdrop', fill: 'forwards' });
  const slide = sheet.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: narrow() ? 1 : 0 }], { duration: 240, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
  const done = () => {
    sheet.close();
    backdrop.cancel();
    slide.cancel();
    closing = false;
  };
  slide.finished.then(done, done);
}

document.getElementById('info-button').addEventListener('click', open);
document.getElementById('info-close').addEventListener('click', close);
sheet.addEventListener('cancel', (event) => {
  event.preventDefault();
  close();
});
// A tap on the dimmed area outside the sheet closes it.
sheet.addEventListener('click', (event) => {
  if (event.target === sheet) close();
});
