/**
 * SSG 构建引擎 - 通用 Node.js 模块
 * 
 * 特性：
 * - 从任意数据源拉取内容，渲染为静态 HTML 页面
 * - 支持自定义页面模板（Header/Footer/Head/完整包装）
 * - 自动从 Vite 构建产物中提取 assets 路径（含内容哈希）
 * - 自动生成 sitemap.xml 和 robots.txt
 * - 支持动态添加页面和模板片段
 * - 不依赖特定数据源（GitHub/CMS/文件系统/数据库均可）
 * 
 * 使用示例：
 *   import { createSSGEngine } from './core/ssg_build/ssg_build.js';
 *   const ssg = createSSGEngine({ ... });
 *   ssg.addPage('index.html', fetchData, renderPage);
 *   await ssg.build();
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { esc } from '../../src/lib/format.js';

/**
 * 默认 assets 提取器：从 dist/index.html 中提取 JS/CSS 路径
 * @param {string} distDir - 构建输出目录
 * @returns {Promise<{ js: string, css: string }>}
 */
async function defaultAssetsExtractor(distDir) {
  let assets = { js: '/assets/main.js', css: '/assets/main.css' };
  try {
    const indexHtml = await readFile(join(distDir, 'index.html'), 'utf-8');
    const jsMatch = indexHtml.match(/src="(\/[^"]+\.js)"/);
    const cssMatch = indexHtml.match(/href="(\/[^"]+\.css)"/);
    if (jsMatch) assets.js = jsMatch[1];
    if (cssMatch) assets.css = cssMatch[1];
  } catch {
    // 使用默认路径
  }
  return assets;
}

/**
 * 默认 HTML 模板包装函数
 * @param {Object} params
 * @returns {string}
 */
function defaultWrapper({ head, header, body, footer, assets }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${head}
  <link rel="stylesheet" crossorigin href="${assets.css}">
</head>
<body>
  <div id="app">
    ${header}
    <main class="site-main">
      ${body}
    </main>
    ${footer}
  </div>
  <script type="module" crossorigin src="${assets.js}"></script>
</body>
</html>`;
}

/**
 * 默认 Head 模板
 * @param {Object} pageData
 * @returns {string}
 */
function defaultHead(pageData) {
  const { title = '', description = '', type = 'website', url = '', image = '' } = pageData;
  const fullTitle = title ? `${title}` : '';
  return `
  <title>${fullTitle}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="${type}">
  <meta property="og:url" content="${url}">
  ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${url}">`;
}

/**
 * 默认 Header（空，由使用方自定义）
 */
function defaultHeader() {
  return '';
}

/**
 * 默认 Footer（空，由使用方自定义）
 */
function defaultFooter() {
  return '';
}

/**
 * 创建 SSG 构建引擎实例
 * @param {Object} options - 配置项
 * @param {string} options.distDir - 构建输出目录路径
 * @param {string} options.baseUrl - 站点基础 URL（如 https://example.com）
 * @param {string} [options.basePath='/'] - 部署路径前缀（如 /my-app）
 * @param {string} [options.siteName=''] - 站点名称
 * @param {Object} [options.template] - 页面模板配置
 * @param {Function} [options.template.head] - 自定义 <head> 内容，接收 pageData 返回 HTML 字符串
 * @param {Function} [options.template.header] - 自定义 Header 导航，接收 pageData 返回 HTML 字符串
 * @param {Function} [options.template.footer] - 自定义 Footer，接收 pageData 返回 HTML 字符串
 * @param {Function} [options.template.wrapper] - 完整 HTML 包装函数，接收 { head, header, body, footer, assets } 返回 HTML 字符串
 * @param {Function} [options.assetsExtractor] - 自定义 assets 路径提取函数
 * @param {Object|false} [options.sitemap] - sitemap 配置（false 则不生成）
 * @param {Array<{loc: string, priority: string}>} [options.sitemap.urls] - URL 列表
 * @param {Object|false} [options.robotsTxt] - robots.txt 配置（false 则不生成）
 * @param {string} [options.robotsTxt.content] - 自定义 robots.txt 内容
 * @returns {SSGEngine}
 */
export function createSSGEngine(options) {
  return new SSGEngine(options);
}

class SSGEngine {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.distDir = options.distDir || 'dist';
    this.baseUrl = options.baseUrl || 'http://localhost:5173';
    this.basePath = (options.basePath || '/').replace(/\/$/, '');
    this.siteName = options.siteName || '';

    // 模板配置
    const tpl = options.template || {};
    this.headFn = tpl.head || defaultHead;
    this.headerFn = tpl.header || defaultHeader;
    this.footerFn = tpl.footer || defaultFooter;
    this.wrapperFn = tpl.wrapper || defaultWrapper;

    // Assets 提取器
    this.assetsExtractor = options.assetsExtractor || defaultAssetsExtractor;

