import React, { useState } from 'react';
import TagPill from './TagPill';
import DayCalendar from './DayCalendar';

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

function formatDate(isoString) {
  try { return new Date(isoString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function formatTimeShort(isoString) {
  try { return new Date(isoString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export default function HistoryList({ entries, allTags, timerState, onEdit, onDelete, onCreateFromGap, onLoadMore }) {
  const [activeTab, setActiveTab] = useState('list');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [hoveredRow, setHoveredRow] = useState(null);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '1px solid var(--border)' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 2, padding: '6px 0' }}>
          {[
            { id: 'list', label: 'List', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
            { id: 'calendar', label: 'Day', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", letterSpacing: '.04em', background: activeTab === tab.id ? 'var(--bg-hover)' : 'transparent', color: activeTab === tab.id ? 'var(--text)' : 'var(--text-dim)', border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all .15s', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
        {activeTab === 'list' && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono',monospace" }}>{entries.length} entries</span>
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'list' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!entries || entries.length === 0 ? (
            <div className="history__empty">No entries yet — start tracking to see your history here.</div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
              {entries.map(entry => (
                <div key={entry.id}
                  onClick={() => onEdit(entry)}
                  onMouseEnter={() => setHoveredRow(entry.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', marginBottom: 2, borderRadius: 5, cursor: 'pointer', background: hoveredRow === entry.id ? 'var(--bg-hover)' : 'transparent', transition: 'background .12s' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.description}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono',monospace" }}>
                        {formatDate(entry.start_time)} · {formatTimeShort(entry.start_time)} → {formatTimeShort(entry.end_time)}
                      </span>
                      {entry.tags?.length > 0 && allTags && (
                        <div style={{ display: 'flex', gap: 3 }}>
                          {entry.tags.map(tid => { const tag = allTags.find(t => t.id === tid); return tag ? <TagPill key={tid} tag={tag} size="sm" /> : null; })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>{formatDuration(entry.duration_ms)}</span>
                    <button
                      title="Delete entry"
                      onClick={e => { e.stopPropagation(); onDelete(entry); }}
                      style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', borderRadius: 4, opacity: hoveredRow === entry.id ? 1 : 0, transition: 'opacity .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = 'var(--red)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-dim)'; }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              {entries.length > 0 && entries.length % 50 === 0 && onLoadMore && (
                <button
                  onClick={onLoadMore}
                  style={{ width: '100%', padding: '10px', margin: '8px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-dim)', fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", cursor: 'pointer', transition: 'all .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
                >
                  Load more entries…
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <DayCalendar
          entries={entries}
          allTags={allTags || []}
          timerState={timerState}
          calendarDate={calendarDate}
          setCalendarDate={setCalendarDate}
          onEdit={onEdit}
          onCreateFromGap={onCreateFromGap}
        />
      )}
    </div>
  );
}
