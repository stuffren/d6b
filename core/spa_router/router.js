/**
 * SPA Router - 通用 Vanilla JS 路由模块
 * 
 * 特性：
 * - 基于 History API（pushState / popState）
 * - 支持动态路由参数（如 /posts/:id）
 * - 支持 query string（如 /?page=2）
 * - 支持 base 路径前缀（适配子路径部署）
 * - 支持导航守卫（beforeEach）
 * - 支持自定义 404 页面
 * - 自动拦截内部链接点击
 * 
 * 使用示例：
 *   const router = createRouter({
 *     base: '/my-app',
 *     container: '#app',
 *     notFound: (path) => { ... }
 *   });
 *   router.register('/', () => document.createElement('div'));
 *   router.register('/posts/:id', (params, query) => { ... });
 *   router.init();
 */

/**
 * 创建 Router 实例
 * @param {Object} options - 配置项
 * @param {string} [options.base='/'] - 部署路径前缀，如 '/my-app'
 * @param {string|HTMLElement} options.container - 渲染容器（CSS 选择器或 DOM 元素）
 * @param {Function} [options.notFound] - 自定义 404 渲染函数，接收 path 参数，返回 HTMLElement
 * @param {Function} [options.onTitleChange] - 标题更新回调，接收 title 字符串，默认更新 document.title
 * @param {Function} [options.beforeEach] - 全局导航守卫，接收 (to, from) 参数，返回 false 可阻止导航
 * @returns {Router}
 */
export function createRouter(options = {}) {
  return new Router(options);
}

class Router {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.routes = [];
    this.currentRoute = null;
    this.beforeHooks = [];

    // 解析 base 路径前缀
    const base = options.base || '/';
    this.basePath = base;
    this.basePrefix = base.replace(/\/$/, ''); // 去掉末尾斜杠

    // 解析渲染容器
    if (options.container) {
      this.container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;
      // [P0优化] container为null时发出警告
      if (!this.container) {
        console.warn(`[Router] 渲染容器未找到: "${options.container}"，路由渲染将被跳过`);
      }
    }

    // 自定义 404 渲染函数
    this.notFoundHandler = options.notFound || null;

    // 标题更新回调
    this.onTitleChange = options.onTitleChange || ((title) => {
      if (title) document.title = title;
    });

