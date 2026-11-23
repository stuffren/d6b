#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(__dirname, 'schema');
const SCHEMA_PATH = path.join(SCHEMA_DIR, 'limit_up.schema.json');
const LHB_SCHEMA_PATH = path.join(SCHEMA_DIR, 'dragon_tiger.schema.json');
const DICT_PATH = path.join(ROOT, 'gather', 'data', 'meta', 'themes.json');

const ERRORS = [];
const WARNINGS = [];

function err(file, locator, msg) {
  ERRORS.push({ file, locator, msg });
}
function warn(file, locator, msg) {
  WARNINGS.push({ file, locator, msg });
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchType(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function resolveRef(rootSchema, ref) {
  if (!ref || !ref.startsWith('#/')) return null;
  return ref.slice(2).split('/').reduce((acc, key) => (acc ? acc[key] : undefined), rootSchema);
}

function validateNode(value, schema, loc, file, rootSchema) {
  if (schema.$ref) {
    const target = resolveRef(rootSchema, schema.$ref);
    if (!target) {
      err(file, loc, '无法解析 $ref: ' + schema.$ref);
      return;
    }
    validateNode(value, target, loc, file, rootSchema);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matchType(value, t))) {
      err(file, loc, '类型应为 ' + types.join('|') + '，实际为 ' + typeOf(value));
      return;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    err(file, loc, '取值必须为 ' + JSON.stringify(schema.const) + '，实际为 ' + JSON.stringify(value));
  }

  if (schema.enum && !schema.enum.includes(value)) {
    err(file, loc, '取值必须属于 ' + JSON.stringify(schema.enum) + '，实际为 ' + JSON.stringify(value));
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      err(file, loc, '长度不得小于 ' + schema.minLength + '，实际为 ' + value.length);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      err(file, loc, '长度不得大于 ' + schema.maxLength + '，实际为 ' + value.length);
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        err(file, loc, '格式不匹配 ' + schema.pattern + '，实际为 ' + JSON.stringify(value));
      }
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      err(file, loc, '不得小于 ' + schema.minimum + '，实际为 ' + value);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      err(file, loc, '不得大于 ' + schema.maximum + '，实际为 ' + value);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      err(file, loc, '必须大于 ' + schema.exclusiveMinimum + '，实际为 ' + value);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      err(file, loc, '必须小于 ' + schema.exclusiveMaximum + '，实际为 ' + value);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      err(file, loc, '元素数量不得少于 ' + schema.minItems + '，实际为 ' + value.length);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      err(file, loc, '元素数量不得多于 ' + schema.maxItems + '，实际为 ' + value.length);
    }
    if (schema.items) {
      value.forEach((item, i) => validateNode(item, schema.items, loc + '[' + i + ']', file, rootSchema));
    }
  }

  if (typeOf(value) === 'object') {
    if (schema.required) {
      schema.required.forEach(key => {
        if (!(key in value)) err(file, loc, '缺少必填字段 ' + key);
      });
    }
    const props = schema.properties || {};
    Object.keys(value).forEach(key => {
      if (props[key]) {
        validateNode(value[key], props[key], loc + '.' + key, file, rootSchema);
      } else if (schema.additionalProperties === false) {
        err(file, loc, '存在未声明字段 ' + key);
      }
    });
  }
}

function isValidClock(t) {
  if (t === '') return true;
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t);
  if (!m) return false;
  return +m[1] < 24 && +m[2] < 60 && +m[3] < 60;
}

