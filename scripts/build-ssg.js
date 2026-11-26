/**
 * SSG 构建脚本
 * - 复用 src/pages 下所有页面的真实 load / render / header / footer 逻辑
 * - 从 dist/data 下的派生数据枚举全部动态路由参数
 * - 逐日原始数据（limit_up / dragon_tiger）优先读取事实源 gather/data，缺失时回落到 dist/data
 * - 输出包含完整页面内容的静态 HTML（含首页 index.html）
 */

import { readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { createSSGEngine, escapeHtml } from '../core/ssg_build/ssg_build.js';
import { createEnvManager } from '../core/multiple_env/multi_env.js';
import { ENV_SCHEMA } from './env-schema.js';
import { deployPresets } from './deploy-presets.js';
import { ADSENSE } from '../src/config/adsense.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
process.chdir(ROOT);

const DIST_DIR = 'dist';
const DATA_DIR = join(ROOT, DIST_DIR, 'data');
const GATHER_DATA_DIR = join(ROOT, 'gather', 'data');

const DATA_SOURCE_MAP = {};
for (const kind of ['limit_up', 'dragon_tiger']) {
  const srcDir = join(GATHER_DATA_DIR, kind);
  if (existsSync(srcDir)) DATA_SOURCE_MAP[kind] = srcDir;
}
const CONTENT_DIR = join(ROOT, 'content');
if (existsSync(CONTENT_DIR)) DATA_SOURCE_MAP.posts = CONTENT_DIR;

function resolveDataFile(rel) {
  const head = rel.split('/')[0];
  const mappedBase = DATA_SOURCE_MAP[head];
  const base = mappedBase || DATA_DIR;
  const sub = mappedBase ? rel.slice(head.length + 1) : rel;
  const full = resolve(base, sub);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

function readJSON(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

const DEPLOY_ENV = process.env.DEPLOY_ENV || 'development';

const envManager = createEnvManager({
  envFile: '.env',
  prefix: 'VITE_',
  envName: DEPLOY_ENV,
  presets: deployPresets(DEPLOY_ENV),
  schema: ENV_SCHEMA
});
envManager.load();
envManager.validate();

const siteName = envManager.get('VITE_SITE_NAME');
const basePath = envManager.get('BASE_PATH');
const customDomain = envManager.get('VITE_CUSTOM_DOMAIN');
const siteBaseUrl = (
  envManager.get('SITE_BASE_URL') ||
  (DEPLOY_ENV === 'custom-domain' && customDomain ? `https://${customDomain}` : '')
).replace(/\/$/, '');
const dataDir = envManager.get('VITE_DATA_DIR');
const tz = envManager.get('VITE_TZ');
const homeLadderDays = Number(envManager.get('VITE_HOME_LADDER_DAYS'));
const pageLadderDays = Number(envManager.get('VITE_PAGE_LADDER_DAYS'));
const mobileLadderDays = Number(envManager.get('VITE_MOBILE_LADDER_DAYS'));
const last10Days = Number(envManager.get('VITE_LAST10_DAYS'));
const enableDragonTiger = String(envManager.get('VITE_ENABLE_DRAGON_TIGER')) === 'true';
const basePathWithSlash = basePath === '/' ? '/' : `${basePath.replace(/\/$/, '')}/`;

const PAGE_DIRS_TO_CLEAN = [
  'zhangtingban', 'lianbantiandi', 'maintheme', 'dragonhu',
  'days', 'categories', 'posts', 'about'
];

globalThis.__BASE_PATH__ = basePath;
globalThis.__SITE_NAME__ = siteName;
globalThis.__SITE_BASE_URL__ = siteBaseUrl;
globalThis.__DATA_DIR__ = dataDir;
globalThis.__TZ__ = tz;
globalThis.__HOME_LADDER_DAYS__ = String(homeLadderDays);
globalThis.__PAGE_LADDER_DAYS__ = String(pageLadderDays);
globalThis.__MOBILE_LADDER_DAYS__ = String(mobileLadderDays);
globalThis.__LAST10_DAYS__ = String(last10Days);
globalThis.__ENABLE_DRAGON_TIGER__ = String(enableDragonTiger);

const versionData = readJSON(join(DATA_DIR, 'version.json'));
const dataVersion = versionData?.generated_at || null;

globalThis.window = {
  __SSG__: true,
  __DATA_VERSION__: dataVersion,
  matchMedia: () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  })
};

function dataFilePath(input) {
  let p = String(input).split('?')[0].split('#')[0];
  if (/^(https?:|file:)/.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      return null;
    }
  }
  const bp = basePathWithSlash === '/' ? '' : basePathWithSlash.replace(/\/$/, '');
  if (bp && p.startsWith(bp)) p = p.slice(bp.length);
  const prefix = `/${String(dataDir).replace(/^\/|\/$/g, '')}/`;
  if (!p.startsWith(prefix)) return null;
  const rel = p.slice(prefix.length);
  return resolveDataFile(rel);
}

