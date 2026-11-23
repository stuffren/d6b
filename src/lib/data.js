import { env } from '../env.js';

const DATA = `${env.basePathWithSlash}${env.dataDir}/`;

const VERSION = window.__DATA_VERSION__ || null;
const inflight = new Map();
let warned = false;

export class DataError extends Error {
  constructor(path, status) {
    super(`数据加载失败: ${path} (HTTP ${status})`);
    this.name = 'DataError';
    this.path = path;
    this.status = status;
  }
}

export function dataUrl(path) {
  const p = `${DATA}${path.replace(/^\//, '')}`;
  if (VERSION) return `${p}?v=${VERSION}`;
  if (!warned) {
    warned = true;
    console.warn('[data] 未注入 __DATA_VERSION__，请求不带 ?v= 版本号');
  }
  return p;
}

export async function getJSON(path) {
  const url = dataUrl(path);
  if (inflight.has(url)) return inflight.get(url);

  const task = (async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new DataError(path, res.status);
    return res.json();
  })().finally(() => inflight.delete(url));

  inflight.set(url, task);
  return task;
}

export const api = {
  version: () => getJSON('version.json'),
  stats: () => getJSON('stats.json'),
  calendar: () => getJSON('calendar.json'),
  archive: () => getJSON('archive.json'),
  ladder: (month) => getJSON(`ladder/${month}.json`),
  mainline: (month) => getJSON(`mainline/${month}.json`)
};

const renderedCache = new Map();
const RENDERED_CACHE_LIMIT = 30;

export function extractContentFromHtml(html, selector) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector(selector)?.innerHTML || '';
}

export async function loadRenderedContent(pathname, selector) {
  const rel = String(pathname).replace(/^\//, '');
  const url = `${env.basePath}${rel}`;
  const key = `${url}#${selector}`;
  if (renderedCache.has(key)) return renderedCache.get(key);

  const res = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new DataError(rel, res.status);

  const html = extractContentFromHtml(await res.text(), selector);
  if (!html.trim()) throw new Error(`页面内容选择器未命中: ${selector} @ ${rel}`);

  if (renderedCache.size >= RENDERED_CACHE_LIMIT) renderedCache.clear();
  renderedCache.set(key, html);
  return html;
}

export async function loadWindow(fetcher, dates) {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const files = await Promise.all(months.map((m) => fetcher(m)));
  return { months, files };
}