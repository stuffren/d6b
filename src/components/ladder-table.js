import { esc, tierLabel } from '../lib/format.js';
import { mmdd } from '../lib/date.js';

function cellContent(items, tier) {
  if (!items || !items.length) return '';
  return items
    .map((it) => {
      const label = tier === '8+' ? `${it.name}(${it.board_count}板)` : it.name;
      return `<span class="ladder-name" title="${esc(label)}">${esc(label)}</span>`;
    })
    .join('<br>');
}

export function ladderTableHTML({ dates, tiers, cells, latest }) {
  const latestCol = latest || dates[dates.length - 1];
  const cols = dates.slice().reverse();
  const rowTiers = tiers.slice().reverse();

  const head = cols.map((d) => {
    const cls = d === latestCol ? ' class="col-latest"' : '';
    return `<th${cls}>${mmdd(d)}</th>`;
  }).join('');

  const rows = rowTiers.map((t) => {
    const tds = cols.map((d) => {
      const content = cellContent(cells[d]?.[String(t)], t);
      if (!content) return '<td class="empty"></td>';
      return `<td>${content}</td>`;
    }).join('');
    return `<tr><th>${tierLabel(t)}</th>${tds}</tr>`;
  }).join('');

  return `
<table class="ladder-table">
  <thead>
    <tr><th class="corner">板数 \\ 日期</th>${head}</tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`.trim();
}