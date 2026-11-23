export function fmtAmount(v) {
  if (v == null) return '—';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return String(v);
}

export function fmtPct(v) {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

export function fmtNum(v) {
  return v == null ? '—' : String(v);
}

export function tierLabel(t) {
  return t === '8+' ? '8板+' : `${t}板`;
}

export function boardLabel(n) {
  return n === 1 ? '首板' : `${n}板`;
}

export function sealClass(t) {
  if (!t) return 'seal-unknown';
  if (t <= '09:25:59') return 'seal-auction';
  if (t >= '14:57:00') return 'seal-tail';
  return 'seal-intraday';
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function diffLabel(delta) {
  if (delta == null) return '—';
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

export function diffClass(delta) {
  if (delta == null || delta === 0) return 'is-flat';
  return delta > 0 ? 'is-up' : 'is-down';
}