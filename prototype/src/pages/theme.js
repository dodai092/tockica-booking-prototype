// The sun/moon button in the top bar flips between light and dark and remembers the choice.
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
  apply(next);
});
