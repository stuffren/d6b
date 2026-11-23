import { boardLabel, sealClass, fmtAmount, esc } from '../lib/format.js';

export function poolTableHTML({ stocks }) {
  const headers = [
    { label: '板数', cls: 'cell-board' },
    { label: '代码', cls: 'cell-code' },
    { label: '名称', cls: 'cell-name' },
    { label: '封板资金', cls: 'cell-amount' },
    { label: '涨停时间', cls: 'cell-time' },
    { label: '主线名称', cls: 'cell-theme' },
    { label: '涨停原因', cls: 'cell-reason' }
  ];

  const rows = stocks.map((s) => {
    const isDelisting = s.is_delisting;
    const boardHtml = `<td class="cell-board${isDelisting ? ' is-delisting' : ''}">${boardLabel(s.board_count)}</td>`;
    const codeHtml = `<td class="cell-code"><code>${s.code}</code></td>`;
    const nameHtml = `<td class="cell-name">${esc(s.name)}${isDelisting ? '<span class="tag tag-delisting">退</span>' : ''}</td>`;
    const amountHtml = `<td class="cell-amount">${fmtAmount(s.seal_amount)}</td>`;
    const timeClass = sealClass(s.seal_time);
    const timeHtml = `<td class="cell-time ${timeClass}">${esc(s.seal_time)}</td>`;
    const themeHtml = `<td class="cell-theme">${esc(s.theme || '—')}</td>`;
    const reasonHtml = `<td class="cell-reason">${esc(s.reason)}</td>`;
    return `<tr>${boardHtml}${codeHtml}${nameHtml}${amountHtml}${timeHtml}${themeHtml}${reasonHtml}</tr>`;
  }).join('\n    ');

  return `
<section class="pool-table-wrap">
  <table class="pool-table">
    <thead>
      <tr>
        ${headers.map((h) => `<th class="${h.cls}">${h.label}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
    ${rows}
    </tbody>
  </table>
</section>`.trim();
}