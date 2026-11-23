import { env } from '../env.js';
import { api } from '../lib/data.js';
import { siteConfig, navCategories } from '../lib/site.js';
import { takeLast, prevDate, cnDate } from '../lib/date.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { statCardsHTML } from '../components/stat-cards.js';
import { ladderTableHTML } from '../components/ladder-table.js';

const MOBILE_QUERY = '(max-width: 768px)';

export function ladderDays() {
  return window.matchMedia(MOBILE_QUERY).matches ? env.mobileLadderDays : env.homeLadderDays;
}

function entryCardsHTML() {
  const cards = navCategories()
    .filter((c) => c.type === 'data')
    .map((c) => `<a class="entry-card" href="${env.basePath}${c.path.replace(/^\//, '')}"><span class="entry-label">${c.label}</span><span class="entry-desc">查看${c.label}数据</span></a>`)
    .join('');
  return `<section class="entry-cards">${cards}</section>`;
}

function bodyHTML(data) {
  const dates = takeLast(data.calendar.dates, ladderDays());
  return `
${statCardsHTML({ today: data.today, yesterday: data.yesterday })}
<section class="block">
  <h2 class="block-title">最近 ${dates.length} 个交易日连板天梯</h2>
  <div class="table-wrap">
    ${ladderTableHTML({ dates, tiers: data.ladder.tiers, cells: data.ladder.cells, latest: data.today.date })}
  </div>
</section>
${entryCardsHTML()}`.trim();
}

export default {
  async load() {
    const calendar = await api.calendar();
    const stats = await api.stats();

    const latest = calendar.latest;
    const month = latest.slice(0, 7);
    const ladder = await api.ladder(month);

    const today = stats.days.find((d) => d.date === latest);
    const prev = prevDate(stats.days.map((d) => d.date), latest);
    const yesterday = prev ? stats.days.find((d) => d.date === prev) : null;

    return { calendar, stats, ladder, today, yesterday };
  },

  title() {
    return '连板天梯';
  },

  description() {
    return 'A股连板天梯，按板数档位展示最近7个交易日的连板梯队，数据每个交易日更新。';
  },

  header() {
    return headerHTML({ categories: siteConfig.categories, currentPath: '/' });
  },

  render(data) {
    const dates = takeLast(data.calendar.dates, ladderDays());
    return `
<div class="page page-home">
  <h1 class="page-title">A股连板天梯</h1>
  <p class="page-lead">${cnDate(data.today.date)} · 涨停 ${data.today.limit_up_count} 家，最高 ${data.today.max_board} 板，连板 ${data.today.lianban_count} 家</p>
  <div class="home-body">
    ${bodyHTML(data)}
  </div>
</div>`.trim();
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  mount(el, data) {
    mountHeader(el);

    const body = el.querySelector('.home-body');
    if (!body) return;

    let lastDays = ladderDays();
    const mql = window.matchMedia(MOBILE_QUERY);

    const onChange = () => {
      const days = ladderDays();
      if (days === lastDays) return;
      lastDays = days;
      body.innerHTML = bodyHTML(data);
    };

    mql.addEventListener('change', onChange);
  }
};