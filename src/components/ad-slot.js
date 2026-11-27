import { ADSENSE } from '../config/adsense.js';
import { env } from '../env.js';
import { esc } from '../lib/format.js';

export function adSlotHTML({ slot = ADSENSE.slot, label = '广告', className = '' } = {}) {
  if (!ADSENSE.client || !slot) {
    return env.isDev
      ? '<section class="ad-slot"><div class="ad-slot-placeholder">Ad placement（开发预览：slot 未配置）</div></section>'
      : '';
  }
  return `<section class="ad-slot${className ? ` ${className}` : ''}" aria-label="${esc(label)}">
  <span class="ad-slot-label">${esc(label)}</span>
  <div class="ad-slot-body"><ins class="adsbygoogle ad-slot-ins" style="display:block" data-ad-client="${esc(ADSENSE.client)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>
</section>`;
}

export function mountAdSlot(el) {
  if (!ADSENSE.client || !ADSENSE.slot) return;
  let hasPending = false;
  for (const unit of el.querySelectorAll('.ad-slot-ins')) {
    if (unit.dataset.d6bAd === '1') continue;
    unit.dataset.d6bAd = '1';
    hasPending = true;
  }
  if (!hasPending) return;
  setTimeout(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.warn('[AdSense] push 失败:', err?.message || err);
    }
  }, 0);
}