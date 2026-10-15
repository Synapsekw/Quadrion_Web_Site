(() => {
  const buttons = [...document.querySelectorAll('[data-install-app]')];
  let installOffer = null;
  const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const showInstall = available => {
    for (const button of buttons) {
      button.hidden = !available;
      button.disabled = !available;
    }
  };

  showInstall(false);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (installed()) return;
    installOffer = event;
    showInstall(true);
  });
  window.addEventListener('appinstalled', () => {
    installOffer = null;
    showInstall(false);
  });
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      if (!installOffer) return;
      const offer = installOffer;
      installOffer = null;
      showInstall(false);
      try {
        // The browser prompt is shown only in response to the visitor's click.
        await offer.prompt();
        await offer.userChoice;
      } catch {
        // Offers are single-use, including when the browser dismisses or rejects one.
      }
    });
  }

  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
    // PWA support is optional; the website continues normally when unavailable.
  });
  const schedule = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(register, { timeout: 2500 });
    else window.setTimeout(register, 1000);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
