import { env } from '../env.js';
import { api, getJSON } from '../lib/data.js';
import { siteConfig } from '../lib/site.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { cnDate } from '../lib/date.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';
import { paginationHTML } from '../../core/Pagination/Pagination.js';

const PAGE_SIZE = 10;

function buildPostsMap(posts) {
  const map = {};
  for (const p of posts) {
    if (!map[p.category]) map[p.category] = [];
    map[p.category].push(p);
  }
  for (const cats in map) {
    map[cats].sort((a, b) => b.date.localeCompare(a.date));
  }
  return map;
}

function postItemHTML(post) {
  const summary = post.summary || '';
  const tags = (post.tags || []).map((t) => `<span class="tag">${t}</span>`).join('');
  return `
<article class="post-item">
  <h2 class="post-item-title"><a href="${env.basePath}posts/${post.id}/">${post.title}</a></h2>
  <div class="post-item-meta">
    <time>${cnDate(post.date)}</time>
    ${tags ? `<span class="post-item-tags">${tags}</span>` : ''}
  </div>
  <p class="post-item-summary">${summary}</p>
  <a class="post-item-readmore" href="${env.basePath}posts/${post.id}/">阅读全文 →</a>
</article>`;
}

export default {
  async load(params, query) {
    const category = params.category || 'notes';
    const page = parseInt(query?.page || '1', 10);

    let posts = [];
    try {
      const all = await getJSON('posts.json');
      const map = buildPostsMap(all);
      posts = map[category] || [];
    } catch (_) {}

    const cat = siteConfig.categories.find((c) => c.id === category);
    const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const pagePosts = posts.slice(start, start + PAGE_SIZE);

    return {
      category,
      label: cat ? cat.label : category,
      posts: pagePosts,
      currentPage: safePage,
      totalPages,
      total: posts.length
    };
  },

  render(data) {
    const { category, label, posts, currentPage, totalPages, total } = data;

    const listHTML = posts.length > 0
      ? posts.map((p) => postItemHTML(p)).join('')
      : '<p class="empty">暂无文章</p>';

    return `
<div class="page">
  ${breadcrumbHTML([
    { label: '首页', href: env.basePath },
    { label, href: `${env.basePath}categories/${category}/` }
  ])}
  <h1 class="page-title">${label}</h1>
  <p class="page-stats">共 ${total} 篇文章</p>
  <div class="post-list">${listHTML}</div>
  ${paginationHTML({
    current: currentPage,
    total: totalPages,
    baseUrl: `${env.basePath}categories/${category}/?page=`
  })}
</div>`;
  },

  header(data) {
    return headerHTML({ categories: siteConfig.categories, currentPath: `${env.basePath}categories/${data.category}/` });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    return data.label;
  },

  description(data) {
    return `浏览 ${data.label} 分类下的所有文章，共 ${data.total} 篇。`;
  },

  mount(el, data, ctx) {
    mountHeader(el);
  }
};