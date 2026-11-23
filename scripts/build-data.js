import { readFile, writeFile, rename, mkdir, readdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { existsSync, rmSync } from 'fs';

const ROOT = process.cwd();
const GATHER_DIR = join(ROOT, 'gather', 'data');
const LIMIT_UP_DIR = join(GATHER_DIR, 'limit_up');
const DRAGON_TIGER_DIR = join(GATHER_DIR, 'dragon_tiger');
const META_DIR = join(GATHER_DIR, 'meta');
const TRADE_CAL = join(GATHER_DIR, '.trade_cal.csv');
const DIST_DATA = join(ROOT, 'dist', 'data');

async function buildPosts(distData, root) {
  const contentDir = join(root, 'content');
  if (!existsSync(contentDir)) {
    warn('content/ 目录不存在，跳过 posts.json 生成');
    return;
  }

  const posts = [];
  const categories = ['notes', 'methods', 'about'];
  const catLabels = { notes: '复盘笔记', methods: '投资方法', about: '关于' };

  for (const cat of categories) {
    const catDir = join(contentDir, cat);
    if (!existsSync(catDir)) continue;

    const files = await readdir(catDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const abs = join(catDir, file);
      const text = await readFile(abs, 'utf8');
      const filename = file.replace(/\.md$/, '');
      let id = filename;

      let title = id;
      let date = '';
      let summary = '';
      let tags = [];

      const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (fmMatch) {
        const fm = fmMatch[1];
        for (const line of fm.split(/\r?\n/)) {
          const m = line.match(/^(\w+):\s*(.*)$/);
          if (!m) continue;
          const [, key, val] = m;
          if (key === 'id') id = val.trim();
          else if (key === 'title') title = val.replace(/^["']|["']$/g, '');
          else if (key === 'date') date = val.trim();
          else if (key === 'summary') summary = val.replace(/^["']|["']$/g, '');
          else if (key === 'tags') {
            const tagMatch = val.match(/\[(.*)\]/);
            if (tagMatch) tags = tagMatch[1].split(',').map((t) => t.trim().replace(/["']/g, ''));
          }
        }
      }

      if (!date) {
        warn(`文章 ${id} 缺少 date 字段，跳过`);
        continue;
      }

      const extra = cat === 'about' ? { hidden: true } : {};
      posts.push({ id, filename, title, date, summary, tags, category: cat, categoryLabel: catLabels[cat] || cat, ...extra });
    }
  }

  posts.sort((a, b) => b.date.localeCompare(a.date));
  await atomicWriteJson(join(distData, 'posts.json'), posts);
  console.log(`[build-data] posts.json 写入 ${posts.length} 篇`);
}

const SCHEMA_VERSION = '1.0';
const TIERS = [2, 3, 4, 5, 6, 7, '8+'];
const TOP_N = 10;
const OTHER_NAME = '其他概念';
const TYPE_RANK = { sector: 0, sentiment: 1, event: 2, other: 3 };

const warns = [];
let generatedAt = '';

function warn(msg) {
  warns.push(msg);
  console.log(`[build-data] warn: ${msg}`);
}

function fail(msg) {
  console.error(`[build-data] ERROR: ${msg}`);
  process.exit(1);
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const monthOf = (d) => d.slice(0, 7);
const yearOf = (d) => d.slice(0, 4);

async function run(key, msg, fn) {
  console.log(`[build-data] ${key} ${msg}`);
  return await fn();
}

async function atomicWriteJson(absPath, data) {
  await mkdir(dirname(absPath), { recursive: true });
  const tmp = absPath + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, absPath);
}

function baseDoc(extra) {
  return { schema_version: SCHEMA_VERSION, generated_at: generatedAt, ...extra };
}

async function readTradeCal() {
  if (!existsSync(TRADE_CAL)) fail(`交易日历不存在: ${TRADE_CAL}`);
  const text = await readFile(TRADE_CAL, 'utf8');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cal = new Set();
  for (const line of lines) {
    if (line === 'trade_date') continue;
    if (isDate(line)) cal.add(line);
  }
  if (!cal.size) fail('交易日历为空');
  return cal;
}

async function scanDir(dir, label, cal) {
  if (!existsSync(dir)) {
    warn(`${label} 目录不存在，按空处理: ${dir}`);
    return [];
  }
  const entries = await readdir(dir);
  const dates = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const stem = basename(name, '.json');
    if (!isDate(stem)) {
      warn(`${label} 文件名非 YYYY-MM-DD，跳过: ${name}`);
      continue;
    }
    if (!cal.has(stem)) {
      warn(`${label} 文件日期不在交易日历内，跳过: ${name}`);
      continue;
    }
    dates.push(stem);
  }
  return dates.sort();
}

async function loadJson(absPath, label) {
  let text;
  try {
    text = await readFile(absPath, 'utf8');
  } catch (e) {
    fail(`${label} 读取失败: ${absPath}\n${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${label} JSON 解析失败: ${absPath}\n${e.message}`);
  }
}

function assertLimitUp(doc, date) {
  const loc = `limit_up/${date}.json`;
  if (!Array.isArray(doc.stocks) || doc.stocks.length === 0) {
    fail(`${loc} 断言失败: stocks 为空`);
  }
  const seen = new Set();
  for (const s of doc.stocks) {
    if (!Number.isInteger(s.board_count) || s.board_count < 1) {
      fail(`${loc} 断言失败: ${s.code} board_count 非正整数 (${s.board_count})`);
    }
    if (typeof s.theme !== 'string' || !s.theme.trim()) {
      fail(`${loc} 断言失败: ${s.code} theme 为空`);
    }
    if (seen.has(s.code)) fail(`${loc} 断言失败: code 重复 ${s.code}`);
    seen.add(s.code);
  }
}

function computeDailyStats(date, doc, prev) {
  const stocks = doc.stocks;
  const nonDelisting = stocks.filter((s) => s.is_delisting !== true);
  const limitUpCount = stocks.length;
  const maxBoard = nonDelisting.length ? Math.max(...nonDelisting.map((s) => s.board_count)) : 0;
  const lianbanCount = nonDelisting.filter((s) => s.board_count >= 2).length;
  const delistingCount = stocks.filter((s) => s.is_delisting === true).length;

  let promotionRate = null;
  if (prev && typeof prev.limit_up_count === 'number' && prev.limit_up_count > 0) {
    promotionRate = Math.round((lianbanCount / prev.limit_up_count) * 1000) / 10;
  }

  const themes = doc.themes || [];
  const otherCount = stocks.filter((s) => s.theme === OTHER_NAME).length;

  return {
    date,
    limit_up_count: limitUpCount,
    max_board: maxBoard,
    lianban_count: lianbanCount,
    delisting_count: delistingCount,
    promotion_rate: promotionRate,
    theme_count: themes.length,
    other_count: otherCount
  };
}

function tierOf(boardCount) {
  if (boardCount >= 8) return '8+';
  if (boardCount >= 2 && boardCount <= 7) return String(boardCount);
  return null;
}

function buildLadder(docsByDate, monthsSet) {
  const byMonth = new Map();
  for (const month of monthsSet) byMonth.set(month, { dates: [], cells: {} });

  for (const [date, doc] of docsByDate) {
    const month = monthOf(date);
    const bucket = byMonth.get(month);
    bucket.dates.push(date);

    const nonDelisting = doc.stocks.filter((s) => s.is_delisting !== true);
    if (!nonDelisting.length) continue;

    const cells = {};
    for (const s of nonDelisting) {
      const tier = tierOf(s.board_count);
      if (!tier) continue;
      if (!cells[tier]) cells[tier] = [];
      const item =
        tier === '8+'
          ? { code: s.code, name: s.name, board_count: s.board_count }
          : { code: s.code, name: s.name, seal_time: s.seal_time };
      cells[tier].push({ item, _board: s.board_count, _amount: s.seal_amount });
    }

    for (const tier of Object.keys(cells)) {
      cells[tier].sort((a, b) => {
        if (b._board !== a._board) return b._board - a._board;
        if (b._amount !== a._amount) return b._amount - a._amount;
        return a.item.code < b.item.code ? -1 : a.item.code > b.item.code ? 1 : 0;
      });
      cells[tier] = cells[tier].map((x) => x.item);
    }
    bucket.cells[date] = cells;
  }

  const out = new Map();
  for (const [month, bucket] of byMonth) {
    if (!bucket.dates.length) continue;
    out.set(month, baseDoc({
      month,
      tiers: TIERS,
      dates: bucket.dates,
      cells: bucket.cells
    }));
  }
  return out;
}

function pickLeader(stocks) {
  const nonDelisting = stocks.filter((s) => s.is_delisting !== true);
  if (!nonDelisting.length) return null;
  const sorted = [...nonDelisting].sort((a, b) => {
    if (b.board_count !== a.board_count) return b.board_count - a.board_count;
    if (b.seal_amount !== a.seal_amount) return b.seal_amount - a.seal_amount;
    if (a.seal_time !== b.seal_time) return a.seal_time < b.seal_time ? -1 : 1;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
  const top = sorted[0];
  return { code: top.code, name: top.name, board_count: top.board_count };
}

function buildDailyTopics(doc) {
  const themes = doc.themes || [];
  const counts = new Map();
  for (const s of doc.stocks) {
    if (!counts.has(s.theme)) counts.set(s.theme, 0);
    counts.set(s.theme, counts.get(s.theme) + 1);
  }

  const candidates = themes
    .filter((t) => t.type === 'sector' || t.type === 'sentiment')
    .map((t) => ({
      name: t.name,
      type: t.type,
      count: counts.get(t.name) || 0,
      rank: TYPE_RANK[t.type] ?? 9
    }))
    .filter((t) => t.count > 0);

  const sorted = candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (b.count !== a.count) return b.count - a.count;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const topics = sorted.slice(0, TOP_N).map((t) => ({ name: t.name, type: t.type, count: t.count }));
  const hasOther = themes.some((t) => t.name === OTHER_NAME) || counts.has(OTHER_NAME);
  return { topics, hasOther };
}

function buildMainline(docsByDate, monthsSet) {
  const byMonth = new Map();
  for (const month of monthsSet) {
    byMonth.set(month, {
      dates: [],
      themeMap: new Map(),
      otherCounts: {},
      days: [],
      hasOther: false
    });
  }

  for (const [date, doc] of docsByDate) {
    const month = monthOf(date);
    const bucket = byMonth.get(month);
    if (!bucket.dates.includes(date)) bucket.dates.push(date);

    const typeByName = new Map();
    for (const t of doc.themes || []) typeByName.set(t.name, t.type);

    const counts = new Map();
    for (const s of doc.stocks) {
      counts.set(s.theme, (counts.get(s.theme) || 0) + 1);
    }

    for (const [name, cnt] of counts) {
      if (name === OTHER_NAME) {
        bucket.otherCounts[date] = cnt;
        bucket.hasOther = true;
        continue;
      }
      const type = typeByName.get(name);
      if (type !== 'sector' && type !== 'sentiment') continue;
      if (!bucket.themeMap.has(name)) {
        bucket.themeMap.set(name, { name, type, total: 0, counts: {} });
      }
      const rec = bucket.themeMap.get(name);
      rec.counts[date] = cnt;
      rec.total += cnt;
    }

    const leader = pickLeader(doc.stocks);
    const { topics } = buildDailyTopics(doc);
    const day = { date, topics };
    if (leader) day.leader = leader;
    bucket.days.push(day);
  }

  const out = new Map();
  for (const [month, bucket] of byMonth) {
    if (!bucket.dates.length) continue;
    const themes = [...bucket.themeMap.values()].sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const ra = TYPE_RANK[a.type] ?? 9;
      const rb = TYPE_RANK[b.type] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    const doc = baseDoc({
      month,
      dates: bucket.dates.slice().sort(),
      themes,
      days: bucket.days.slice().sort((a, b) => (a.date < b.date ? -1 : 1))
    });
    if (bucket.hasOther) {
      const total = Object.values(bucket.otherCounts).reduce((sum, n) => sum + n, 0);
      doc.other = { name: OTHER_NAME, total, counts: bucket.otherCounts };
    }
    out.set(month, doc);
  }
  return out;
}

function buildCalendar(calendar, limitUpDates, dragonTigerDates) {
  const dateSet = new Set([...limitUpDates, ...dragonTigerDates]);
  const dates = [...dateSet].sort();
  if (!dates.length) fail('calendar 无任何日期');
  return baseDoc({
    latest: dates[dates.length - 1],
    earliest: dates[0],
    dates,
    kinds: {
      limit_up: limitUpDates.slice().sort(),
      dragon_tiger: dragonTigerDates.slice().sort()
    }
  });
}

function buildArchive(calendar) {
  const yearMap = new Map();
  for (const date of calendar.dates) {
    const year = yearOf(date);
    const month = monthOf(date);
    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const monthMap = yearMap.get(year);
    if (!monthMap.has(month)) monthMap.set(month, []);
    monthMap.get(month).push(date);
  }

  const hasLimitUp = new Set(calendar.kinds.limit_up);
  const hasDragonTiger = new Set(calendar.kinds.dragon_tiger);

  const years = [...yearMap.keys()].sort().reverse().map((year) => {
    const monthMap = yearMap.get(year);
    const months = [...monthMap.keys()].sort().reverse().map((month) => {
      const days = monthMap.get(month).slice().sort().reverse().map((date) => ({
        date,
        limit_up: hasLimitUp.has(date),
        dragon_tiger: hasDragonTiger.has(date)
      }));
      return { month, count: days.length, days };
    });
    const count = months.reduce((sum, m) => sum + m.count, 0);
    return { year, count, months };
  });

  return baseDoc({ years });
}

async function main() {
  const t0 = Date.now();
  console.log('[build-data] 开始');

  if (existsSync(DIST_DATA)) {
    rmSync(DIST_DATA, { recursive: true, force: true });
    console.log('[build-data] 已清空 dist/data，避免残留过期文件');
  }

  const lastUpdate = await loadJson(join(META_DIR, 'last_update.json'), 'meta/last_update.json');
  generatedAt = lastUpdate.updated_at;
  if (!generatedAt) fail('meta/last_update.json 缺少 updated_at');

  const cal = await run('1/12', '读取交易日历', () => readTradeCal());
  const limitUpDates = await run('2/12', '扫描 limit_up', () => scanDir(LIMIT_UP_DIR, 'limit_up', cal));
  const dragonTigerDates = await run('3/12', '扫描 dragon_tiger', () => scanDir(DRAGON_TIGER_DIR, 'dragon_tiger', cal));
  if (!limitUpDates.length) fail('limit_up 目录无有效数据文件');
  if (limitUpDates.length && !dragonTigerDates.length) {
    warn('dragon_tiger 目录为空，但 limit_up 有数据——龙虎榜数据可能缺失');
  }

  const docsByDate = new Map();
  let totalStocks = 0;
  for (const date of limitUpDates) {
    const doc = await loadJson(join(LIMIT_UP_DIR, `${date}.json`), `limit_up/${date}.json`);
    assertLimitUp(doc, date);
    docsByDate.set(date, doc);
    totalStocks += doc.stocks.length;
  }
  console.log(`[build-data] 4/12 解析+断言通过 ${docsByDate.size} 天`);

  const statsDays = [];
  const prevByDate = new Map();
  for (const date of docsByDate.keys()) {
    prevByDate.set(date, statsDays.length ? statsDays[statsDays.length - 1] : null);
    statsDays.push(computeDailyStats(date, docsByDate.get(date), prevByDate.get(date)));
  }
  const latestDate = limitUpDates[limitUpDates.length - 1];
  await atomicWriteJson(join(DIST_DATA, 'stats.json'), baseDoc({
    latest_date: latestDate,
    days: statsDays
  }));
  console.log(`[build-data] 5/12 stats 写入 ${statsDays.length} 天`);

  const monthsSet = new Set(limitUpDates.map(monthOf));
  const ladder = buildLadder(docsByDate, monthsSet);
  for (const [month, doc] of ladder) {
    await atomicWriteJson(join(DIST_DATA, 'ladder', `${month}.json`), doc);
  }
  if (limitUpDates.length > 0 && ladder.size === 0) {
    warn('ladder 产物为空——可能所有 stocks 都被过滤（delisting 或 tier 不匹配）');
  }
  console.log(`[build-data] 6/12 ladder 写入 ${ladder.size} 个月`);

  const mainline = buildMainline(docsByDate, monthsSet);
  let mainlineThemeCount = 0;
  for (const [month, doc] of mainline) {
    await atomicWriteJson(join(DIST_DATA, 'mainline', `${month}.json`), doc);
    mainlineThemeCount += doc.themes.length;
  }
  if (limitUpDates.length > 0 && mainline.size === 0) {
    warn('mainline 产物为空——题材聚合可能异常');
  }
  console.log(`[build-data] 7/12 mainline 写入 ${mainline.size} 个月 / ${mainlineThemeCount} 题材记录`);

  const calendar = buildCalendar(cal, limitUpDates, dragonTigerDates);
  await atomicWriteJson(join(DIST_DATA, 'calendar.json'), calendar);
  console.log(`[build-data] 8/12 calendar 写入 ${calendar.dates.length} 天`);

  const archive = buildArchive(calendar);
  await atomicWriteJson(join(DIST_DATA, 'archive.json'), archive);
  console.log(`[build-data] 9/12 archive 写入 ${archive.years.length} 年`);

  const versionDoc = baseDoc({
    updated_at: generatedAt,
    latest_date: latestDate,
    latest_kind: lastUpdate.latest_kind || ''
  });
  await atomicWriteJson(join(DIST_DATA, 'version.json'), versionDoc);
  console.log('[build-data] 10/12 version.json 写入');

  await buildPosts(DIST_DATA, ROOT);
  console.log('[build-data] 11/12 posts.json 写入');

  const ms = Date.now() - t0;
  console.log(`[build-data] 12/12 完成: ${limitUpDates.length} days / limit_up ${totalStocks} stocks / dragon_tiger ${dragonTigerDates.length} files (${ms}ms)`);
  if (warns.length) console.log(`[build-data] 共 ${warns.length} 条 warn`);
}

main().catch((e) => {
  console.error('[build-data] 未捕获异常');
  console.error(e);
  process.exit(1);
});