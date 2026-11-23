import { api } from '../lib/data.js';
import { env } from '../env.js';
import { cnDate, cnMonth } from '../lib/date.js';
import { esc } from '../lib/format.js';
import { siteConfig } from '../lib/site.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';

function yearModeHTML(archive, year) {
  const years = archive.years || [];
  const yearObj = years.find((y) => y.year === year);
  const existingMonths = new Set(yearObj?.months?.map((m) => m.month) || []);

  const monthLinks = [];
  for (let i = 12; i >= 1; i--) {
    const monthStr = String(i).padStart(2, '0');
    const monthKey = `${year}-${monthStr}`;
    if (existingMonths.has(monthKey)) {
      monthLinks.push(`<a class="month-link" href="${env.basePath}days/m/${monthKey}/">${i}月</a>`);
    } else {
      monthLinks.push(`<span class="month-link month-empty">${i}月</span>`);
    }
  }

  const totalDays = yearObj?.count || 0;
  return `
<div class="archive-year">
  <h2 class="archive-year-title">${year}年 <span class="archive-year-count">共${totalDays}个交易日</span></h2>
  <div class="archive-months">${monthLinks.join('')}</div>
</div>`;
}

function monthModeHTML(archive, targetMonth) {
  const years = archive.years || [];
  const yearStr = targetMonth.slice(0, 4);
  const yearObj = years.find((y) => y.year === yearStr);
  const monthObj = yearObj?.months?.find((m) => m.month === targetMonth);

  if (!monthObj) {
    return `<div class="page"><p>暂无数据</p></div>`;
  }

  const days = monthObj.days || [];

  const rows = days.map((d) => {
    const limitUpLink = d.limit_up
      ? `<a href="${env.basePath}zhangtingban/${d.date}/">涨停复盘</a>`
      : '';
    const dragonHuLink = d.dragon_tiger
      ? `<a href="${env.basePath}dragonhu/${d.date}/">龙虎榜</a>`
      : '';
    const links = [limitUpLink, dragonHuLink].filter(Boolean).join(' | ');
    return `
<tr>
  <td class="cell-date">${cnDate(d.date)}</td>
  <td class="cell-links">${links}</td>
</tr>`;
  }).join('\n');

  return `
<div class="archive-list">
  <h2 class="archive-month-title">${cnMonth(targetMonth)} <span class="archive-month-count">共${monthObj.count}个交易日</span></h2>
  <table class="archive-table">
    <thead>
      <tr><th>日期</th><th>数据</th></tr>
    </thead>
    <tbody>
    ${rows}
    </tbody>
  </table>
</div>`;
}

export default {
  async load(params) {
    const archive = await api.archive();
    return { archive };
  },

  render(data, ctx) {
    const { archive } = data;
    const { month, year } = ctx.params || {};

    let content;
    let title;
    let breadcrumb;

    if (month) {
      content = monthModeHTML(archive, month);
      title = cnMonth(month);
      const y = month.slice(0, 4);
      breadcrumb = breadcrumbHTML([
        { label: '首页', href: env.basePath },
        { label: '归档', href: `${env.basePath}days/` },
        { label: `${y}年`, href: `${env.basePath}days/y/${y}/` },
        { label: cnMonth(month) }
      ]);
    } else if (year) {
      content = yearModeHTML(archive, year);
      title = `${year}年归档`;
      breadcrumb = breadcrumbHTML([
        { label: '首页', href: env.basePath },
        { label: '归档', href: `${env.basePath}days/` },
        { label: `${year}年` }
      ]);
    } else {
      const years = archive.years || [];
      content = `<div class="archive-list">${years.map((y) => yearModeHTML(archive, y.year)).join('')}</div>`;
      title = '归档';
      breadcrumb = breadcrumbHTML([
        { label: '首页', href: env.basePath },
        { label: '归档' }
      ]);
    }

    return `
<div class="page">
  ${breadcrumb}
  <h1 class="page-title">${title}</h1>
  ${content}
</div>`;
  },

  header(data, ctx) {
    return headerHTML({
      categories: ctx.siteConfig.categories,
      currentPath: `${env.basePath}days/`
    });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    return '归档';
  },

  description(data, ctx) {
    return 'A股历史数据归档，按年/月查看所有交易日';
  },

  mount(el, data, ctx) {
    mountHeader(el);
  }
};