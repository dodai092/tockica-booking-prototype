// Who sees which page in the prototype. The real app checks roles on the server (ADR 0004);
// here it only decides which tabs are shown for the demo login.
const ALL = ['raspored', 'racun', 'recepcija', 'izvjestaji', 'admin'];
const TABS = {
  customer: ['raspored', 'racun'],
  reception: ['raspored', 'recepcija'],
  owner: ALL,
  trainer: ['sculpt'],
};

export const loginRole = (login) => (login.startsWith('acc_') ? 'customer' : login.startsWith('tr_') ? 'trainer' : login);
export const tabsFor = (role) => TABS[role];
export const canOpen = (role, tab) => TABS[role].includes(tab);
