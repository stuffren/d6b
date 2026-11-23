/**
 * 分页组件
 *
 * 纯函数，接受分页参数，返回 HTML 字符串。
 * 适用于 SSR/SSG 渲染，分页链接通过 URL query 传递页码。
 *
 * 使用示例：
 *   import { paginationHTML } from '../../core/Pagination/Pagination.js';
 *   const html = paginationHTML({
 *     current: 2,
 *     total: 5,
 *     baseUrl: '/categories/notes/?page='
 *   });
 */

import { esc } from '../../src/lib/format.js';

export function paginationHTML({ current, total, baseUrl }) {
  if (!total || total <= 1) return '';

  const prevDisabled = current <= 1 ? ' disabled' : '';
  const nextDisabled = current >= total ? ' disabled' : '';
  const prevHref = current > 1 ? `${esc(baseUrl)}${current - 1}` : '#';
  const nextHref = current < total ? `${esc(baseUrl)}${current + 1}` : '#';

  return `
<nav class="pagination" aria-label="分页">
  <a class="page-btn${prevDisabled}" href="${prevHref}">上一页</a>
  <span class="page-info">${current} / ${total}</span>
  <a class="page-btn${nextDisabled}" href="${nextHref}">下一页</a>
</nav>`;
}

export default paginationHTML;