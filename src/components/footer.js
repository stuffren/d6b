import { esc } from '../lib/format.js';

export function footerHTML({ text }) {
  return `<footer class="site-footer"><p>${esc(text)}</p></footer>`;
}