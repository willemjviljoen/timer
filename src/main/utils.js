function compareSemver(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function esc(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

function pad(n) { return String(n).padStart(2, '0'); }

module.exports = { compareSemver, esc, pad };
