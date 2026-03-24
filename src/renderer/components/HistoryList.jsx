import React from 'react';

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatTimeShort(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function HistoryList({ entries, onEdit, onDelete }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="history">
        <div className="history__empty">
          No entries yet — start tracking to see your history here.
        </div>
      </div>
    );
  }

  return (
    <div className="history">
      <div className="history__header">
        <span className="history__title">History</span>
        <span className="history__count">{entries.length} entries</span>
      </div>
      <div className="history__list">
        {entries.map((entry) => (
          <div key={entry.id} className="history__row" onClick={() => onEdit(entry)}>
            <div className="history__row-left">
              <span className="history__desc">{entry.description}</span>
              <span className="history__times">
                {formatDate(entry.start_time)} &middot; {formatTimeShort(entry.start_time)} → {formatTimeShort(entry.end_time)}
              </span>
            </div>
            <div className="history__row-right">
              <span className="history__duration">{formatDuration(entry.duration_ms)}</span>
              <button
                className="history__delete-btn"
                title="Delete entry"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(entry);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
