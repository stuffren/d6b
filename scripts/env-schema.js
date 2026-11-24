export const ENV_SCHEMA = {
  BASE_PATH: { required: true, type: 'string', default: '/' },
  SITE_BASE_URL: { required: true, type: 'string', default: 'http://localhost:5173' },
  VITE_SITE_NAME: { required: true, type: 'string', default: '第六板' },
  VITE_DATA_DIR: { required: false, type: 'string', default: '/data' },
  VITE_TZ: { required: false, type: 'string', default: 'Asia/Shanghai' },
  VITE_HOME_LADDER_DAYS: { required: false, type: 'number', default: '7' },
  VITE_PAGE_LADDER_DAYS: { required: false, type: 'number', default: '10' },
  VITE_MOBILE_LADDER_DAYS: { required: false, type: 'number', default: '3' },
  VITE_LAST10_DAYS: { required: false, type: 'number', default: '10' },
  VITE_ENABLE_DRAGON_TIGER: { required: false, type: 'boolean', default: 'true' },
  VITE_CUSTOM_DOMAIN: { required: false, type: 'string', default: '' }
};

export const ENV_DEFINE_MAP = {
  __SITE_NAME__: 'VITE_SITE_NAME',
  __SITE_BASE_URL__: 'SITE_BASE_URL',
  __BASE_PATH__: 'BASE_PATH',
  __DATA_DIR__: 'VITE_DATA_DIR',
  __TZ__: 'VITE_TZ',
  __HOME_LADDER_DAYS__: 'VITE_HOME_LADDER_DAYS',
  __PAGE_LADDER_DAYS__: 'VITE_PAGE_LADDER_DAYS',
  __MOBILE_LADDER_DAYS__: 'VITE_MOBILE_LADDER_DAYS',
  __LAST10_DAYS__: 'VITE_LAST10_DAYS',
  __ENABLE_DRAGON_TIGER__: 'VITE_ENABLE_DRAGON_TIGER'
};