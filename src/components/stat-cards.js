import { esc, diffClass, diffLabel } from '../lib/format.js';
import { cnDate } from '../lib/date.js';

function card(title, today, yesterday, suffix) {
  const delta = yesterday == null ? null : today - yesterday;
  const deltaHTML = yesterday == null
    ? `<span class="stat-delta is-flat">—</span>`
    : `<span class="stat-delta ${diffClass(delta)}">${diffLabel(delta)}</span>`;

  return `
    <div class="stat-card">
      <div class="stat-title">${esc(title)}</div>
      <div class="stat-value">${today}${suffix ? `<span class="stat-unit">${suffix}</span>` : ''}</div>
      <div class="stat-foot">
        <span class="stat-yesterday">昨日 ${yesterday == null ? '—' : yesterday}</span>
        ${deltaHTML}
      </div>
    </div>`;
}

export function statCardsHTML({ today, yesterday }) {
  const y = yesterday != null ? yesterday : null;

  return `
<section class="stat-cards">
  <div class="stat-cards-head">${esc(cnDate(today.date))}</div>
  <div class="stat-cards-grid">
    ${card('涨停数量', today.limit_up_count, y ? y.limit_up_count : null, '家')}
    ${card('最高板', today.max_board, y ? y.max_board : null, '板')}
    ${card('连板家数', today.lianban_count, y ? y.lianban_count : null, '家')}
  </div>
</section>`.trim();
}