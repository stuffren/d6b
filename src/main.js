import { env } from './env.js';
import { createRouter } from '../core/spa_router/router.js';
import { createSEOManager } from '../core/seo/seo.js';
import { createRoutes } from './routes.js';
import { siteConfig } from './lib/site.js';
import notfound from './pages/notfound.js';
import { assembleElement } from './pages/page-assemble.js';
import '@fontsource-variable/inter/wght.css';
import './styles/main.css';

const seo = createSEOManager({
  siteName: env.siteName,
  baseUrl: env.siteBaseUrl,
  titleSeparator: '_'
});

const router = createRouter({
  base: env.basePath,
  container: '#app',
  notFound: async (path) => {
    const data = await notfound.load();
    const ctx = { env, siteConfig, params: {}, router };
    const el = assembleElement(notfound, data, ctx);
    seo.setPageMeta({ title: notfound.title(data), description: notfound.description(data), type: 'website' });
    return el;
  },
  onTitleChange: (title) => {
    if (title) document.title = title;
  }
});

const activeRoutes = createRoutes({ seo, router });

router.beforeEach(() => {
  seo.resetPageMeta();
  return true;
});

for (const r of activeRoutes) router.register(r.path, r.handler);

router.init();