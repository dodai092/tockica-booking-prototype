// The sun/moon button in the top bar flips between light and dark and remembers the choice.
import { EASE_DRAWER } from './motion.js';

const root = document.documentElement;
const button = document.getElementById('theme-button');

function apply(theme) {
  root.dataset.theme = theme;
  button.setAttribute('aria-label', theme === 'dark' ? 'Svijetli način' : 'Tamni način');
}

apply(root.dataset.theme);
button.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('tockica-theme', next);
  // Crossfade the whole page in one snapshot; see ::view-transition-* in styles.css.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Reduced motion keeps the dissolve (no movement); only the icon turn is dropped.
  const swap = () => {
    apply(next);
    if (!reduce) button.querySelectorAll('svg').forEach((icon) => icon.animate([{ transform: 'rotate(-60deg)' }, { transform: 'none' }], { duration: 300, easing: EASE_DRAWER }));
  };
  if (document.startViewTransition) document.startViewTransition(swap);
  else swap();
});