globalThis.fetch = async (input) => {
  const file = dataFilePath(typeof input === 'string' ? input : input?.url);
  const notFound = {
    ok: false,
    status: 404,
    json: async () => {
      throw new Error('not found');
    },
    text: async () => ''
  };
  if (!file) return notFound;
  try {
    const text = readFileSync(file, 'utf-8');
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(text),
      text: async () => text
    };
  } catch {
    return notFound;
  }
};

function cnMonthLabel(month) {
  const [y, m] = month.split('-');
  return `${Number(y)}年${Number(m)}月`;
}

function urlPathFor(template, params) {
  let p = template;
  for (const key of Object.keys(params)) {
    p = p.split(`:${key}`).join(String(params[key]));
  }
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
}

function outPathFor(urlPath) {
  if (urlPath === '/') return 'index.html';
  return `${urlPath.replace(/^\/|\/$/g, '')}/index.html`;
}

function joinSiteUrl(pathname) {
  const bp = basePathWithSlash === '/' ? '' : basePathWithSlash.replace(/\/$/, '');
  const alreadyIncluded = bp && new RegExp(`${bp}$`).test(siteBaseUrl);
  const prefix = alreadyIncluded ? '/' : basePathWithSlash;
  return `${siteBaseUrl}${prefix}${pathname.replace(/^\//, '')}`;
}

function canonicalFor(urlPath) {
  return joinSiteUrl(urlPath);
}

function adsenseHead() {
  if (!ADSENSE.client) return '';
  const meta = `\n  <meta name="google-adsense-account" content="${escapeHtml(ADSENSE.client)}">`;
  if (!ADSENSE.slot) return meta;
  return `${meta}\n  <script async crossorigin="anonymous" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE.client)}"></script>`;
}

function writeAdsTxt() {
  if (!ADSENSE.client) return;
  const file = join(ROOT, DIST_DIR, 'ads.txt');
  writeFileSync(file,
    `google.com, ${ADSENSE.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`, 'utf-8');
  console.log('[SSG] 已写入 dist/ads.txt');
}

function headHTML(pageData) {
  const title = pageData.title ? `${pageData.title}_${siteName}` : siteName;
  const description = pageData.description || '';
  const type = pageData.type || 'website';
  const url = pageData.url || '';
  return `
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${escapeHtml(url)}">${adsenseHead()}`;
}

function wrapperHTML({ head, body, assets }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${head}
  <link rel="stylesheet" crossorigin href="${assets.css}">
</head>
<body>
  <div id="app"><div class="page-root">${body}</div></div>
  <script type="module" crossorigin src="${assets.js}"></script>
</body>
</html>`;
}

function assertOutputs(aliasPaths) {
  console.log('\n[SSG] 执行构建后自检...');
  const htmlFiles = [];
  const distPath = join(ROOT, DIST_DIR);

  function walkDir(dir, base = '') {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = join(base, entry.name);
      if (entry.isDirectory()) walkDir(fullPath, relPath);
      else if (entry.name.endsWith('.html')) htmlFiles.push({ full: fullPath, rel: relPath.replace(/\\/g, '/') });
    }
  }
  walkDir(distPath);

  const titles = new Map();
  const descriptions = new Map();
  const errors = [];

  for (const { full, rel } of htmlFiles) {
    if (rel === 'index.html') continue;

    if (rel === '404.html') {
      const content = readFileSync(full, 'utf-8');
      if (!/<meta name="robots" content="noindex/.test(content)) {
        errors.push('404.html: 缺少 noindex 标记');
      }
      if (!/<div id="app">/.test(content)) errors.push('404.html: 缺少 #app 容器');
      continue;
    }

    const content = readFileSync(full, 'utf-8');
    const isAlias = aliasPaths.has(rel);

    const titleMatch = /<title>(.*?)<\/title>/.exec(content);
    if (!titleMatch) {
      errors.push(`${rel}: 缺少 <title> 标签`);
    } else if (!isAlias) {
      const title = titleMatch[1];
      if (titles.has(title)) errors.push(`${rel} 与 ${titles.get(title)} title 重复`);
      titles.set(title, rel);
    }

    const descMatch = /<meta name="description" content="(.*?)"/.exec(content);
    if (!descMatch) {
      errors.push(`${rel}: 缺少 description`);
    } else if (!isAlias) {
      const desc = descMatch[1];
      if (descriptions.has(desc)) errors.push(`${rel} 与 ${descriptions.get(desc)} description 重复`);
      descriptions.set(desc, rel);
    }

    const canonicalMatches = content.match(/<link rel="canonical"[^>]*>/g) || [];
    if (canonicalMatches.length === 0) errors.push(`${rel}: 缺少 canonical`);
    else if (canonicalMatches.length > 1) errors.push(`${rel}: 存在多个 canonical`);

    if (!/<div id="app">/.test(content)) errors.push(`${rel}: 缺少 #app 容器`);

    if (ADSENSE.client && !/<meta name="google-adsense-account"/.test(content)) {
      errors.push(`${rel}: 缺少 google-adsense-account 元标记`);
    }
  }

  if (ADSENSE.client) {
    const adsTxtPath = join(distPath, 'ads.txt');
    if (!existsSync(adsTxtPath)) {
      errors.push('ads.txt: 文件缺失');
    } else {
      const expected = `google.com, ${ADSENSE.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`;
      const actual = readFileSync(adsTxtPath, 'utf-8').trim();
      if (!actual.includes(expected)) errors.push('ads.txt: 记录内容与 client 不匹配');
    }
  }

  console.log(`\n[SSG] 自检结果：${htmlFiles.length} 个 HTML，${titles.size} 个唯一 title`);
  if (errors.length > 0) {
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('\n[SSG] 自检通过！');
}

