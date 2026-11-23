import { env } from '../env.js';
import { esc } from '../lib/format.js';

const LOADER_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

export function adsenseHeadHTML(client = env.adsenseClient) {
  if (!client) return '';
  return `<script async crossorigin="anonymous" src="${LOADER_SRC}?client=${encodeURIComponent(client)}"></script>`;
}

export function adSlotHTML({
  client = env.adsenseClient,
  slot = env.adsenseSlot,
  label = '广告',
  className = ''
} = {}) {
  const configured = client && slot;
  if (!configured && !env.isDev) return '';
  const inner = configured
    ? `<ins class="adsbygoogle ad-slot-ins"
      style="display:block"
      data-ad-client="${esc(client)}"
      data-ad-slot="${esc(slot)}"
      data-ad-format="auto"
      data-full-width-responsive="true"></ins>`
    : `<div class="ad-slot-placeholder">Ad placement（开发预览：未配置 VITE_ADSENSE_CLIENT / VITE_ADSENSE_SLOT）</div>`;
  return `
<section class="ad-slot${className ? ` ${className}` : ''}" aria-label="${esc(label)}">
  <span class="ad-slot-label">${esc(label)}</span>
  <div class="ad-slot-body">${inner}</div>
</section>`.trim();
}

function ensureLoader(client) {
  if (window.__d6bAdsenseLoaded) return;
  window.__d6bAdsenseLoaded = true;
  if (document.querySelector('script[src*="adsbygoogle.js"]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `${LOADER_SRC}?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
}

export function mountAdSlot(el) {
  if (!env.adsenseClient) return;
  const units = el.querySelectorAll('.ad-slot-ins');
  if (!units.length) return;

  ensureLoader(env.adsenseClient);

  for (const unit of units) {
    if (unit.dataset.d6bAd === '1') continue;
    unit.dataset.d6bAd = '1';
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error('[AdSlot] 广告加载失败:', err);
    }
  }
}