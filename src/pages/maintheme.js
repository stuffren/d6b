import { api } from '../lib/data.js';
import { env } from '../env.js';
import { cnDate, mmdd, takeLast } from '../lib/date.js';
import { esc } from '../lib/format.js';
import { displayTheme } from '../lib/theme.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { themeMatrixHTML } from '../components/theme-matrix.js';
import { siteConfig } from '../lib/site.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';

const MOBILE_QUERY = '(max-width: 768px)';

function buildWindowSwitcher(allDates, current) {
  const months = [...new Set(allDates.map((d) => d.slice(0, 7)))].sort().reverse();
  const opts = [`<button class="switch-btn${current === 'last10' ? ' is-active' : ''}" data-window="last10">近10日</button>`];
  for (const m of months) {
    const [y, mo] = m.split('-');
    const label = `${y}年${Number(mo)}月`;
    opts.push(`<button class="switch-btn${current === m ? ' is-active' : ''}" data-window="${m}">${label}</button>`);
  }
  return `<div class="window-switcher">${opts.join('')}</div>`;
}

function buildDailyMainline(dates, mainlineByMonth, stats) {
  const items = [];
  for (const date of dates) {
    const month = date.slice(0, 7);
    const ml = mainlineByMonth[month];
    if (!ml) continue;

    const dayStats = stats.days.find((d) => d.date === date);
    const limitCount = dayStats?.limit_up_count ?? '—';

    const top = ml.themes[0];
    const topName = top ? displayTheme(top.name) : '—';
    const topCount = top ? top.counts?.[date] : null;

    const tags = [];
    for (const t of ml.themes.slice(0, 5)) {
      const c = t.counts?.[date];
      if (c > 0) tags.push(`${displayTheme(t.name)}(${c})`);
    }
    if (ml.other?.counts?.[date] > 0) {
      tags.push(`其他概念(${ml.other.counts[date]})`);
    }

    items.push(
      `<div class="daily-item">` +
      `<span class="daily-date">${mmdd(date)}</span>` +
      `<span class="daily-total">${limitCount}</span>` +
      `<span class="daily-top">${topName}${topCount != null ? `(${topCount}家)` : ''}</span>` +
      `<span class="daily-tags">${tags.join(' ')}</span>` +
      `</div>`
    );
  }
  return items.join('\n');
}

export default {
  async load(params) {
    const calendar = await api.calendar();
    const allDates = calendar.dates;

    let windowDates;
    let windowMode;
    let mainlineByMonth = {};
    let mergedThemes = [];
    let mergedOther = null;

    if (params?.month && params.month !== 'last10') {
      windowMode = params.month;
      const monthDates = allDates.filter((d) => d.slice(0, 7) === windowMode).reverse();
      windowDates = monthDates;
      const ml = await api.mainline(windowMode);
      mainlineByMonth[windowMode] = ml;
      mergedThemes = ml.themes;
      mergedOther = ml.other || null;
    } else {
      windowMode = 'last10';
      const count = window.matchMedia(MOBILE_QUERY).matches ? env.mobileLadderDays : env.last10Days;
      windowDates = takeLast(allDates, count).reverse();
      const months = [...new Set(windowDates.map((d) => d.slice(0, 7)))];
      const mls = await Promise.all(months.map((m) => api.mainline(m)));
      for (const ml of mls) {
        mainlineByMonth[ml.month] = ml;
      }
      const { themes, other } = mergeMainline(mainlineByMonth, windowDates);
      mergedThemes = themes;
      mergedOther = other;
    }

    const stats = await api.stats();
    const daysStats = {};
    for (const d of stats.days) {
      daysStats[d.date] = d;
    }

    return { calendar, allDates, windowDates, windowMode, mainlineByMonth, mergedThemes, mergedOther, stats, daysStats };
  },

  render(data) {
    const { allDates, windowDates, windowMode, mergedThemes, mergedOther, stats, daysStats } = data;

    const themeRows = mergedThemes.map((t) => ({
      name: displayTheme(t.name),
      counts: Object.fromEntries(
        windowDates.map((d) => [d, t.counts?.[d] ?? 0])
      )
    }));

    const otherCounts = mergedOther?.counts
      ? Object.fromEntries(windowDates.map((d) => [d, mergedOther.counts?.[d] ?? 0]))
      : Object.fromEntries(windowDates.map((d) => [d, 0]));

    const limitUpCounts = Object.fromEntries(windowDates.map((d) => [d, daysStats[d]?.limit_up_count ?? 0]));

    const matrixData = {
      dates: windowDates,
      themes: themeRows,
      other: { counts: otherCounts },
      limitUpCounts
    };

    return `
<div class="page">
  ${breadcrumbHTML([
    { label: '首页', href: env.basePath },
    { label: '主线题材' }
  ])}
  ${buildWindowSwitcher(allDates, windowMode)}
  <div class="theme-matrix-wrap">
    ${themeMatrixHTML({ dates: windowDates, themes: themeRows, other: { counts: otherCounts }, limitUpCounts })}
  </div>
  <div class="daily-mainline-wrap">
    <h2 class="section-title">每日主线</h2>
    ${buildDailyMainline(windowDates, data.mainlineByMonth, stats)}
  </div>
</div>`;
  },

  header(data, ctx) {
    const label = data.windowMode === 'last10' ? '近10日主线题材' : `${data.windowMode}主线题材`;
    return headerHTML({ categories: ctx.siteConfig.categories, currentPath: `${env.basePath}maintheme/` });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    const label = data.windowMode === 'last10' ? '近10日' : data.windowMode;
    return `${label}主线题材`;
  },

  description(data) {
    const label = data.windowMode === 'last10' ? '近10日' : data.windowMode;
    return `${label} A 股主线题材分布，统计每日各题材涨停家数，数据每个交易日更新。`;
  },

  mount(el, data, ctx) {
    mountHeader(el);

    const switcher = el.querySelector('.window-switcher');
    if (switcher) {
      switcher.addEventListener('click', (e) => {
        const btn = e.target.closest('.switch-btn');
        if (!btn) return;
        const w = btn.dataset.window;
        const target = w === 'last10' ? `${ctx.env.basePath}maintheme/` : `${ctx.env.basePath}maintheme/${w}/`;
        ctx.router?.navigate(target);
      });
    }
  }
};

function mergeMainline(mainlineByMonth, windowDates) {
  const themeMap = {};
  let otherSum = { counts: {} };

  for (const date of windowDates) {
    const month = date.slice(0, 7);
    const ml = mainlineByMonth[month];
    if (!ml) continue;

    for (const t of ml.themes) {
      if (!themeMap[t.name]) {
        themeMap[t.name] = { name: t.name, type: t.type, total: 0, counts: {} };
      }
      const c = t.counts?.[date] ?? 0;
      themeMap[t.name].counts[date] = c;
      if (c > 0) themeMap[t.name].total++;
    }

    if (ml.other) {
      for (const date of windowDates) {
        const c = ml.other.counts?.[date] ?? 0;
        otherSum.counts[date] = (otherSum.counts[date] || 0) + c;
      }
    }
  }

  const themes = Object.values(themeMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const otherExists = Object.values(otherSum.counts).some((c) => c > 0);
  const other = otherExists ? otherSum : null;

  return { themes, other };
}