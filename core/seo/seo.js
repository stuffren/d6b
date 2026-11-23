/**
 * SEO 生成器 - 通用 Vanilla JS 模块
 *
 * 特性：
 * - 浏览器端：动态更新页面 meta 标签（Open Graph、Twitter Card、canonical）
 * - 构建端：生成 <head> meta HTML、sitemap.xml、robots.txt
 * - 支持自定义站点名称、默认 OG 图片、额外 meta 标签
 * - 支持默认 meta 设置与重置
 * - 浏览器/Node.js 双环境兼容
 *
 * 使用示例（浏览器端）：
 *   import { createSEOManager } from './core/seo/seo.js';
 *   const seo = createSEOManager({ siteName: 'My Blog', defaultImage: '/og.png' });
 *   seo.setPageMeta({ title: 'Article Title', description: '...', url: 'https://...' });
 *
 * 使用示例（构建端）：
 *   const headHTML = seo.generateHeadHTML({ title: '...', description: '...', url: '...' });
 *   const sitemap = seo.generateSitemap([{ loc: 'https://...', priority: '0.9' }]);
 */

import { esc } from '../../src/lib/format.js';

/**
 * 默认 meta 标签配置
 */
const DEFAULT_META_CONFIG = [
  { type: 'name', key: 'description', contentKey: 'description' },
  { type: 'property', key: 'og:title', contentKey: 'title' },
  { type: 'property', key: 'og:description', contentKey: 'description' },
  { type: 'property', key: 'og:type', contentKey: 'type', defaultValue: 'website' },
  { type: 'property', key: 'og:url', contentKey: 'url' },
  { type: 'property', key: 'og:image', contentKey: 'image' },
  { type: 'name', key: 'twitter:card', defaultValue: 'summary_large_image' }
];

/**
 * 创建 SEO 管理器实例
 * @param {Object} options - 配置项
 * @param {string} [options.siteName=''] - 站点名称（用于 title 后缀）
 * @param {string} [options.defaultImage=''] - 默认 OG 图片路径
 * @param {string} [options.defaultType='website'] - 默认 OG type
 * @param {string} [options.baseUrl=''] - 站点基础 URL（用于 canonical 和 sitemap）
 * @param {Array<Object>} [options.additionalMeta] - 额外需要注入的 meta 标签
 *   格式: [{ type: 'name'|'property', key: 'xxx', value: 'yyy' }]
 * @param {string} [options.titleSeparator=' | '] - title 分隔符
 * @returns {SEOManager}
 */
export function createSEOManager(options = {}) {
  return new SEOManager(options);
}

class SEOManager {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.siteName = options.siteName || '';
    this.defaultImage = options.defaultImage || '';
    this.defaultType = options.defaultType || 'website';
    this.baseUrl = options.baseUrl || '';
    this.additionalMeta = options.additionalMeta || [];
    this.titleSeparator = options.titleSeparator || ' | ';

