// The (i) button in the top bar opens a bottom sheet with the studio's contact details.
import { openSheet, closeSheet, bindSheet } from './sheet.js';

const sheet = document.getElementById('info-sheet');
bindSheet(sheet);
document.getElementById('info-button').addEventListener('click', () => openSheet(sheet));
document.getElementById('info-close').addEventListener('click', () => closeSheet(sheet));
