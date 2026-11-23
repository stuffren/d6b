import { cnMonth } from '../lib/date.js';

export const PAGE_TYPES = {
  LIST: 'list',
  DETAIL: 'detail',
  DATA: 'data',
  STATIC: 'static'
};

export const PAGE_REGISTRY = {
  '/': { type: PAGE_TYPES.DATA, priority: '1.0', ogType: 'website', canonical: 'root' },
  '/zhangtingban/': { type: PAGE_TYPES.DATA, priority: '0.9', ogType: 'article', alias: 'latest-limit-up' },
  '/zhangtingban/:date/': { type: PAGE_TYPES.DETAIL, priority: '0.9', ogType: 'article' },
  '/lianbantiandi/': { type: PAGE_TYPES.DATA, priority: '0.9', ogType: 'website' },
  '/maintheme/': { type: PAGE_TYPES.DATA, priority: '0.8', ogType: 'website' },
  '/maintheme/:month/': { type: PAGE_TYPES.DETAIL, priority: '0.8', ogType: 'website' },
  '/dragonhu/': { type: PAGE_TYPES.DATA, priority: '0.8', ogType: 'article', alias: 'latest-dragon-tiger' },
  '/dragonhu/:date/': { type: PAGE_TYPES.DETAIL, priority: '0.7', ogType: 'article' },
  '/days/': { type: PAGE_TYPES.LIST, priority: '0.5', ogType: 'website' },
  '/days/m/:month/': { type: PAGE_TYPES.LIST, priority: '0.4', ogType: 'website' },
  '/days/y/:year/': { type: PAGE_TYPES.LIST, priority: '0.4', ogType: 'website' },
  '/categories/:category/': { type: PAGE_TYPES.LIST, priority: '0.6', ogType: 'website' },
  '/posts/:id/': { type: PAGE_TYPES.DETAIL, priority: '0.7', ogType: 'article' },
  '/about/': { type: PAGE_TYPES.STATIC, priority: '0.3', ogType: 'website' }
};

export function aliasTarget(routePath) {
  return PAGE_REGISTRY[routePath]?.alias || null;
}

export function metaForStatic(routePath, params) {
  if (routePath === '/days/') {
    return { title: '归档', description: 'A股历史数据归档，按年/月查看所有交易日' };
  }
  if (routePath === '/days/y/:year/') {
    return {
      title: `${params.year}年归档`,
      description: `${params.year}年A股交易日归档，按月查看该年度所有交易日数据入口`
    };
  }
  if (routePath === '/days/m/:month/') {
    return {
      title: `${cnMonth(params.month)}归档`,
      description: `${cnMonth(params.month)}A股交易日归档，汇总该月所有交易日的涨停复盘与龙虎榜入口`
    };
  }
  return null;
}

export function resolveMeta(routePath, page, data, ctx) {
  const fallback = metaForStatic(routePath, ctx.params || {});
  if (fallback) return fallback;
  return {
    title: page.title ? page.title(data) : '',
    description: page.description ? page.description(data, ctx) : ''
  };
}