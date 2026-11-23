const RAW_BASE = __BASE_PATH__ || '/';
const BASE_NO_SLASH = RAW_BASE.replace(/\/$/, '') || '/';
const BASE_WITH_SLASH = BASE_NO_SLASH === '/' ? '/' : `${BASE_NO_SLASH}/`;

const IS_DEV = Boolean(import.meta.env && import.meta.env.DEV);

export const env = {
  siteName: __SITE_NAME__,
  isDev: IS_DEV,
  siteBaseUrl: (__SITE_BASE_URL__ || '').replace(/\/$/, ''),
  basePath: BASE_WITH_SLASH,
  basePathWithSlash: BASE_WITH_SLASH,
  dataDir: (__DATA_DIR__ || '/data').replace(/^\//, '').replace(/\/$/, ''),
  tz: __TZ__ || 'Asia/Shanghai',
  homeLadderDays: Number(__HOME_LADDER_DAYS__) || 7,
  pageLadderDays: Number(__PAGE_LADDER_DAYS__) || 10,
  last10Days: Number(__LAST10_DAYS__) || 10,
  mobileLadderDays: Number(__MOBILE_LADDER_DAYS__) || 3,
  enableDragonTiger: String(__ENABLE_DRAGON_TIGER__) === 'true',
  adsenseClient: __ADSENSE_CLIENT__ || '',
  adsenseSlot: __ADSENSE_SLOT__ || ''
};

export function url(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  return `${env.basePath}${p}`;
}

export function canonicalUrl(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  const prefix = env.basePath;
  const alreadyIncluded = prefix !== '/' && env.siteBaseUrl.endsWith(prefix.replace(/\/$/, ''));
  return `${env.siteBaseUrl}${alreadyIncluded ? '/' : prefix}${p}`;
}