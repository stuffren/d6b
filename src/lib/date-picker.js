export function bindDateChange(input, { validDates, current, basePath, kind, router }) {
  if (!input || !validDates?.length) return;
  const validSet = new Set(validDates);
  input.addEventListener('change', (e) => {
    const date = e.target.value;
    if (!date || !validSet.has(date)) {
      e.target.value = current;
      return;
    }
    const latest = validDates[validDates.length - 1];
    const target = date === latest
      ? `${basePath}${kind}/`
      : `${basePath}${kind}/${date}/`;
    router?.navigate(target);
  });
}