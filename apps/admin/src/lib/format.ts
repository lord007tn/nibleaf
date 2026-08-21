/** Short human date for admin tables, e.g. "Jul 2, 2026". */
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const fmtRelative = (iso: string) => {
  const delta = new Date(iso).getTime() - Date.now();
  const absolute = Math.abs(delta);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ];
  const [unit, milliseconds] = units.find(([, size]) => absolute >= size) ?? ['minute', 60 * 1000];
  return new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(Math.round(delta / milliseconds), unit);
};

export const fmtBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
};
