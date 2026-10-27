// Small, quiet motion helpers. Each one does nothing (and resolves at once) when the
// user asks for reduced motion, so callers can chain on the returned promise either way.
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const SPRING = 'cubic-bezier(.34, 1.56, .64, 1)';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function run(node, keyframes, options = {}) {
  if (!node || reduced()) return Promise.resolve();
  return node.animate(keyframes, { duration: 240, easing: EASE, ...options }).finished.catch(() => {});
}

// Fade in with a small rise. A negative offset drops in from above.
export const fadeIn = (node, offset = 8, duration = 240) =>
  run(node, [{ opacity: 0, transform: `translateY(${offset}px)` }, { opacity: 1, transform: 'none' }], { duration });

// Slide in from the side the new content sits on (1 = right, -1 = left).
export const slideIn = (node, direction) =>
  run(node, [{ opacity: 0, transform: `translateX(${direction * 20}px)` }, { opacity: 1, transform: 'none' }], { duration: 260 });

// A short spring scale, for something that just became selected or changed value.
export const pop = (node, from = 0.9) =>
  run(node, [{ transform: `scale(${from})` }, { transform: 'none' }], { duration: 380, easing: SPRING });

// Shrinks and fades out, and holds that state until the caller hides the node and releases it.
export const popOut = (node) =>
  run(node, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.6)' }], { duration: 180, fill: 'forwards' });

// Height, spacing and opacity between "shut" and the node's natural size.
function boxFrames(node) {
  const cs = getComputedStyle(node);
  const open = {
    height: `${node.getBoundingClientRect().height}px`,
    opacity: 1,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
    borderTopWidth: cs.borderTopWidth,
    borderBottomWidth: cs.borderBottomWidth,
  };
  const shut = {
    height: '0px',
    opacity: 0,
    paddingTop: '0px',
    paddingBottom: '0px',
    marginTop: '0px',
    marginBottom: '0px',
    borderTopWidth: '0px',
    borderBottomWidth: '0px',
  };
  return [open, shut];
}

export function expand(node) {
  if (!node || reduced()) return Promise.resolve();
  const [open, shut] = boxFrames(node);
  node.style.overflow = 'hidden';
  return run(node, [shut, open], { duration: 300 }).finally(() => {
    node.style.overflow = '';
  });
}

// Holds the shut state afterwards, because callers remove or re-render the node next.
export function collapse(node) {
  if (!node || reduced()) return Promise.resolve();
  const [open, shut] = boxFrames(node);
  node.style.overflow = 'hidden';
  return run(node, [open, shut], { duration: 240, fill: 'forwards' });
}

// Drops the held "shut" state, for a node that is about to be reused rather than removed.
export function release(node) {
  node.getAnimations().forEach((animation) => animation.cancel());
  node.style.overflow = '';
}

// A status banner. An empty one grows open, so the content below moves with it instead of
// jumping; one that is already showing just fades the new text in.
export function showBanner(node, text, isError = false) {
  const wasShown = node.textContent !== '';
  node.textContent = text;
  node.classList.toggle('error', isError);
  if (!text) return;
  if (wasShown) fadeIn(node, -4, 200);
  else expand(node);
}