function cleanGeneratedPages() {
  let removed = 0;
  for (const dir of PAGE_DIRS_TO_CLEAN) {
    const full = join(ROOT, DIST_DIR, dir);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
      removed += 1;
    }
  }
  const notFoundFile = join(ROOT, DIST_DIR, '404.html');
  if (existsSync(notFoundFile)) {
    rmSync(notFoundFile, { force: true });
    removed += 1;
  }
  console.log(`[SSG] 已清理旧页面目录 ${removed} 项（保留 assets/、data/、index.html）`);
}

async function main() {
  cleanGeneratedPages();

  const { env } = await import('../src/env.js');
  const { siteConfig } = await import('../src/lib/site.js');
  const { default: activeRoutes } = await import('../src/routes.js');
  const { assembleHTML } = await import('../src/pages/page-assemble.js');
  const { resolveMeta, aliasTarget, PAGE_REGISTRY } = await import('../src/pages/page-types.js');

  const calendar = readJSON(join(DATA_DIR, 'calendar.json')) || { dates: [], latest: null, kinds: {} };
  const archive = readJSON(join(DATA_DIR, 'archive.json')) || { years: [] };
  const posts = readJSON(join(DATA_DIR, 'posts.json')) || [];

  const dates = calendar.dates || [];
  const latest = calendar.latest || dates[dates.length - 1];
  const limitUpDates = calendar.kinds?.limit_up || dates;
  const dragonTigerDates = calendar.kinds?.dragon_tiger || [];
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const years = (archive.years || []).map((y) => y.year);
  const archiveMonths = (archive.years || []).flatMap((y) => (y.months || []).map((m) => m.month));
  const contentCategories = siteConfig.contentCategories.map((c) => c.id);
  const latestDragonTiger = dragonTigerDates[dragonTigerDates.length - 1];

  function paramSets(routePath) {
    if (routePath === '/zhangtingban/' || routePath === '/zhangtingban/:date/') {
      return routePath === '/zhangtingban/'
        ? (dates.length ? [{}] : [])
        : limitUpDates.map((d) => ({ date: d }));
    }
    if (routePath === '/dragonhu/' || routePath === '/dragonhu/:date/') {
      return routePath === '/dragonhu/'
        ? (latestDragonTiger ? [{}] : [])
        : dragonTigerDates.map((d) => ({ date: d }));
    }
    if (routePath === '/maintheme/') return [{}];
    if (routePath === '/maintheme/:month/') return months.map((m) => ({ month: m }));
    if (routePath === '/days/') return [{}];
    if (routePath === '/days/m/:month/') return archiveMonths.map((m) => ({ month: m }));
    if (routePath === '/days/y/:year/') return years.map((y) => ({ year: y }));
    if (routePath === '/categories/:category/') return contentCategories.map((id) => ({ category: id }));
    if (routePath === '/posts/:id/') return posts.filter((p) => !p.hidden).map((p) => ({ id: p.id }));
    if (routePath === '/about/') return [{ id: 'about' }];
    return [{}];
  }

  function pageCanonical(routePath, urlPath) {
    const target = aliasTarget(routePath);
    if (target === 'latest-limit-up' && latest) {
      return joinSiteUrl(`/zhangtingban/${latest}/`);
    }
    if (target === 'latest-dragon-tiger' && latestDragonTiger) {
      return joinSiteUrl(`/dragonhu/${latestDragonTiger}/`);
    }
    return canonicalFor(urlPath);
  }

  function isAliasRoute(routePath) {
    const target = aliasTarget(routePath);
    if (target === 'latest-limit-up') return Boolean(latest);
    if (target === 'latest-dragon-tiger') return Boolean(latestDragonTiger);
    return false;
  }

  function pageMeta(routePath, params, page, data, ctx) {
    return resolveMeta(routePath, page, data, ctx);
  }

  const entries = [];
  const aliasPaths = new Set();
  const sitemapUrls = [];

  for (const route of activeRoutes) {
    if (route.enabled && !route.enabled()) continue;
    const sets = paramSets(route.path);
    if (!sets.length) continue;

    for (const params of sets) {
      const urlPath = urlPathFor(route.path, params);
      const outPath = outPathFor(urlPath);
      const alias = isAliasRoute(route.path);
      const canonical = pageCanonical(route.path, urlPath);
      const query = route.path === '/categories/:category/' ? { page: '1' } : undefined;
      const priority = PAGE_REGISTRY[route.path]?.priority || '0.5';

      if (alias) aliasPaths.add(outPath);
      else sitemapUrls.push({ loc: canonical, priority });

      entries.push({ route, params, query, urlPath, outPath, canonical, priority });
    }
  }

  console.log(`[SSG] 待生成页面：${entries.length} 个（其中别名页 ${aliasPaths.size} 个）`);

  const ssg = createSSGEngine({
    distDir: DIST_DIR,
    baseUrl: siteBaseUrl,
    basePath,
    siteName,
    template: { head: headHTML, wrapper: wrapperHTML },
    sitemap: { urls: sitemapUrls },
    robotsTxt: {
      content: `User-agent: *\nAllow: /\nSitemap: ${joinSiteUrl('/sitemap.xml')}`
    }
  });

  for (const entry of entries) {
    const { route, params, query, outPath, canonical } = entry;
    const page = route.module;

    ssg.addPage(
      outPath,
      async () => {
        const data = await page.load(params, query);
        const ctx = { env, siteConfig, params, router: null };
        const meta = pageMeta(route.path, params, page, data, ctx);
        return {
          ...data,
          title: meta.title,
          description: meta.description,
          url: canonical,
          type: PAGE_REGISTRY[route.path]?.ogType || 'website',
          __ctx: ctx
        };
      },
      (data) => {
        const ctx = data.__ctx;
        return `\n${assembleHTML(page, data, ctx)}`;
      }
    );
  }

  await ssg.build();

  const { default: notfound } = await import('../src/pages/notfound.js');
  writeNotFoundPage(notfound, siteConfig, env);
  writeCname();
  writeAdsTxt();

  assertOutputs(aliasPaths);
  console.log('[SSG] 构建完成！');
}

