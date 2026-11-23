import { env, canonicalUrl } from './env.js';
import { siteConfig } from './lib/site.js';
import home from './pages/home.js';
import zhangtingban from './pages/zhangtingban.js';
import lianbantiandi from './pages/lianbantiandi.js';
import maintheme from './pages/maintheme.js';
import dragonhu from './pages/dragonhu.js';
import days from './pages/days.js';
import category from './pages/category.js';
import post from './pages/post.js';
import { assembleElement } from './pages/page-assemble.js';

export function createRoutes({ seo, router }) {
  function toHandler(page, { canonical } = {}) {
    return async (params, query) => {
      const data = await page.load(params, query);
      const ctx = { env, siteConfig, params, router };

      const title = page.title(data);
      const description = page.description ? page.description(data, ctx) : '';
      const url = canonical ? canonical(params, data) : undefined;

      if (seo) {
        seo.setPageMeta({ title, description, type: 'website', url });
      }

      const el = assembleElement(page, data, ctx);

      return {
        el,
        title: `${title}_${env.siteName}`,
        metaApplied: true
      };
    };
  }

  return [
    {
      path: '/',
      module: home,
      handler: toHandler(home, { canonical: () => canonicalUrl('/') }),
      enabled: () => true
    },
    {
      path: '/zhangtingban/',
      module: zhangtingban,
      handler: toHandler(zhangtingban, {
        canonical: (params, data) => canonicalUrl(`/zhangtingban/${data.target}/`)
      }),
      enabled: () => true
    },
    {
      path: '/zhangtingban/:date/',
      module: zhangtingban,
      handler: toHandler(zhangtingban),
      enabled: () => true
    },
    {
      path: '/lianbantiandi/',
      module: lianbantiandi,
      handler: toHandler(lianbantiandi, { canonical: () => canonicalUrl('/lianbantiandi/') }),
      enabled: () => true
    },
    {
      path: '/maintheme/',
      module: maintheme,
      handler: toHandler(maintheme, { canonical: () => canonicalUrl('/maintheme/') }),
      enabled: () => true
    },
    {
      path: '/maintheme/:month/',
      module: maintheme,
      handler: toHandler(maintheme),
      enabled: () => true
    },
    {
      path: '/dragonhu/',
      module: dragonhu,
      handler: toHandler(dragonhu, {
        canonical: (params, data) => canonicalUrl(`/dragonhu/${data.target}/`)
      }),
      enabled: () => env.enableDragonTiger
    },
    {
      path: '/dragonhu/:date/',
      module: dragonhu,
      handler: toHandler(dragonhu),
      enabled: () => env.enableDragonTiger
    },
    {
      path: '/days/',
      module: days,
      handler: toHandler(days),
      enabled: () => true
    },
    {
      path: '/days/m/:month/',
      module: days,
      handler: toHandler(days),
      enabled: () => true
    },
    {
      path: '/days/y/:year/',
      module: days,
      handler: toHandler(days),
      enabled: () => true
    },
    {
      path: '/categories/:category/',
      module: category,
      handler: toHandler(category),
      enabled: () => true
    },
    {
      path: '/posts/:id/',
      module: post,
      handler: toHandler(post),
      enabled: () => true
    },
    {
      path: '/about/',
      module: post,
      handler: (params, query) => toHandler(post)({ ...params, id: 'about' }, query),
      enabled: () => true
    }
  ];
}

function activeRoutesFallback() {
  const routes = createRoutes({ seo: null, router: null });
  return routes.filter((r) => (r.enabled ? r.enabled() : true));
}

export const activeRoutes = activeRoutesFallback();

export default activeRoutes;