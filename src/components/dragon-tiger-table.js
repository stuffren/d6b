import { fmtAmount, esc } from '../lib/format.js';

const INVESTOR_TYPES = new Set([
  '自然人', '中小投资者', '其他自然人', '机构投资者', '沪股通', '深股通投资者'
]);

function isInvestorType(name) {
  return INVESTOR_TYPES.has(name);
}

function seatRow(name, amount, side) {
  const cls = side === 'buy' ? 'seat-buy' : 'seat-sell';
  return `<div class="${cls}"><span class="seat-name" title="${esc(name)}">${esc(name)}</span><span class="seat-amount">${fmtAmount(amount)}</span></div>`;
}

function renderEntry(entry, side) {
  const seats = entry.seats?.[side] || [];
  return seats.map((s) => seatRow(s.name, s.amount, side)).join('');
}

export function dragonTigerTableHTML({ stocks }) {
  const headers = ['代码', '股票', '上榜原因', '成交额', '买入额', '卖出额', '净额', '席位'];

  const rows = [];
  for (const stock of stocks) {
    const entries = stock.entries || [];
    const entryCount = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isFirst = i === 0;

      const codeHtml = isFirst
        ? `<td class="cell-code" rowspan="${entryCount}"><code>${esc(stock.code)}</code></td>`
        : '';
      const nameHtml = isFirst
        ? `<td class="cell-name" rowspan="${entryCount}">${esc(stock.name)}</td>`
        : '';

      const reasonHtml = `<td class="cell-reason">${esc(entry.reason)}</td>`;
      const tradeAmountHtml = `<td class="cell-amount">${fmtAmount(entry.trade_amount)}</td>`;
      const buyAmountHtml = `<td class="cell-amount">${fmtAmount(entry.buy_amount)}</td>`;
      const sellAmountHtml = `<td class="cell-amount">${fmtAmount(entry.sell_amount)}</td>`;

      const netAmount = entry.net_amount ?? (entry.buy_amount - entry.sell_amount);
      const netClass = netAmount > 0 ? 'cell-amount is-up' : netAmount < 0 ? 'cell-amount is-down' : 'cell-amount';
      const netAmountHtml = `<td class="${netClass}">${fmtAmount(netAmount)}</td>`;

      const buySeatsHtml = renderEntry(entry, 'buy');
      const sellSeatsHtml = renderEntry(entry, 'sell');
      const seatsHtml = `<td class="cell-seats"><details class="seat-details"><summary>买5 / 卖5</summary><div class="seat-section"><div class="seat-header">买（前5）</div>${buySeatsHtml}</div><div class="seat-section"><div class="seat-header">卖（前5）</div>${sellSeatsHtml}</div></details></td>`;

      const rowClass = isFirst && entryCount > 1 ? 'row-multi' : '';
      rows.push(`<tr class="${rowClass}">${codeHtml}${nameHtml}${reasonHtml}${tradeAmountHtml}${buyAmountHtml}${sellAmountHtml}${netAmountHtml}${seatsHtml}</tr>`);
    }
  }

  return `
<section class="dragon-tiger-table-wrap">
  <table class="dragon-tiger-table">
    <thead>
      <tr>
        ${headers.map((h) => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
    ${rows.join('\n    ')}
    </tbody>
  </table>
</section>`.trim();
}