function writeNotFoundPage(notfound, siteConfig, env) {
  const assets = findAssets();
  const title = notfound.title({});
  const description = notfound.description ? notfound.description({}) : '';
  const canonical = joinSiteUrl('/404.html');

  const head = `
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${escapeHtml(canonical)}">${adsenseHead()}`;

  const ctx = { env, siteConfig, params: {}, router: null };
  const data = {};
  const header = notfound.header ? notfound.header(data, ctx) : '';
  const body = notfound.render(data, ctx);
  const footer = notfound.footer ? notfound.footer(data, ctx) : '';
  const bodyHTML = `\n${header}\n${body}\n${footer}`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${head}
  <link rel="stylesheet" crossorigin href="${assets.css}">
</head>
<body>
  <div id="app"><div class="page-root">${bodyHTML}</div></div>
  <script type="module" crossorigin src="${assets.js}"></script>
</body>
</html>`;

  writeFileSync(join(ROOT, DIST_DIR, '404.html'), html, 'utf-8');
  console.log('[SSG] 已写入 dist/404.html');
}

function findAssets() {
  const indexFile = join(ROOT, DIST_DIR, 'index.html');
  const content = existsSync(indexFile) ? readFileSync(indexFile, 'utf-8') : '';
  const js = /<script[^>]+src="([^"]+\.js)"/.exec(content)?.[1] || '';
  const css = /<link[^>]+href="([^"]+\.css)"/.exec(content)?.[1] || '';
  return { js, css };
}

function writeCname() {
  const file = join(ROOT, DIST_DIR, 'CNAME');
  if (DEPLOY_ENV === 'custom-domain' && customDomain) {
    const domain = customDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    writeFileSync(file, `${domain}\n`, 'utf-8');
    console.log(`[SSG] 已写入 dist/CNAME（${domain}）`);
    return;
  }
  if (existsSync(file)) {
    rmSync(file, { force: true });
    console.log('[SSG] 已移除残留 dist/CNAME（当前环境非自定义域名）');
  }
}

main().catch((err) => {
  console.error('[SSG] 构建失败:', err);
  process.exit(1);
});