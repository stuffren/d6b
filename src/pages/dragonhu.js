import { api, getJSON, loadRenderedContent } from '../lib/data.js';
import { env } from '../env.js';
import { cnDate } from '../lib/date.js';
import { esc } from '../lib/format.js';
import { siteConfig } from '../lib/site.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { dragonTigerTableHTML } from '../components/dragon-tiger-table.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';
import { bindDateChange } from '../lib/date-picker.js';

async function pageContentHTML(date) {
  return loadRenderedContent(`dragonhu/${date}/index.html`, '.page');
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
  const prevHref = prev ? `${env.basePath}dragonhu/${prev}/` : '#';
  const nextHref = next ? `${env.basePath}dragonhu/${next}/` : '#';
  return `
<nav class="prev-next" aria-label="上一日/下一日">
  <a href="${prevHref}"${!prev ? ' class="disabled"' : ''}>← 上一日</a>
  <a href="${nextHref}"${!next ? ' class="disabled"' : ''}>下一日 →</a>
</nav>`;
}

export default {
  async load(params) {
    const calendar = await api.calendar();
    const dragonTigerDates = calendar.kinds?.dragon_tiger || [];
    const target = params?.date || calendar.latest;

    if (!dragonTigerDates.includes(target)) {
      return { notFound: true, target, calendar, dragonTigerDates };
    }

    if (!window.__SSG__ && !env.isDev) {
      return {
        target,
        calendar,
        dragonTigerDates,
        notFound: false,
        contentHTML: await pageContentHTML(target)
      };
    }

    const [dragonTiger, archive] = await Promise.all([
      getJSON(`dragon_tiger/${target}.json`),
      api.archive()
    ]);

    const stockCount = dragonTiger.stocks?.length || 0;
    const entryCount = (dragonTiger.stocks || []).reduce((sum, s) => sum + (s.entries?.length || 0), 0);

    return { dragonTiger, archive, target, calendar, dragonTigerDates, stockCount, entryCount, notFound: false };
  },

  render(data) {
    if (data.contentHTML) return `<div class="page">${data.contentHTML}</div>`;
    if (data.notFound) {
      return `<div class="page"><p>该日期暂无龙虎榜数据</p></div>`;
    }

    const { dragonTiger, target, stockCount, entryCount, dragonTigerDates } = data;
    const stocks = dragonTiger.stocks || [];
    const earliest = dragonTigerDates[0];
    const latestDate = dragonTigerDates[dragonTigerDates.length - 1];

    return `
<div class="page">
  ${breadcrumbHTML([
    { label: '首页', href: env.basePath },
    { label: '龙虎榜', href: `${env.basePath}dragonhu/` },
    { label: cnDate(target) }
  ])}
  <div class="date-picker-wrap">
    <label class="date-picker-label" for="date-select">选择日期</label>
    <input type="date" id="date-select" class="date-picker-input"
      value="${target}"
      min="${earliest}"
      max="${latestDate}">
  </div>
  <h1 class="page-title">${cnDate(target)} 龙虎榜</h1>
  <div class="page-stats">
    <span class="stat-item">上榜股票 <strong>${stockCount}</strong> 只</span>
    <span class="stat-item">上榜原因 <strong>${entryCount}</strong> 条</span>
  </div>
  ${dragonTigerTableHTML({ stocks })}
  ${archiveLinkHTML(target)}
  ${prevNextHTML(target, dragonTigerDates)}
</div>`;
  },

  header(data, ctx) {
    return headerHTML({
      categories: ctx.siteConfig.categories,
      currentPath: `${env.basePath}dragonhu/`
    });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    return `${cnDate(data.target)} 龙虎榜`;
  },

  description(data) {
    return `${cnDate(data.target)} A股龙虎榜数据，上榜股票 ${data.stockCount} 只，上榜原因 ${data.entryCount} 条`;
  },

  mount(el, data, ctx) {
    mountHeader(el);
    const input = el.querySelector('#date-select');
    if (input) {
      bindDateChange(input, {
        validDates: data.dragonTigerDates,
        current: data.target,
        basePath: ctx.env.basePath,
        kind: 'dragonhu',
        router: ctx.router
      });
    }
  }
};