    // Sitemap 配置
    this.sitemapConfig = options.sitemap !== undefined ? options.sitemap : { urls: [] };

    // Robots.txt 配置
    this.robotsConfig = options.robotsTxt !== undefined ? options.robotsTxt : {
      content: `User-agent: *\nAllow: /\nSitemap: ${this.baseUrl}/sitemap.xml`
    };

    // 页面列表
    this.pages = [];

    // 缓存 assets 路径
    this._assets = null;
  }

  /**
   * 添加页面
   * @param {string} path - 输出文件路径（如 'index.html' 或 'posts/1.html'）
   * @param {Function} dataFn - 数据获取函数，返回 Promise<data>。data 中应包含 title、description 等 meta 信息
   * @param {Function} renderFn - 页面渲染函数，接收 (data, assets, basePath) 返回 HTML 字符串（仅 body 内容）
   * @returns {this}
   */
  addPage(path, dataFn, renderFn) {
    this.pages.push({ path, dataFn, renderFn });
    return this;
  }

  /**
   * 批量添加页面
   * @param {Array<{path: string, dataFn: Function, renderFn: Function}>} pages
   * @returns {this}
   */
  addPages(pages) {
    pages.forEach(p => this.addPage(p.path, p.dataFn, p.renderFn));
    return this;
  }

  /**
   * 设置模板片段
   * @param {string} type - 'head' | 'header' | 'footer' | 'wrapper'
   * @param {Function} fn - 模板函数
   * @returns {this}
   */
  setTemplate(type, fn) {
    switch (type) {
      case 'head': this.headFn = fn; break;
      case 'header': this.headerFn = fn; break;
      case 'footer': this.footerFn = fn; break;
      case 'wrapper': this.wrapperFn = fn; break;
    }
    return this;
  }

  /**
   * 执行完整构建流程
   * @returns {Promise<void>}
   */
  async build() {
    // 确保输出目录存在
    await mkdir(this.distDir, { recursive: true });

    // 提取 assets 路径
    this._assets = await this.assetsExtractor(this.distDir);
    console.log('Assets found:', this._assets);

    // 渲染所有页面
    let renderedCount = 0;
    for (const page of this.pages) {
      try {
        const data = await page.dataFn();
        await this._writePage(page.path, data, page.renderFn);
        renderedCount++;
      } catch (err) {
        console.error(`Failed to render page ${page.path}:`, err);
      }
    }
    console.log(`Rendered ${renderedCount}/${this.pages.length} pages`);

    // 生成 sitemap
    if (this.sitemapConfig !== false) {
      await this._generateSitemap();
    }

    // 生成 robots.txt
    if (this.robotsConfig !== false) {
      await this._generateRobotsTxt();
    }

    console.log('SSG build complete');
  }

  /**
   * 写入单个页面
   * @param {string} path - 输出文件路径
   * @param {Object} data - 页面数据
   * @param {Function} renderFn - 渲染函数
   * @private
   */
  async _writePage(path, data, renderFn) {
    const fullPath = join(this.distDir, path);
    await mkdir(dirname(fullPath), { recursive: true });

    // 渲染 body 内容
    const body = renderFn(data, this._assets, this.basePath);

    // 组装完整 HTML
    const pageData = {
      title: data.title ? `${data.title}${this.siteName ? ' | ' + this.siteName : ''}` : this.siteName,
      description: data.description || '',
      type: data.type || 'website',
      url: data.url || `${this.baseUrl}${this.basePath}/${path}`,
      image: data.image || '',
      ...data
    };

    const head = this.headFn(pageData);
    const header = this.headerFn(pageData);
    const footer = this.footerFn(pageData);

    const html = this.wrapperFn({
      head,
      header,
      body,
      footer,
      assets: this._assets
    });

    await writeFile(fullPath, html);
  }

  /**
   * 生成 sitemap.xml
   * @private
   */
  async _generateSitemap() {
    const urls = this.sitemapConfig?.urls || [];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <priority>${u.priority || '0.5'}</priority>
    <changefreq>weekly</changefreq>
  </url>`).join('\n')}
</urlset>`;

    await writeFile(join(this.distDir, 'sitemap.xml'), xml);
    console.log('sitemap.xml generated');
  }

  /**
   * 生成 robots.txt
   * @private
   */
  async _generateRobotsTxt() {
    const content = typeof this.robotsConfig === 'string'
      ? this.robotsConfig
      : this.robotsConfig?.content || `User-agent: *\nAllow: /\nSitemap: ${this.baseUrl}/sitemap.xml`;

    await writeFile(join(this.distDir, 'robots.txt'), content);
    console.log('robots.txt generated');
  }
}

// 导出工具函数（供使用方在 renderFn 中使用）
export { esc as escapeHtml };

// 默认导出工厂函数
export default createSSGEngine;