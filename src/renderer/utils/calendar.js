import { isSameDay } from './formatting.js';

export function entryMinutes(e, calendarDate) {
  const s = new Date(e.start_time), en = new Date(e.end_time);
  const startMin = isSameDay(s, calendarDate) ? s.getHours() * 60 + s.getMinutes() : 0;
  const endMin = isSameDay(en, calendarDate) ? en.getHours() * 60 + en.getMinutes() : 24 * 60;
  return { startMin, endMin: Math.max(endMin, startMin + 1) };
}

export function computeOverlapLayout(dayEntries, calendarDate) {
  const items = dayEntries.map(e => {
    const { startMin, endMin } = entryMinutes(e, calendarDate);
    return { id: e.id, startMin, endMin };
  }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const clusters = [];
  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      if (item.startMin < cluster.endMin) {
        cluster.items.push(item);
        cluster.endMin = Math.max(cluster.endMin, item.endMin);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ items: [item], endMin: item.endMin });
  }

  const layout = {};
  for (const cluster of clusters) {
    const columns = [];
    for (const item of cluster.items) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        if (item.startMin >= columns[c]) {
          columns[c] = item.endMin;
          layout[item.id] = { col: c, totalCols: 0 };
          placed = true;
          break;
        }
      }
      if (!placed) { layout[item.id] = { col: columns.length, totalCols: 0 }; columns.push(item.endMin); }
    }
    const totalCols = columns.length;
    for (const item of cluster.items) layout[item.id].totalCols = totalCols;
  }
  return layout;
}