    this._defaultMeta = {
      title: this.siteName,
      description: '',
      image: this.defaultImage,
      type: this.defaultType,
      url: this.baseUrl
    };
  }

  /**
   * 设置默认 meta（用于路由切换后重置）
   * @param {Object} meta - { title, description, image, type, url }
   */
  setDefaultMeta(meta = {}) {
    this._defaultMeta = { ...this._defaultMeta, ...meta };
  }

  /**
   * 重置页面 meta 为默认值
   */
  resetPageMeta() {
    this.setPageMeta(this._defaultMeta);
  }

  /**
   * 设置页面 meta 标签（浏览器端）
   * @param {Object} options - 页面元数据
   * @param {string} [options.title] - 页面标题
   * @param {string} [options.description] - 页面描述
   * @param {string} [options.type='website'] - OG type
   * @param {string} [options.url] - 页面 URL（用于 canonical 和 OG）
   * @param {string} [options.image] - OG 图片 URL
   * @param {Array<Object>} [options.additionalMeta] - 临时额外 meta 标签
   */
  setPageMeta(options = {}) {
    const {
      title,
      description,
      type = this.defaultType,
      url,
      image,
      additionalMeta = []
    } = options;

    const fullTitle = title
      ? `${title}${this.siteName ? this.titleSeparator + this.siteName : ''}`
      : this.siteName;
    if (fullTitle) document.title = fullTitle;

    const dataMap = {
      title: title || this.siteName,
      description: description || '',
      type,
      url: url || location.href,
      image: image || this.defaultImage
    };

    DEFAULT_META_CONFIG.forEach(config => {
      const content = dataMap[config.contentKey] || config.defaultValue || '';
      const selector = config.type === 'name'
        ? `meta[name="${config.key}"]`
        : `meta[property="${config.key}"]`;

      this._updateOrCreateMeta(config.type, config.key, content);
    });

    this.additionalMeta.forEach(meta => {
      this._updateOrCreateMeta(meta.type, meta.key, meta.value);
    });

    additionalMeta.forEach(meta => {
      this._updateOrCreateMeta(meta.type, meta.key, meta.value);
    });

    this._updateCanonical(url || location.href);
  }

  /**
   * 生成 <head> 中的 meta 标签 HTML（构建端使用）
   * @param {Object} pageData - 页面元数据
   * @param {string} [pageData.title] - 页面标题
   * @param {string} [pageData.description] - 页面描述
   * @param {string} [pageData.type='website'] - OG type
   * @param {string} [pageData.url] - 页面 URL
   * @param {string} [pageData.image] - OG 图片 URL
   * @returns {string} HTML 字符串
   */
  generateHeadHTML(pageData = {}) {
    const {
      title,
      description,
      type = this.defaultType,
      url,
      image
    } = pageData;

    const fullTitle = title
      ? `${title}${this.siteName ? this.titleSeparator + this.siteName : ''}`
      : this.siteName;

    const dataMap = {
      title: title || this.siteName,
      description: description || '',
      type,
      url: url || this.baseUrl,
      image: image || this.defaultImage
    };

    let html = '';

    if (fullTitle) {
      html += `\n  <title>${esc(fullTitle)}</title>`;
    }

    DEFAULT_META_CONFIG.forEach(config => {
      const content = dataMap[config.contentKey] || config.defaultValue || '';
      if (!content) return;

      const attr = config.type === 'name' ? 'name' : 'property';
      html += `\n  <meta ${attr}="${config.key}" content="${esc(content)}">`;
    });

    this.additionalMeta.forEach(meta => {
      html += `\n  <meta ${meta.type}="${meta.key}" content="${esc(meta.value)}">`;
    });

    if (url) {
      html += `\n  <link rel="canonical" href="${esc(url)}">`;
    }

    return html;
  }

  /**
   * 生成 sitemap.xml 内容
   * @param {Array<{loc: string, priority?: string, changefreq?: string}>} urls - URL 列表
   * @returns {string} XML 字符串
   */
  generateSitemap(urls = []) {
    const urlEntries = urls.map(u => `  <url>
    <loc>${esc(u.loc)}</loc>
    <priority>${u.priority || '0.5'}</priority>
    <changefreq>${u.changefreq || 'weekly'}</changefreq>
  </url>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`;
  }

  /**
   * 生成 robots.txt 内容
   * @param {string} [sitemapUrl] - sitemap URL（默认使用 baseUrl + /sitemap.xml）
   * @param {string} [customContent] - 自定义 robots.txt 内容
   * @returns {string} robots.txt 内容
   */
  generateRobotsTxt(sitemapUrl, customContent) {
    if (customContent) return customContent;

    const sitemap = sitemapUrl || `${this.baseUrl}/sitemap.xml`;
    return `User-agent: *
Allow: /
Sitemap: ${sitemap}`;
  }

  /**
   * 更新或创建 meta 标签（浏览器端）
   * @param {string} type - 'name' 或 'property'
   * @param {string} key - meta 属性名
   * @param {string} content - meta 内容
   * @private
   */
  _updateOrCreateMeta(type, key, content) {
    const selector = type === 'name'
      ? `meta[name="${key}"]`
      : `meta[property="${key}"]`;

    let el = document.querySelector(selector);

    if (!el) {
      el = document.createElement('meta');
      if (type === 'name') el.setAttribute('name', key);
      else el.setAttribute('property', key);
      document.head.appendChild(el);
    }

    el.setAttribute('content', content);
  }

  /**
   * 更新或创建 canonical 标签（浏览器端）
   * @param {string} url - canonical URL
   * @private
   */
  _updateCanonical(url) {
    let canonicalLink = document.querySelector('link[rel="canonical"]');

    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }

    canonicalLink.setAttribute('href', url);
  }
}

export default createSEOManager;