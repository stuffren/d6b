import { env } from '../env.js';
import { siteConfig } from '../lib/site.js';
import { headerHTML, mountHeader } from '../components/header.js';
import { footerHTML } from '../components/footer.js';
import { breadcrumbHTML } from '../../core/breadcrumb/breadcrumb.js';

export default {
  async load() {
    return {};
  },

  render() {
    return `
<div class="page">
  ${breadcrumbHTML([
    { label: '首页', href: env.basePath },
    { label: '404' }
  ])}
  <div class="notfound-wrap">
    <h1 class="page-title">页面未找到</h1>
    <p class="notfound-msg">抱歉，您访问的页面不存在或已被移除。</p>
    <a class="notfound-link" href="${env.basePath}">返回首页</a>
  </div>
</div>`;
  },

  header() {
    return headerHTML({ categories: siteConfig.categories, currentPath: `${env.basePath}404/` });
  },

  footer() {
    return footerHTML({ text: siteConfig.footer });
  },

  adSlot: false,

  title() {
    return '404 - 页面未找到';
  },

  description() {
    return '您访问的页面不存在';
  },

  mount(el) {
    mountHeader(el);
  }
};