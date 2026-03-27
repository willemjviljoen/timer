import React, { useEffect } from 'react';
import TagPill from './TagPill';

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = totalSeconds % 60;
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}h ${p(m)}m ${p(s)}s`;
}

export default function DeleteConfirm({ entry, onConfirm, onCancel, allTags }) {
  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--small" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Delete Entry</h3>
          <button className="modal__close" onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal__body">
          <p className="delete-confirm__message">Are you sure you want to delete this entry?</p>
          <div className="delete-confirm__entry">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="delete-confirm__desc">{entry.description}</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: "'JetBrains Mono',monospace" }}>{formatDuration(entry.duration_ms)}</span>
            </div>
            {entry.tags?.length > 0 && allTags && (
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {entry.tags.map(tid => { const tag = allTags.find(t => t.id === tid); return tag ? <TagPill key={tid} tag={tag} size="sm" /> : null; })}
              </div>
            )}
          </div>
          <p className="delete-confirm__warning">This action cannot be undone.</p>
        </div>
        <div className="modal__footer">
          <button className="modal__btn modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="modal__btn modal__btn--delete" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
