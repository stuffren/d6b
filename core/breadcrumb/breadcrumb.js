/**
 * 面包屑导航组件
 *
 * 纯函数，接受 items 数组，返回 HTML 字符串。
 * 支持链接项（有 href）和纯文本项（当前页，无 href）。
 *
 * 使用示例：
 *   import { breadcrumbHTML } from './core/breadcrumb/breadcrumb.js';
 *   const html = breadcrumbHTML([
 *     { label: '首页', href: '/' },
 *     { label: '龙虎榜', href: '/dragonhu/' },
 *     { label: '2026年11月19日' }
 *   ]);
 */

import { esc } from '../../src/lib/format.js';

export function breadcrumbHTML(items) {
  if (!items || !items.length) return '';

  const parts = items.map((it, i) => {
    const isLast = i === items.length - 1;
    if (isLast || !it.href) {
      return `<span class="breadcrumb-current" aria-current="page">${esc(it.label)}</span>`;
    }
    return `<a href="${it.href}">${esc(it.label)}</a>`;
  });

  return `<nav class="breadcrumb" aria-label="breadcrumb">${parts.join('<span class="sep">/</span>')}</nav>`;
}

export default breadcrumbHTML;