import { esc } from '../lib/format.js';
import { env } from '../env.js';

export function headerHTML({ categories, currentPath }) {
  const items = categories.map((c) => {
    const href = `${env.basePath}${c.path.replace(/^\//, '')}`;
    const active = href === currentPath ? ' class="nav-link is-active"' : ' class="nav-link"';
    return `<a href="${href}"${active}>${esc(c.label)}</a>`;
  }).join('');

  return `
<header class="site-header">
  <div class="site-header-inner">
    <a class="site-brand" href="${env.basePath}">d6b</a>
    <button class="nav-toggle" type="button" aria-label="菜单" aria-expanded="false">☰</button>
    <nav class="site-nav">${items}</nav>
  </div>
</header>`.trim();
}

export function mountHeader(el) {
  const btn = el.querySelector('.nav-toggle');
  const nav = el.querySelector('.site-nav');
  if (!btn || !nav) return;

  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}