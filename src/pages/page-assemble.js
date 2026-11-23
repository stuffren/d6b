import { adSlotHTML, mountAdSlot } from '../components/ad-slot.js';

export function assemblePage(page, data, ctx) {
  const header = page.header ? page.header(data, ctx) : '';
  const body = page.render(data, ctx);
  const adSlot = typeof page.adSlot === 'function'
    ? page.adSlot(data, ctx)
    : (page.adSlot === false ? '' : adSlotHTML());
  const footer = page.footer ? page.footer(data, ctx) : '';
  return { header, body, adSlot, footer };
}

export function assembleHTML(page, data, ctx) {
  const { header, body, adSlot, footer } = assemblePage(page, data, ctx);
  return `
${header}
${body}
${adSlot}
${footer}`.trim();
}

export function assembleElement(page, data, ctx) {
  const el = document.createElement('div');
  el.className = 'page-root';
  el.innerHTML = assembleHTML(page, data, ctx);
  page.mount?.(el, data, ctx);
  mountAdSlot(el);
  return el;
}