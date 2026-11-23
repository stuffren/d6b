import { defineConfig } from 'vite';
import { createEnvManager } from './core/multiple_env/multi_env.js';
import { readFile, stat } from 'fs/promises';
import { rmSync, existsSync } from 'fs';
import { resolve, sep } from 'path';
import { deployPresets } from './scripts/deploy-presets.js';

const env = createEnvManager({
  envFile: '.env',
  prefix: 'VITE_',
  envName: process.env.DEPLOY_ENV || 'development',
  presets: deployPresets(process.env.DEPLOY_ENV || 'development'),
  schema: {
    BASE_PATH: { required: true, type: 'string', default: '/' },
    SITE_BASE_URL: { required: true, type: 'string', default: 'http://localhost:5173' },
    VITE_SITE_NAME: { required: true, type: 'string', default: 'd6b' },
    VITE_DATA_DIR: { required: false, type: 'string', default: '/data' },
    VITE_TZ: { required: false, type: 'string', default: 'Asia/Shanghai' },
    VITE_HOME_LADDER_DAYS: { required: false, type: 'number', default: '7' },
    VITE_PAGE_LADDER_DAYS: { required: false, type: 'number', default: '10' },
    VITE_MOBILE_LADDER_DAYS: { required: false, type: 'number', default: '3' },
    VITE_ENABLE_DRAGON_TIGER: { required: false, type: 'boolean', default: 'true' },
    VITE_ADSENSE_CLIENT: { required: false, type: 'string', default: '' },
    VITE_ADSENSE_SLOT: { required: false, type: 'string', default: '' },
    VITE_CUSTOM_DOMAIN: { required: false, type: 'string', default: '' }
  },
  define: {
    __SITE_NAME__: 'VITE_SITE_NAME',
    __SITE_BASE_URL__: 'SITE_BASE_URL',
    __BASE_PATH__: 'BASE_PATH',
    __DATA_DIR__: 'VITE_DATA_DIR',
    __TZ__: 'VITE_TZ',
    __HOME_LADDER_DAYS__: 'VITE_HOME_LADDER_DAYS',
    __PAGE_LADDER_DAYS__: 'VITE_PAGE_LADDER_DAYS',
    __MOBILE_LADDER_DAYS__: 'VITE_MOBILE_LADDER_DAYS',
    __LAST10_DAYS__: 'VITE_LAST10_DAYS',
    __ENABLE_DRAGON_TIGER__: 'VITE_ENABLE_DRAGON_TIGER',
    __ADSENSE_CLIENT__: 'VITE_ADSENSE_CLIENT',
    __ADSENSE_SLOT__: 'VITE_ADSENSE_SLOT'
  }
});

env.load();
env.validate();

const basePath = env.getBasePath('/');
const viteBase = basePath === '/' ? '/' : `${basePath}/`;
const PROJECT_ROOT = resolve(process.cwd());
const DATA_DIR = resolve(PROJECT_ROOT, 'dist', 'data');
const CONTENT_DIR = resolve(PROJECT_ROOT, 'content');
const GATHER_DATA_DIR = resolve(PROJECT_ROOT, 'gather', 'data');
const SOURCE_KINDS = ['limit_up', 'dragon_tiger'].filter((kind) =>
  existsSync(resolve(GATHER_DATA_DIR, kind))
);

function serveDistData() {
  return {
    name: 'serve-dist-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        const prefix = `${basePath === '/' ? '' : basePath}/data/`;
        const hit = basePath === '/'
          ? pathname.startsWith('/data/')
          : pathname.startsWith(prefix);

        const isJson = pathname.endsWith('.json');
        const isMarkdown = pathname.endsWith('.md');
        if (!hit || (!isJson && !isMarkdown)) return next();

        const rel = basePath === '/'
          ? pathname.slice('/data/'.length)
          : pathname.slice(prefix.length);

        let decoded = '';
        try {
          decoded = decodeURIComponent(rel);
        } catch {
          return next();
        }
        const segs = decoded.split('/');
        if (segs.some((s) => s === '..' || s === '.' || s === '')) return next();

        const markdown = isMarkdown && segs[0] === 'posts' && segs.length === 3;
        const source = isJson && SOURCE_KINDS.includes(segs[0]);
        const baseDir = markdown ? CONTENT_DIR : source ? GATHER_DATA_DIR : DATA_DIR;
        const sub = markdown ? segs.slice(1).join('/') : decoded;
        const file = resolve(baseDir, sub);

        if (!file.startsWith(baseDir + sep)) return next();

        readFile(file)
          .then((buf) => {
            res.setHeader(
              'Content-Type',
              markdown ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8'
            );
            res.setHeader('Cache-Control', 'no-cache');
            res.end(buf);
          })
          .catch(() => next());
      });
    }
  };
}

