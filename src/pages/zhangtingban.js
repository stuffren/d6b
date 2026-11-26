import { api, getJSON, loadRenderedContent } from '../lib/data.js';
import { env } from '../env.js';
import { cnDate, mmdd } from '../lib/date.js';
import { esc } from '../lib/format.js';
import { displayTheme } from '../lib/theme.js';
import { siteConfig } from '../lib/site.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { statCardsHTML } from '../components/stat-cards.js';
import { poolTableHTML } from '../components/pool-table.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';
import { bindDateChange } from '../lib/date-picker.js';

async function pageContentHTML(date) {
  return loadRenderedContent(`zhangtingban/${date}/index.html`, '.page');
}

function themeListHTML(stocks) {
  const map = {};
  for (const s of stocks) {
    const t = s.theme || 'other';
    if (!map[t]) map[t] = 0;
    map[t]++;
  }
  const otherCount = map['other'] || 0;
  delete map['other'];
  const sorted = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([t, count]) => `<span class="theme-tag">${esc(displayTheme(t))}(${count})</span>`);
  if (otherCount > 0) sorted.push(`<span class="theme-tag">其他概念(${otherCount})</span>`);
  return `<div class="theme-list">${sorted.join('')}</div>`;
}

function archiveLinkHTML(date) {
  const [year, month] = date.slice(0, 7).split('-');
  return `
<nav class="archive-links" aria-label="归档">
  <a href="${env.basePath}days/m/${year}-${month}/">${year}年${month}月归档</a>
  <a href="${env.basePath}days/y/${year}/">${year}年归档</a>
</nav>`;
}

function prevNextHTML(date, dates) {
  const idx = dates.indexOf(date);
  const prev = idx > 0 ? dates[idx - 1] : null;
  const next = idx < dates.length - 1 ? dates[idx + 1] : null;
  const prevHref = prev ? `${env.basePath}zhangtingban/${prev}/` : '#';
  const nextHref = next ? `${env.basePath}zhangtingban/${next}/` : '#';
  return `
<nav class="prev-next" aria-label="上一日/下一日">
  <a href="${prevHref}"${!prev ? ' class="disabled"' : ''}>← 上一日</a>
  <a href="${nextHref}"${!next ? ' class="disabled"' : ''}>下一日 →</a>
</nav>`;
}

export default {
  async load(params) {
    const calendar = await api.calendar();
    const target = params?.date || calendar.latest;
    const stats = await api.stats();

    const todayStats = stats.days.find((d) => d.date === target);
    const allDates = calendar.dates;
    const idx = allDates.indexOf(target);
    const prevDate = idx > 0 ? allDates[idx - 1] : null;
    const yesterdayStats = prevDate ? stats.days.find((d) => d.date === prevDate) : null;

    if (!window.__SSG__ && !env.isDev) {
      return { target, todayStats, yesterdayStats, allDates, contentHTML: await pageContentHTML(target) };
    }

    const limitUp = await getJSON(`limit_up/${target}.json`);
    return { limitUp, todayStats, yesterdayStats, target, allDates };
  },

  render(data) {
    const crumb = breadcrumbHTML([
      { label: '首页', href: env.basePath },
      { label: '涨停复盘', href: `${env.basePath}zhangtingban/` },
      { label: cnDate(data.target) }
    ]);
    if (data.contentHTML) return `<div class="page">${data.contentHTML}</div>`;
    const { limitUp, todayStats, yesterdayStats, target, allDates } = data;
    const stocks = [...limitUp.stocks].sort((a, b) => {
      if (b.board_count !== a.board_count) return b.board_count - a.board_count;
      if (b.seal_amount !== a.seal_amount) return b.seal_amount - a.seal_amount;
      if (a.seal_time !== b.seal_time) return a.seal_time.localeCompare(b.seal_time);
      return a.code.localeCompare(b.code);
    });

    const recent30 = allDates.slice(-Math.min(30, allDates.length));
    const earliest = recent30[0];
    const latestDate = allDates[allDates.length - 1];

    return `
<div class="page">
  ${crumb}
  ${statCardsHTML({ today: todayStats, yesterday: yesterdayStats })}
  <div class="date-picker-wrap">
    <label class="date-picker-label" for="date-select">选择日期</label>
    <input type="date" id="date-select" class="date-picker-input"
      value="${target}"
      min="${earliest}"
      max="${latestDate}">
  </div>
  <div class="page-section">
    <h2 class="section-title">主线题材</h2>
    ${themeListHTML(stocks)}
  </div>
  ${poolTableHTML({ stocks })}
  ${archiveLinkHTML(target)}
  ${prevNextHTML(target, allDates)}
</div>`;
  },

  header(data, ctx) {
    return headerHTML({
      categories: ctx.siteConfig.categories,
      currentPath: `${env.basePath}zhangtingban/`
    });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    return `${cnDate(data.target)} 涨停复盘`;
  },

  description(data) {
    return `${cnDate(data.target)} A股涨停复盘，涨停 ${data.todayStats?.limit_up_count ?? 0} 家，最高 ${data.todayStats?.max_board ?? 0} 板`;
  },

  mount(el, data, ctx) {
    mountHeader(el);
    const input = el.querySelector('#date-select');
    if (input) {
      bindDateChange(input, {
        validDates: data.allDates,
        current: data.target,
        basePath: ctx.env.basePath,
        kind: 'zhangtingban',
        router: ctx.router
      });
    }
  }
};