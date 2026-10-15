import { sendDemoRequest } from './demo-request.mjs';

const dialog = document.getElementById('demo-dialog');
const form = dialog.querySelector('form');
const status = dialog.querySelector('[data-demo-status]');
const submit = form.querySelector('[type="submit"]');
const success = dialog.querySelector('[data-demo-success]');
let sending = false;

// A native modal provides focus containment, Escape and focus restoration.
for (const link of document.querySelectorAll('[data-demo]')) {
  link.addEventListener('click', (event) => {
    if (!dialog.showModal || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    dialog.showModal();
  });
}
for (const button of dialog.querySelectorAll('[data-demo-close]')) button.addEventListener('click', () => dialog.close());
dialog.addEventListener('keydown', (event) => {
  // Let the native modal cancel without closing an underlying Quori panel.
  if (event.key === 'Escape') event.stopPropagation();
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending) return;
  sending = true;
  submit.disabled = true;
  submit.textContent = 'Sending…';
  status.textContent = '';
  form.setAttribute('aria-busy', 'true');
  try {
    await sendDemoRequest(Object.fromEntries(new FormData(form)), { hostname: location.hostname });
    form.hidden = true;
    success.hidden = false;
    form.reset();
    if (dialog.open) success.focus();
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'Sending took too long to confirm. Please email info@synapse-solutions.ai if you need help.'
      : error instanceof TypeError
        ? 'Check your connection and try again, or email info@synapse-solutions.ai.'
        : error.message;
  } finally {
    sending = false;
    submit.disabled = false;
    submit.textContent = 'Send demo request';
    form.removeAttribute('aria-busy');
  }
});