    // 保存事件引用，用于 destroy
    this._popstateHandler = null;
    this._clickHandler = null;
    this._initialized = false;
  }

  /**
   * 注册路由
   * @param {string} path - 路由路径，支持动态参数（如 /posts/:id）
   * @param {Function} handler - 路由处理器，接收 (params, query)，返回 HTMLElement 或 { el, title }
   * @returns {this}
   */
  register(path, handler) {
    // 将路径转换为正则表达式
    const keys = [];
    const regexPath = path.replace(/:([^/]+)/g, (match, key) => {
      keys.push(key);
      return '([^/]+)';
    });

    this.routes.push({
      path,
      regex: new RegExp(`^${regexPath}$`),
      keys,
      handler
    });
    return this;
  }

  /**
   * 导航到指定路径
   * @param {string} path - 完整路径（pathname + search）
   * @param {boolean} [replace=false] - 是否使用 replaceState
   * @returns {Promise<void>}
   */
  async navigate(path, replace = false) {
    // 如果 path 是绝对路径且未包含 basePrefix，自动补上前缀
    let fullPath = path;
    if (this.basePrefix && path.startsWith('/') && !path.startsWith(this.basePrefix + '/')) {
      fullPath = this.basePrefix + path;
    }

    const from = this.currentRoute;
    const normalizedFullPath = this.basePrefix && fullPath.startsWith(this.basePrefix)
      ? fullPath.slice(this.basePrefix.length) || '/'
      : fullPath;
    if (this.currentRoute === normalizedFullPath) return;

    // [P0优化] 保存当前URL，导航失败时回退
    const prevURL = location.pathname + location.search;

    // 执行 before hooks
    for (const hook of this.beforeHooks) {
      const result = await hook(fullPath, from);
      if (result === false) return;
    }

    // 更新历史
    if (replace) {
      history.replaceState({ path: fullPath }, '', fullPath);
    } else {
      history.pushState({ path: fullPath }, '', fullPath);
    }

    this.currentRoute = normalizedFullPath;

    // [P0优化] try/catch包裹，失败时回退URL
    try {
      await this.resolve(fullPath);
    } catch (err) {
      console.error(`[Router] navigate("${path}") 失败:`, err);
      history.replaceState({ path: prevURL }, '', prevURL);
      this.currentRoute = prevURL;
    }
  }

  /**
   * 解析并渲染路由
   * @param {string} [path] - 完整路径，默认为当前 location
   * @returns {Promise<void>}
   */
  async resolve(path = location.pathname + location.search) {
    // 解析完整 URL，分离 pathname 与 query string
    const url = new URL(path, location.origin);
    let pathname = url.pathname;

    // 如果 pathname 以 basePrefix 开头，去掉前缀后再进行路由匹配
    // 同时也要设置 currentRoute 为去掉前缀的格式，与 navigate() 保持一致
    if (this.basePrefix && pathname.startsWith(this.basePrefix)) {
      pathname = pathname.slice(this.basePrefix.length) || '/';
    }
    this.currentRoute = pathname + url.search;

    const query = Object.fromEntries(url.searchParams);

    // 查找匹配的路由
    for (const route of this.routes) {
      const match = pathname.match(route.regex);
      if (match) {
        // 提取动态参数
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(match[i + 1]);
        });

        // 滚动到顶部
        window.scrollTo(0, 0);

        // 执行处理器，传入 params 与 query
        const result = await route.handler(params, query);

        // 渲染到容器
        this._render(result);

        return;
      }
    }

    // 404 处理
    this._handle404(path);
  }

  /**
   * 渲染结果到容器
   * @param {*} result - handler 返回值
   * @private
   */
  _render(result) {
    // [P0优化] 检测handler返回了Promise而非同步值
    if (result instanceof Promise) {
      console.error(
        '[Router] _render() 收到 Promise 对象,handler 应为 async 函数或返回同步值。' +
        '请检查路由 handler 是否忘记 await,例如: register("/path", async () => { ... })'
      );
      return;
    }

    if (!this.container) return;

    let element = null;
    let title = null;

    // 支持两种返回格式：
    // 1. 直接返回 HTMLElement
    // 2. 返回 { el: HTMLElement, title?: string }
    if (result instanceof HTMLElement) {
      element = result;
    } else if (result && typeof result === 'object') {
      element = result.el || null;
      title = result.title || null;
    } else if (typeof result === 'string') {
      this.container.innerHTML = result;
      return;
    }

    // 清空容器并挂载新元素
    this.container.innerHTML = '';
    if (element) {
      this.container.appendChild(element);
    } else {
      // [P1优化] element为null时发出警告
      console.warn('[Router] _render() 收到非法返回值，无法渲染:', result);
    }

    // 更新标题
    if (title) {
      this.onTitleChange(title);
    }
  }

  /**
   * 404 处理
   * @param {string} path - 未匹配的路径
   * @private
   */
  _handle404(path) {
    if (this.notFoundHandler) {
      const result = this.notFoundHandler(path);
      this._render(result);
    } else if (this.container) {
      // 默认 404 页面
      const div = document.createElement('div');
      div.innerHTML = `
        <h1>404</h1>
        <p>Page not found</p>
        <a href="${this.basePath}/">Go Home</a>
      `;
      this.container.innerHTML = '';
      this.container.appendChild(div);
    }
    this.onTitleChange('404 - Page Not Found');
  }

  /**
   * 注册导航前钩子
   * @param {Function} hook - 接收 (to, from)，返回 false 可阻止导航
   * @returns {this}
   */
  beforeEach(hook) {
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * 设置渲染容器
   * @param {string|HTMLElement} selector - CSS 选择器或 DOM 元素
   * @returns {this}
   */
  setContainer(selector) {
    this.container = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;
    return this;
  }

  /**
   * 初始化路由：绑定 popstate 事件、拦截链接点击、解析当前路由
   * @returns {this}
   */
  init() {
    if (this._initialized) return this;

    // 处理浏览器前进/后退
    // [P1优化] popstate回调包裹try/catch，防止浏览器前进/后退时异常
    this._popstateHandler = (e) => {
      try {
        const path = e.state?.path || (location.pathname + location.search);
        this.resolve(path);
      } catch (err) {
        console.error('[Router] popstate 处理失败:', err);
      }
    };
    window.addEventListener('popstate', this._popstateHandler);

    // 拦截链接点击
    this._clickHandler = (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');

      // 跳过外部链接、锚点、特殊协议
      if (!href || href.startsWith('http') || href.startsWith('#') ||
          href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      // 跳过新窗口链接
      if (link.target === '_blank' || e.ctrlKey || e.metaKey) {
        return;
      }

      e.preventDefault();
      // [P1优化] 捕获navigate异步错误，防止Uncaught Promise
      this.navigate(href).catch(err => {
        console.error('[Router] 链接点击导航失败:', err);
      });
    };
    document.addEventListener('click', this._clickHandler);

    // 初始解析当前路由
    this.resolve(location.pathname + location.search);

    this._initialized = true;
    return this;
  }

  /**
   * 销毁路由：移除所有事件监听器
   */
  destroy() {
    if (this._popstateHandler) {
      window.removeEventListener('popstate', this._popstateHandler);
    }
    if (this._clickHandler) {
      document.removeEventListener('click', this._clickHandler);
    }
    this._initialized = false;
  }
}

// 默认导出 createRouter 工厂函数
export default createRouter;