function validateBusiness(doc, file) {
  const themeNames = new Set();
  doc.themes.forEach((t, i) => {
    if (themeNames.has(t.name)) err(file, 'themes[' + i + ']', '题材名重复: ' + t.name);
    themeNames.add(t.name);
  });

  doc.themes.forEach((t, i) => {
    if (t.name === '其他概念' && t.type !== 'other') {
      err(file, 'themes[' + i + ']', '其他概念 的 type 必须为 other，实际为 ' + t.type);
    }
    if (t.name !== '其他概念' && t.type === 'other') {
      err(file, 'themes[' + i + ']', '仅 其他概念 允许使用 type=other，实际为 ' + t.name);
    }
  });

  if (!themeNames.has('其他概念')) {
    warn(file, 'themes', '缺少兜底桶 其他概念，当日题材可能未完全覆盖');
  }

  const seenCode = new Set();
  doc.stocks.forEach((s, i) => {
    const loc = 'stocks[' + i + ']';
    if (seenCode.has(s.code)) err(file, loc, '股票代码重复: ' + s.code);
    seenCode.add(s.code);

    if (!themeNames.has(s.theme)) {
      err(file, loc, 'theme 未在 themes[].name 中声明: ' + s.theme);
    }

    if (!isValidClock(s.seal_time)) {
      err(file, loc, 'seal_time 不是合法时刻: ' + JSON.stringify(s.seal_time));
    }

    s.tags.forEach((tag, j) => {
      if (!tag.trim()) err(file, loc + '.tags[' + j + ']', '存在空标签');
      else if (!s.reason.includes(tag)) {
        err(file, loc + '.tags[' + j + ']', '标签不在 reason 原文中: ' + tag);
      }
    });

    if (/\+\+|、、|,,/.test(s.reason)) {
      err(file, loc, 'reason 含连续分隔符，会产生空标签: ' + JSON.stringify(s.reason));
    }

    const hasTui = /退/.test(s.name);
    const flag = s.is_delisting === undefined ? false : s.is_delisting;
    if (hasTui !== flag) {
      err(file, loc, 'is_delisting 与名称不一致（名称含退=' + hasTui + '，标记=' + flag + '）');
    }
  });

  const used = new Set(doc.stocks.map(s => s.theme));
  doc.themes.forEach((t, i) => {
    if (!used.has(t.name)) err(file, 'themes[' + i + ']', '空题材（无任何股票归属）: ' + t.name);
  });
}

function validateDictionary(doc, file) {
  if (!fs.existsSync(DICT_PATH)) {
    err(file, 'dictionary', '题材字典文件缺失，校验器配置错误: ' + DICT_PATH);
    return;
  }
  const dict = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  const allowed = new Set(Object.keys(dict.canonical || {}));
  (dict.event || []).forEach(w => allowed.add(w));
  Object.keys(dict.sentiment || {}).forEach(w => allowed.add(w));
  allowed.add('其他概念');
  const unknown = [...new Set(doc.stocks.map(s => s.theme))].filter(n => !allowed.has(n));
  if (unknown.length) {
    err(file, 'theme', '未命中题材字典，需加入 canonical / event / sentiment / ignore: ' + unknown.join(', '));
  }
}

function validateLhbBusiness(doc, file) {
  const LONG_SPAN = /连续10个交易日|严重异常期间/;
  const seenCode = new Set();
  doc.stocks.forEach((s, i) => {
    const loc = 'stocks[' + i + ']';
    if (seenCode.has(s.code)) err(file, loc, '股票代码重复: ' + s.code);
    seenCode.add(s.code);

    const seenReason = new Set();
    s.entries.forEach((e, j) => {
      const eloc = loc + '.entries[' + j + ']';
      if (seenReason.has(e.reason)) {
        err(file, eloc, '同一股票的上榜原因重复: ' + e.reason);
      }
      seenReason.add(e.reason);

      const tolerance = LONG_SPAN.test(e.reason) ? 100 : 0.02;
      const diff = Math.abs((e.buy_amount - e.sell_amount) - e.net_amount);
      if (diff > tolerance) {
        err(file, eloc, 'net_amount 与 buy_amount-sell_amount 不一致（差 ' +
          diff.toFixed(2) + '，容差 ' + tolerance + '）：' + e.net_amount + ' vs ' +
          (e.buy_amount - e.sell_amount).toFixed(2));
      }

      [['buy', e.seats.buy], ['sell', e.seats.sell]].forEach(([side, list]) => {
        const amounts = list.map(it => it.amount);
        if (list.length && amounts.every(v => v === 0)) {
          err(file, eloc + '.seats.' + side, '席位金额全为 0，属空占位或解析失败');
        }
        const desc = amounts.every((v, k) => k === 0 || v <= amounts[k - 1]);
        if (!desc) {
          warn(file, eloc + '.seats.' + side, '席位未按金额降序排列');
        }
      });
    });
  });
}

