import { env } from '../env.js';
import { siteConfig } from '../lib/site.js';
import { getJSON, dataUrl, loadRenderedContent } from '../lib/data.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { cnDate } from '../lib/date.js';
import { esc } from '../lib/format.js';
import { renderMarkdown } from '../../core/markdown/md.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';

function bodyFromMarkdown(text) {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const content = fmMatch ? fmMatch[2] : text;
  const parts = content.split('\n---\n');
  const body = parts.length > 1 ? parts.slice(1).join('\n---\n') : parts[0];
  return renderMarkdown(body.trim());
}

function postDir(post) {
  return post.category === 'about' ? 'about/' : `posts/${post.id}/`;
}

async function renderedBodyHTML(post) {
  return loadRenderedContent(`${postDir(post)}index.html`, '.post-body');
}

async function markdownBodyHTML(post) {
  const res = await fetch(dataUrl(`posts/${post.category}/${post.filename}.md`));
  if (!res.ok) throw new Error(`正文源文件缺失: ${post.category}/${post.filename}.md`);
  const text = await res.text();
  if (/<!doctype html>/i.test(text)) throw new Error(`正文源文件无效: ${post.category}/${post.filename}.md`);
  return bodyFromMarkdown(text);
}

async function browserBodyHTML(post) {
  try {
    return await renderedBodyHTML(post);
  } catch (err) {
    console.error('[post] 页面内容加载失败，回落到 markdown:', err.message);
    return markdownBodyHTML(post);
  }
}

function breadcrumbHTMLFor(post) {
  if (post.category === 'about') {
    return breadcrumbHTML([
      { label: '首页', href: env.basePath },
      { label: 'about' }
    ]);
  }
  return breadcrumbHTML([
    { label: '首页', href: env.basePath },
    { label: post.categoryLabel, href: `${env.basePath}categories/${post.category}/` },
    { label: post.title }
  ]);
}

const STATIC_POSTS = {
  about: {
    id: 'about',
    title: '关于 d6b',
    date: '2026-11-20',
    summary: '了解 d6b 项目简介、数据来源和技术栈。',
    category: 'about',
    categoryLabel: '关于'
  }
};

export default {
  async load(params) {
    const id = params.id;

    let post = null;
    try {
      const posts = await getJSON('posts.json');
      post = posts.find((p) => p.id === id);
    } catch (err) {
      console.warn('[post] posts.json 加载失败:', err.message);
    }

    post = post || STATIC_POSTS[id] || null;

    if (!post) {
      return { notFound: true };
    }

    const cat = siteConfig.categories.find((c) => c.id === post.category);
    post.categoryLabel = cat ? cat.label : post.categoryLabel;

    post.bodyHTML = (window.__SSG__ || env.isDev)
      ? await markdownBodyHTML(post)
      : await browserBodyHTML(post);

    return { post };
  },

  render(data) {
    if (data.notFound) {
      return `<div class="page"><p>文章不存在或已被删除</p></div>`;
    }

    const { post } = data;
    const tags = (post.tags || []).map((t) => `<span class="tag">${t}</span>`).join('');

    return `
<div class="page">
  ${breadcrumbHTMLFor(post)}
  <article class="post-detail">
    <header class="post-header">
      <h1 class="post-title">${post.title}</h1>
      <div class="post-meta">
        <time>${cnDate(post.date)}</time>
        ${tags ? `<span class="post-tags">${tags}</span>` : ''}
      </div>
    </header>
    <div class="post-body">${post.bodyHTML}</div>
    ${post.category === 'about' ? '' : `<footer class="post-footer">
      <a class="back-link" href="${env.basePath}categories/${post.category}/">← 返回${post.categoryLabel}</a>
    </footer>`}
  </article>
</div>`;
  },

  header(data) {
    if (data.notFound) return '';
    const currentPath = data.post.category === 'about'
      ? `${env.basePath}about/`
      : `${env.basePath}categories/${data.post.category}/`;
    return headerHTML({ categories: siteConfig.categories, currentPath });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  title(data) {
    return data.notFound ? '文章未找到' : data.post.title;
  },

  description(data) {
    if (data.notFound) return '文章不存在';
    return data.post.summary || '';
  },

  mount(el) {
    mountHeader(el);
  }
};