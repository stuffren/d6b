export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= days;
}

export function isMonth(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
}

export function isYear(s) {
  return typeof s === 'string' && /^\d{4}$/.test(s);
}

export function mmdd(date) {
  return date.slice(5);
}

export function cnDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

export function cnMonth(month) {
  const [y, m] = month.split('-');
  return `${Number(y)}年${Number(m)}月`;
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function prevDate(dates, current) {
  const i = dates.indexOf(current);
  return i > 0 ? dates[i - 1] : null;
}

export function nextDate(dates, current) {
  const i = dates.indexOf(current);
  return i >= 0 && i < dates.length - 1 ? dates[i + 1] : null;
}

export function takeLast(dates, n) {
  return dates.slice(Math.max(0, dates.length - n));
}