function collectTargets(args) {
  if (args.length) {
    return args.flatMap(a => {
      const p = path.resolve(a);
      if (!fs.existsSync(p)) return [];
      if (fs.statSync(p).isDirectory()) {
        return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
      }
      return [p];
    });
  }
  const dataDir = path.join(ROOT, 'data', 'limit_up');
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).some(f => f.endsWith('.json'))) {
    return fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dataDir, f));
  }
  const sampleDir = path.join(ROOT, 'test_json');
  if (!fs.existsSync(sampleDir)) return [];
  return fs.readdirSync(sampleDir).filter(f => f.endsWith('.json')).sort().map(f => path.join(sampleDir, f));
}

function detectKind(doc, base) {
  if (Array.isArray(doc.themes) && Array.isArray(doc.stocks)) return 'limit_up';
  if (Array.isArray(doc.stocks) && doc.stocks.some(s => s && Array.isArray(s.entries))) {
    return 'dragon_tiger';
  }
  if (base.startsWith('dragon_tiger') || base.startsWith('lhb')) return 'dragon_tiger';
  return 'limit_up';
}

function main() {
  const schemas = {
    limit_up: JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')),
    dragon_tiger: JSON.parse(fs.readFileSync(LHB_SCHEMA_PATH, 'utf8')),
  };
  const targets = collectTargets(process.argv.slice(2));

  if (!targets.length) {
    console.error('未找到待校验文件。用法: node scripts/validate-data.js [文件或目录...]');
    process.exit(1);
  }

  console.log('数据契约: ' + path.relative(ROOT, SCHEMA_DIR));
  console.log('待校验文件: ' + targets.length + ' 个\n');

  const rows = [];
  targets.forEach(file => {
    const rel = path.relative(ROOT, file);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      err(rel, '', 'JSON 解析失败: ' + e.message);
      rows.push({ rel, doc: null, kind: null });
      return;
    }

    const base = path.basename(file, '.json');
    const kind = detectKind(doc, base);
    if (kind === 'limit_up' && base.startsWith('limit_up_') && base !== 'limit_up_' + doc.trade_date) {
      err(rel, '', '文件名与 trade_date 不一致: 文件名=' + base + '，trade_date=' + doc.trade_date);
    }
    if (kind === 'dragon_tiger' && base.startsWith('dragon_tiger_') && base !== 'dragon_tiger_' + doc.trade_date) {
      err(rel, '', '文件名与 trade_date 不一致: 文件名=' + base + '，trade_date=' + doc.trade_date);
    }

    validateNode(doc, schemas[kind], '$', rel, schemas[kind]);
    if (kind === 'limit_up') {
      validateBusiness(doc, rel);
      validateDictionary(doc, rel);
    } else {
      validateLhbBusiness(doc, rel);
    }
    rows.push({ rel, doc, kind });
  });

  rows.forEach(({ rel, doc, kind }) => {
    const ok = !ERRORS.filter(e => e.file === rel).length;
    const icon = ok ? '✓' : '✗';
    console.log(icon + ' ' + rel + (doc ? ' (' + kind + ')' : ''));
  });

  if (ERRORS.length) {
    console.error('\n错误 ' + ERRORS.length + ' 个：');
    ERRORS.forEach(({ file, locator, msg }) => {
      console.error('  [' + file + ']' + (locator ? ' ' + locator : '') + ' ' + msg);
    });
  }
  if (WARNINGS.length) {
    console.warn('\n警告 ' + WARNINGS.length + ' 个：');
    WARNINGS.forEach(({ file, locator, msg }) => {
      console.warn('  [' + file + ']' + (locator ? ' ' + locator : '') + ' ' + msg);
    });
  }

  if (ERRORS.length) process.exit(1);
  else console.log('\n✓ 全部通过');
}

main();