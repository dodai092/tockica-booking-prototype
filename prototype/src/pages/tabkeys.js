// Keyboard pattern for a row of role="tab" buttons: one tab stop (the selected tab), arrows, Home and End move and select.
export function tabKeys(tabs) {
  const sync = () => {
    for (const tab of tabs) tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
  };
  const observer = new MutationObserver(sync);
  for (const tab of tabs) {
    observer.observe(tab, { attributes: true, attributeFilter: ['aria-selected'] });
    tab.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      const i = tabs.indexOf(tab);
      const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });
  }
  sync();
}
