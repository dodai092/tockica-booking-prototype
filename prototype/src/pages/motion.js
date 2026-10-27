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

export const dimTo = (node, opacity) => run(node, [{ opacity: 1 }, { opacity }], { duration: 260 });
export const undimFrom = (node, opacity) => run(node, [{ opacity }, { opacity: 1 }], { duration: 260 });

// A selection ring that fades in or out on a card.
export function ring(node, on) {
  const cs = getComputedStyle(node);
  const green = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
  const border = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  const shown = { boxShadow: `0 0 0 1px ${green}`, borderColor: green };
  const hidden = { boxShadow: `0 0 0 1px transparent`, borderColor: on ? border : cs.borderColor };
  return run(node, on ? [hidden, shown] : [shown, { ...hidden, borderColor: border }], { duration: 260 });
}

// Height, spacing and opacity between "shut" and the node's natural size. `shutOverrides`
// lets a node that sits in a grid cancel the row gap (marginTop: '-12px').
function boxFrames(node, shutOverrides) {
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
    ...shutOverrides,
  };
  return [open, shut];
}

export function expand(node, shutOverrides) {
  if (!node || reduced()) return Promise.resolve();
  const [open, shut] = boxFrames(node, shutOverrides);
  node.style.overflow = 'hidden';
  return run(node, [shut, open], { duration: 300 }).finally(() => {
    node.style.overflow = '';
  });
}

// Holds the shut state afterwards, because callers remove or re-render the node next.
export function collapse(node, shutOverrides) {
  if (!node || reduced()) return Promise.resolve();
  const [open, shut] = boxFrames(node, shutOverrides);
  node.style.overflow = 'hidden';
  return run(node, [open, shut], { duration: 240, fill: 'forwards' });
}

// Drops the held "shut" state, for a node that is about to be reused rather than removed.
export function release(node) {
  node.getAnimations().forEach((animation) => animation.cancel());
  node.style.overflow = '';
}
