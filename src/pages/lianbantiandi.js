import { api } from '../lib/data.js';
import { env } from '../env.js';
import { cnDate, mmdd, takeLast } from '../lib/date.js';
import { esc } from '../lib/format.js';
import { siteConfig } from '../lib/site.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';
import { ladderTableHTML } from '../components/ladder-table.js';

const MOBILE_QUERY = '(max-width: 768px)';

function computeDailyLeaders(mergedLadder, windowDates) {
  return windowDates.map((d) => {
    const cell = mergedLadder.cells?.[d];
    if (!cell) return null;

    let best = null;
    for (const tier of mergedLadder.tiers) {
      const items = cell[String(tier)];
      if (!items || !items.length) continue;
      for (const it of items) {
        if (!best) {
          best = { ...it, board_count: Number(tier === '8+' ? 9 : tier) };
          continue;
        }
        const bc = Number(tier === '8+' ? 9 : tier);
        if (bc > best.board_count) {
          best = { ...it, board_count: bc };
        } else if (bc === best.board_count) {
          if ((it.seal_amount ?? 0) > (best.seal_amount ?? 0)) {
            best = { ...it, board_count: bc };
          } else if ((it.seal_amount ?? 0) === (best.seal_amount ?? 0)) {
            if ((it.seal_time ?? '') < (best.seal_time ?? '')) {
              best = { ...it, board_count: bc };
            } else if ((it.seal_time ?? '') === (best.seal_time ?? '')) {
              if ((it.code ?? '') < (best.code ?? '')) {
                best = { ...it, board_count: bc };
              }
            }
          }
        }
      }
    }
    return best ? { date: d, leader: best } : null;
  }).filter(Boolean);
}

function buildDailyLeadersHTML(leaders) {
  if (!leaders.length) return '';
  const items = leaders.map(({ date, leader }) =>
    `<div class="daily-leader-item">` +
    `<span class="dl-date">${mmdd(date)}</span>` +
    `<span class="dl-name">总龙头 ${esc(leader.name)}(${leader.board_count}板)</span>` +
    `</div>`
  );
  return `<div class="daily-leaders">${items.join('')}</div>`;
}

function archiveLinkHTML(date) {
  const [year, month] = date.slice(0, 7).split('-');
  return `
<nav class="archive-links" aria-label="归档">
  <a href="${env.basePath}days/m/${year}-${month}/">${year}年${month}月归档</a>
  <a href="${env.basePath}days/y/${year}/">${year}年归档</a>
</nav>`;
}

function mergeLadder(ladderByMonth, windowDates) {
  const allTiers = [...new Set(Object.values(ladderByMonth).flatMap((ml) => ml.tiers))].sort((a, b) => {
    const na = a === '8+' ? 9 : Number(a);
    const nb = b === '8+' ? 9 : Number(b);
    return na - nb;
  });

  const mergedCells = {};
  const mergedDates = [...windowDates];

  for (const d of windowDates) {
    const month = d.slice(0, 7);
    const ml = ladderByMonth[month];
    if (!ml) continue;
    mergedCells[d] = ml.cells?.[d] || {};
  }

  return { tiers: allTiers, dates: mergedDates, cells: mergedCells };
}

export default {
  async load() {
    const calendar = await api.calendar();
    const allDates = calendar.dates;

    const count = window.matchMedia(MOBILE_QUERY).matches ? env.mobileLadderDays : env.pageLadderDays;
    const windowDates = takeLast(allDates, count);
    const months = [...new Set(windowDates.map((d) => d.slice(0, 7)))];

    const ladders = await Promise.all(months.map((m) => api.ladder(m)));
    const ladderByMonth = {};
    for (const ml of ladders) {
      ladderByMonth[ml.month] = ml;
    }

    const mergedLadder = mergeLadder(ladderByMonth, windowDates);
    const leaders = computeDailyLeaders(mergedLadder, windowDates);
    const stats = await api.stats();

    const lastDate = windowDates[windowDates.length - 1];
    const dayStats = stats.days.find((d) => d.date === lastDate);

    return { calendar, windowDates, mergedLadder, leaders, lastDate, dayStats };
  },

  render(data) {
    const { windowDates, mergedLadder, leaders, lastDate } = data;
    const count = windowDates.length;

    return `
<div class="page">
  ${breadcrumbHTML([
    { label: '首页', href: env.basePath },
    { label: '连板天梯' }
  ])}
  <h1 class="page-title">${cnDate(lastDate)} 连板天梯</h1>
  <p class="page-lead">向前回溯 ${count} 个交易日</p>
  <div class="table-wrap">
    ${ladderTableHTML({ dates: windowDates, tiers: mergedLadder.tiers, cells: mergedLadder.cells, latest: lastDate })}
  </div>
  <div class="section-block">
    <h2 class="block-title">每日龙头</h2>
    ${buildDailyLeadersHTML(leaders)}
  </div>
  ${archiveLinkHTML(lastDate)}
</div>`;
  },

  header() {
    return headerHTML({ categories: siteConfig.categories, currentPath: `${env.basePath}lianbantiandi/` });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    return `${cnDate(data.lastDate)}连板天梯`;
  },

  description(data) {
    return `${cnDate(data.lastDate)} A 股连板天梯，统计最近${data.windowDates.length}个交易日的连板梯队，数据每个交易日更新。`;
  },

  mount(el, data, ctx) {
    mountHeader(el);
  }
};