export function pad(n) { return String(n).padStart(2, '0'); }

export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) };
}

export function fmtDur(ms) {
  const t = Math.floor(ms / 1000), d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return d > 0 ? `${pad(d)}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

export function minsToTime(mins) { return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }

export function formatDate(isoString) {
  try { return new Date(isoString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

export function formatTimeShort(isoString) {
  try { return new Date(isoString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export function formatDateFull(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export function toLocalDatetime(isoString) {
  try {
    const d = new Date(isoString);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } catch { return ''; }
}

export function fromLocalDatetime(localStr) {
  try { return new Date(localStr).toISOString(); } catch { return ''; }
}
