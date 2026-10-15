import { mountQuoriWidget } from './widget.js';

const quori = mountQuoriWidget();
quori.element.style.setProperty('--quori-font', "'IBM Plex Sans', 'Segoe UI', Arial, sans-serif");
// Keep the page's smooth scrolling from swallowing scroll inside the chat.
quori.element.setAttribute('data-lenis-prevent', '');
