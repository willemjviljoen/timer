import React, { useState, useRef, useEffect } from 'react';
import TagPill from './TagPill';
import { pad, minsToTime, isSameDay, formatDateFull, fmtDur, formatTimeShort as fmtTimeShort } from '../utils/formatting';
import { entryMinutes, computeOverlapLayout } from '../utils/calendar';

const V = {
  bg: '#0a0a0a', bgSurface: '#141414', bgInput: '#1a1a1a', bgHover: '#222',
  border: '#2a2a2a', text: '#f0f0f0', textSec: '#888', textDim: '#555',
  accent: '#e85d04', red: '#ef4444',
  mono: "'JetBrains Mono',monospace", sans: "'Manrope',system-ui,sans-serif",
};

const ROW_H = 48;
const SLOTS = 48;
const GRID_LEFT = 64;
const GRID_RIGHT = 12;
const WORK_START = 7 * 60;
const WORK_END = 19 * 60;
const MIN_GAP = 15;

const ACTIVE_TIMER_ID = '__active_timer__';

export default function DayCalendar({ entries, allTags, timerState, calendarDate, setCalendarDate, onEdit, onCreateFromGap }) {
  const scrollRef = useRef(null);
  const today = new Date();
  const [hoveredGap, setHoveredGap] = useState(null);
  const [filterTags, setFilterTags] = useState([]);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (isSameDay(calendarDate, new Date())) {
      const nowSlot = (new Date().getHours() * 60 + new Date().getMinutes()) / 30;
      const target = nowSlot * ROW_H - scrollRef.current.clientHeight / 2;
      scrollRef.current.scrollTop = Math.max(0, target);
    } else {
      scrollRef.current.scrollTop = 14 * ROW_H;
    }
  }, [calendarDate]);

  // Fetch remote entries on-demand when navigating beyond the realtime sync window (1 year)
  // Fetches the entire month at once to avoid repeated calls when navigating day-by-day
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.fetchDateRange) return;
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    if (calendarDate < oneYearAgo) {
      const monthStart = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
      const monthEnd = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0, 23, 59, 59, 999);
      api.fetchDateRange(monthStart.toISOString(), monthEnd.toISOString());
    }
  }, [calendarDate]);

  const allDayEntries = entries
    .filter(e => isSameDay(new Date(e.start_time), calendarDate) || isSameDay(new Date(e.end_time), calendarDate))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const dayTagIds = [...new Set(allDayEntries.flatMap(e => e.tags || []))];
  const dayTagObjects = dayTagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean);

  const dayEntries = filterTags.length === 0
    ? allDayEntries
    : allDayEntries.filter(e => e.tags?.some(t => filterTags.includes(t)));

  // Build active timer phantom entry
  const activeEntry = (() => {
    if (!timerState?.isRunning || !timerState?.startTime) return null;
    const startDate = new Date(timerState.startTime);
    const now = new Date();
    if (!isSameDay(startDate, calendarDate) && !isSameDay(now, calendarDate)) return null;
    return {
      id: ACTIVE_TIMER_ID,
      description: timerState.description || 'Running…',
      start_time: timerState.startTime,
      end_time: now.toISOString(),
      duration_ms: timerState.elapsed || 0,
      tags: [],
      _isActive: true,
    };
  })();

  const toggleFilter = tagId => setFilterTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);

  const prevDay = () => setCalendarDate(new Date(calendarDate.getTime() - 86400000));
  const nextDay = () => setCalendarDate(new Date(calendarDate.getTime() + 86400000));
  const goToday = () => setCalendarDate(new Date());
  const isToday = isSameDay(calendarDate, today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTop = (nowMinutes / 30) * ROW_H;

  const calendarEntries = activeEntry ? [...dayEntries, activeEntry] : dayEntries;
  const totalMs = calendarEntries.reduce((sum, e) => sum + e.duration_ms, 0);
  const totalAllMs = (activeEntry ? [...allDayEntries, activeEntry] : allDayEntries).reduce((sum, e) => sum + e.duration_ms, 0);

  const entryColor = entry => {
    if (entry.tags?.length > 0) {
      const tag = allTags.find(t => t.id === entry.tags[0]);
      if (tag) return tag.color;
    }
    return V.accent;
  };

  const layout = computeOverlapLayout(calendarEntries, calendarDate);

  const entryIntervals = calendarEntries.map(e => entryMinutes(e, calendarDate));
  const merged = [];
  for (const iv of [...entryIntervals].sort((a, b) => a.startMin - b.startMin)) {
    if (merged.length && iv.startMin < merged[merged.length - 1].endMin) {
      merged[merged.length - 1].endMin = Math.max(merged[merged.length - 1].endMin, iv.endMin);
    } else {
      merged.push({ ...iv });
    }
  }

  let rangeStart = WORK_START, rangeEnd = WORK_END;
  if (merged.length > 0) {
    rangeStart = Math.min(rangeStart, merged[0].startMin);
    rangeEnd = Math.max(rangeEnd, merged[merged.length - 1].endMin);
  }

  const gaps = [];
  if (merged.length === 0) {
    gaps.push({ startMin: rangeStart, endMin: rangeEnd });
  } else {
    if (merged[0].startMin > rangeStart) gaps.push({ startMin: rangeStart, endMin: merged[0].startMin });
    for (let i = 0; i < merged.length - 1; i++) {
      const gapStart = merged[i].endMin, gapEnd = merged[i + 1].startMin;
      if (gapEnd - gapStart >= MIN_GAP) gaps.push({ startMin: gapStart, endMin: gapEnd });
    }
    if (merged[merged.length - 1].endMin < rangeEnd) gaps.push({ startMin: merged[merged.length - 1].endMin, endMin: rangeEnd });
  }

  const handleGapClick = gap => {
    const startDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), calendarDate.getDate(), Math.floor(gap.startMin / 60), gap.startMin % 60);
    const endDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), calendarDate.getDate(), Math.floor(gap.endMin / 60), gap.endMin % 60);
    onCreateFromGap(startDate.toISOString(), endDate.toISOString());
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Nav header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={prevDay} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: `1px solid ${V.border}`, borderRadius: 4, color: V.textSec, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = V.bgHover}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button onClick={nextDay} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: `1px solid ${V.border}`, borderRadius: 4, color: V.textSec, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = V.bgHover}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          {!isToday && (
            <button onClick={goToday} style={{ height: 24, padding: '0 10px', background: 'none', border: `1px solid ${V.border}`, borderRadius: 4, color: V.accent, cursor: 'pointer', fontFamily: V.mono, fontSize: 10, fontWeight: 600, letterSpacing: '.04em' }}
              onMouseEnter={e => e.currentTarget.style.background = V.bgHover}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>TODAY</button>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: V.text, marginLeft: 4 }}>{formatDateFull(calendarDate)}</span>
        </div>
        <span style={{ fontSize: 11, color: V.textDim, fontFamily: V.mono }}>
          {filterTags.length > 0
            ? <><span style={{ color: V.accent }}>{fmtDur(totalMs)}</span>{' / '}{fmtDur(totalAllMs)} tracked</>
            : <>{fmtDur(totalMs)} tracked</>
          }
        </span>
      </div>

      {/* Tag filter strip */}
      {dayTagObjects.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px 8px', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: V.textDim, fontFamily: V.mono, marginRight: 2 }}>Filter</span>
          {dayTagObjects.map(tag => {
            const active = filterTags.includes(tag.id);
            return (
              <span key={tag.id} onClick={() => toggleFilter(tag.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: active ? tag.color + '28' : 'transparent', color: active ? tag.color : V.textDim, border: `1px solid ${active ? tag.color + '50' : V.border}`, cursor: 'pointer', transition: 'all .15s', fontFamily: V.sans, whiteSpace: 'nowrap' }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = tag.color + '40'; e.currentTarget.style.color = tag.color; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = V.border; e.currentTarget.style.color = V.textDim; } }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                {tag.name}
              </span>
            );
          })}
          {filterTags.length > 0 && (
            <span onClick={() => setFilterTags([])}
              style={{ fontSize: 10, fontWeight: 600, color: V.textDim, cursor: 'pointer', fontFamily: V.mono, padding: '3px 8px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.color = V.text}
              onMouseLeave={e => e.currentTarget.style.color = V.textDim}>✕ Clear</span>
          )}
        </div>
      )}

      {/* Grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', position: 'relative', padding: '0 0 8px' }}>
        <div style={{ position: 'relative', minHeight: SLOTS * ROW_H }}>
          {/* Time slot rows */}
          {Array.from({ length: SLOTS }, (_, i) => {
            const hour = Math.floor(i / 2), isHour = i % 2 === 0, minLabel = isHour ? '00' : '30';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', height: ROW_H, borderBottom: `1px solid ${isHour ? '#1e1e1e' : '#151515'}`, position: 'relative' }}>
                <div style={{ width: 58, flexShrink: 0, paddingTop: 2, paddingRight: 10, textAlign: 'right', fontSize: isHour ? 11 : 10, fontWeight: isHour ? 600 : 400, color: isHour ? V.textDim : '#333', fontFamily: V.mono, letterSpacing: '.02em' }}>
                  {pad(hour)}:{minLabel}
                </div>
                <div style={{ flex: 1, borderLeft: `1px solid ${isHour ? '#1e1e1e' : '#151515'}`, height: '100%' }} />
              </div>
            );
          })}

          {/* Now indicator */}
          {isToday && (
            <div style={{ position: 'absolute', top: nowTop, left: 52, right: 8, height: 2, background: V.red, zIndex: 10, borderRadius: 1, boxShadow: `0 0 6px ${V.red}60` }}>
              <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: V.red }} />
            </div>
          )}

          {/* Content overlay */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: GRID_LEFT, right: GRID_RIGHT }}>

            {/* Ghost gaps */}
            {gaps.map((gap, i) => {
              const durMins = gap.endMin - gap.startMin;
              if (durMins < MIN_GAP) return null;
              const top = (gap.startMin / 30) * ROW_H;
              const height = Math.max((durMins / 30) * ROW_H, 24);
              const isHovered = hoveredGap === i;
              const isCompact = height < 56;
              return (
                <div key={`gap-${i}`}
                  onClick={() => handleGapClick(gap)}
                  onMouseEnter={() => setHoveredGap(i)}
                  onMouseLeave={() => setHoveredGap(null)}
                  style={{ position: 'absolute', top, left: 0, right: 0, height, background: isHovered ? `${V.accent}0c` : 'transparent', border: `1.5px dashed ${isHovered ? V.accent + '50' : V.border + '60'}`, borderRadius: '0 5px 5px 0', cursor: 'pointer', display: 'flex', flexDirection: isCompact ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: isCompact ? 8 : 2, padding: '4px 12px', transition: 'all .2s', zIndex: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isHovered ? 1 : 0.35, transition: 'opacity .2s' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isHovered ? V.accent : V.textDim} strokeWidth="2" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 600, fontFamily: V.sans, color: isHovered ? V.accent : V.textDim }}>Add entry</span>
                  </div>
                  <span style={{ fontSize: 10, fontFamily: V.mono, letterSpacing: '.02em', color: isHovered ? V.accent + '90' : V.textDim + '60', transition: 'color .2s' }}>
                    {minsToTime(gap.startMin)} – {minsToTime(gap.endMin)}
                  </span>
                </div>
              );
            })}

            {/* Entry blocks */}
            {calendarEntries.map(entry => {
              const { startMin, endMin } = entryMinutes(entry, calendarDate);
              const top = (startMin / 30) * ROW_H;
              const height = Math.max(((endMin - startMin) / 30) * ROW_H, 24);
              const color = entry._isActive ? '#22c55e' : entryColor(entry);
              const isShort = height < 48;
              const l = layout[entry.id] || { col: 0, totalCols: 1 };
              const colWidthPct = 100 / l.totalCols;
              const colLeftPct = l.col * colWidthPct;
              const gapPx = l.totalCols > 1 ? 2 : 0;
              return (
                <div key={entry.id} onClick={() => onEdit(entry)}
                  style={{ position: 'absolute', top, height, left: `${colLeftPct}%`, width: `calc(${colWidthPct}% - ${gapPx}px)`, background: color + '14', border: `1px solid ${color}35`, borderLeft: `3px solid ${color}`, borderRadius: '0 5px 5px 0', cursor: 'pointer', padding: isShort ? '2px 8px' : '6px 8px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', transition: 'background .15s, border-color .15s', zIndex: entry._isActive ? 6 : 5, animation: entry._isActive ? 'active-entry-pulse 2s ease-in-out infinite' : 'none' }}
                  onMouseEnter={ev => { ev.currentTarget.style.background = color + '24'; ev.currentTarget.style.borderColor = color + '60'; }}
                  onMouseLeave={ev => { ev.currentTarget.style.background = color + '14'; ev.currentTarget.style.borderColor = color + '35'; }}>
                  <span style={{ fontSize: l.totalCols > 2 ? 10 : 12, fontWeight: 600, color: V.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                    {entry._isActive && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, marginRight: 5, verticalAlign: 'middle' }} />}
                    {entry.description}
                  </span>
                  {!isShort && <span style={{ fontSize: l.totalCols > 2 ? 9 : 10, color: entry._isActive ? '#22c55e90' : V.textDim, fontFamily: V.mono, whiteSpace: 'nowrap' }}>{fmtTimeShort(entry.start_time)} – {entry._isActive ? 'now' : fmtTimeShort(entry.end_time)}</span>}
                  {!isShort && !entry._isActive && height > 72 && entry.tags?.length > 0 && l.totalCols <= 2 && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 1, flexWrap: 'wrap' }}>
                      {entry.tags.map(tid => { const tag = allTags.find(t => t.id === tid); return tag ? <TagPill key={tid} tag={tag} size="sm" /> : null; })}
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </div>
      </div>
    </div>
  );
}
