import { mmdd } from '../lib/date.js';
import { esc } from '../lib/format.js';

export function themeMatrixHTML({ dates, themes, other, limitUpCounts }) {
  const headers = ['<th class="corner"></th>'];
  for (const d of dates) {
    headers.push(`<th>${mmdd(d)}</th>`);
  }
  const headerRow = `<tr>${headers.join('')}</tr>`;

  const rows = [];

  rows.push('<tr class="row-daily"><th>每日涨停</th>');
  for (const d of dates) {
    const count = limitUpCounts?.[d];
    const display = count == null || count === 0 ? '−' : String(count);
    const cls = display === '−' ? 'empty' : count >= 5 ? 'hot' : count >= 3 ? 'warm' : '';
    rows.push(`<td class="${cls}">${display}</td>`);
  }
  rows.push('</tr>');

  for (const theme of themes) {
    const name = esc(theme.name);
    rows.push(`<tr><th>${name}</th>`);
    for (const d of dates) {
      const count = theme.counts?.[d];
      const display = count == null || count === 0 ? '−' : String(count);
      const cls = display === '−' ? 'empty' : count >= 5 ? 'hot' : count >= 3 ? 'warm' : '';
      rows.push(`<td class="${cls}">${display}</td>`);
    }
    rows.push('</tr>');
  }

  const otherRow = ['<tr class="row-other"><th>其他概念</th>'];
  for (const d of dates) {
    const count = other?.counts?.[d];
    const display = count == null || count === 0 ? '−' : String(count);
    const cls = display === '−' ? 'empty' : count >= 5 ? 'hot' : count >= 3 ? 'warm' : '';
    otherRow.push(`<td class="${cls}">${display}</td>`);
  }
  otherRow.push('</tr>');

  return `
<table class="theme-matrix">
  <thead>${headerRow}</thead>
  <tbody>
    ${rows.join('')}
    ${otherRow.join('')}
  </tbody>
</table>`.trim();
}