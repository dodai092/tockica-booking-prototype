// The flag button in the top bar shows the flag of the language it switches to, and reloads on click.
import { getLang, setLang, t } from '../i18n.js';
import { saveView } from './keep.js';

const button = document.getElementById('lang-button');
const flag = button.querySelector('img');
const next = getLang() === 'en' ? 'hr' : 'en';

flag.src = next === 'en' ? 'assets/flag-gb.svg' : 'assets/flag-hr.webp';
const label = next === 'en' ? t('Prebaci na engleski') : t('Prebaci na hrvatski');
button.setAttribute('aria-label', label);
button.title = label;
button.addEventListener('click', () => {
  saveView();
  setLang(next);
});