const DIST_DIR_ROOT = resolve(PROJECT_ROOT, 'dist');

const STATIC_EXTENSIONS = [
  '.js', '.mjs', '.css', '.json', '.html',
  '.xml', '.txt', '.svg', '.ico', '.webmanifest',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.map'
];

function isStaticAsset(pathname) {
  const lower = pathname.toLowerCase();
  if (STATIC_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return pathname.startsWith('/data/') || pathname.startsWith('/assets/');
}

function safeDistPath(pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const full = resolve(DIST_DIR_ROOT, rel);
  if (!full.startsWith(DIST_DIR_ROOT + sep) && full !== DIST_DIR_ROOT) return null;
  return full;
}

async function readIfFile(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    return await readFile(filePath);
  } catch {
    return null;
  }
}

function createHtmlFallback() {
  return async (req, res, next) => {
    const url = req.url || '/';
    const rawPathname = url.split('?')[0].split('#')[0];
    const pathname = basePath !== '/' && rawPathname.startsWith(basePath)
      ? rawPathname.slice(basePath.length) || '/'
      : rawPathname;

    if (isStaticAsset(pathname)) return next();

    let buf = null;

    if (pathname.endsWith('/')) {
      const dirIndex = safeDistPath(`${pathname}index.html`);
      if (dirIndex) buf = await readIfFile(dirIndex);
    } else {
      const direct = safeDistPath(pathname);
      if (direct) {
        buf = await readIfFile(direct);
        if (buf) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(buf);
          return;
        }
      }
      const slashIndex = safeDistPath(`${pathname}/index.html`);
      if (slashIndex) buf = await readIfFile(slashIndex);
    }

    if (buf) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(buf);
      return;
    }

    const notFound = resolve(DIST_DIR_ROOT, '404.html');
    readFile(notFound)
      .then((nfBuf) => {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(nfBuf);
      })
      .catch(() => {
        const shell = resolve(DIST_DIR_ROOT, 'index.html');
        readFile(shell)
          .then((shellBuf) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(shellBuf);
          })
          .catch(() => {
            res.statusCode = 404;
            res.end('Not Found');
          });
      });
  };
}

function cleanAssetsDir() {
  return {
    name: 'clean-assets-dir',
    apply: 'build',
    buildStart() {
      const assetsDir = resolve(PROJECT_ROOT, 'dist', 'assets');
      rmSync(assetsDir, { recursive: true, force: true });
    }
  };
}

function adsenseHeadInject() {
  return {
    name: 'adsense-head-inject',
    transformIndexHtml(html) {
      const client = env.get('VITE_ADSENSE_CLIENT') || '';
      const slot = env.get('VITE_ADSENSE_SLOT') || '';
      if (!client || !slot) return html;
      const tag = `<script async crossorigin="anonymous" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}"></script>`;
      return html.replace('</head>', `    ${tag}\n  </head>`);
    }
  };
}

function spaFallback() {
  return {
    name: 'spa-fallback',
    configurePreviewServer(server) {
      server.middlewares.use(createHtmlFallback());
    }
  };
}

export default defineConfig({
  base: viteBase,
  define: env.getDefine(),
  publicDir: false,
  build: { outDir: 'dist', assetsDir: 'assets', emptyOutDir: false },
  plugins: [serveDistData(), cleanAssetsDir(), adsenseHeadInject(), spaFallback()],
  server: {
    fs: {
      allow: [PROJECT_ROOT, resolve(PROJECT_ROOT, 'dist')]
    }
  }
});