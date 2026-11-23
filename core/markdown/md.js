/**
 * Markdown 渲染模块 - 浏览器端
 *
 * 特性：
 * - Markdown 转 HTML（基于 Marked.js）
 * - 代码块语法高亮（基于 highlight.js）
 * - 配套工具函数：摘要提取、slug 生成、HTML 转义
 *
 * 使用示例：
 *   import { renderMarkdown, extractExcerpt } from './core/markdown/md.js';
 *   const html = renderMarkdown('# Hello World');
 *   const excerpt = extractExcerpt(markdown);
 */

import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);

// 配置 marked 使用 highlight.js
marked.use({
  renderer: {
    code(codeText, lang) {
      const safeText = codeText || '';
      const validLang = lang && hljs.getLanguage(lang);
      const highlighted = validLang
        ? hljs.highlight(safeText, { language: lang }).value
        : hljs.highlightAuto(safeText).value;
      return `<pre><code class="hljs language-${lang || 'plaintext'}">${highlighted}</code></pre>`;
    }
  }
});

/**
 * 渲染 Markdown 为 HTML
 * @param {string} markdown - Markdown 文本
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(markdown) {
  if (!markdown) return '';
  return marked.parse(markdown);
}

/**
 * 从 Markdown 正文中提取纯文本摘要
 * @param {string} body - Markdown 正文
 * @param {number} [maxLength=160] - 最大长度
 * @returns {string} 摘要文本
 */
export function extractExcerpt(body, maxLength = 160) {
  if (!body) return '';
  const text = body.replace(/[#*`[\]()]/g, '').replace(/\n+/g, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

/**
 * 生成 URL 友好的 slug
 * @param {string} str - 原始字符串
 * @returns {string} slug 字符串
 */
export function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}

/**
 * 格式化日期
 * @param {string} dateStr - ISO 日期字符串
 * @param {string} [locale='zh-CN'] - 语言区域
 * @returns {string} 格式化后的日期
 */
export function formatDate(dateStr, locale = 'zh-CN') {
  return new Date(dateStr).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}