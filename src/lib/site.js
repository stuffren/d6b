import cfg from '../site.config.json' with { type: 'json' };
import { env } from '../env.js';

const sorted = cfg.categories.slice().sort((a, b) => a.order - b.order);

export const siteConfig = {
  ...cfg,
  categories: sorted,
  dataCategories: sorted.filter((c) => c.type === 'data'),
  contentCategories: sorted.filter((c) => c.type === 'content' && c.id !== 'about')
};

export function navCategories() {
  return siteConfig.categories.filter((c) => {
    if (c.id === 'dragonhu') return env.enableDragonTiger;
    if (c.id === 'about') return true;
    return c.type === 'data';
  });
}