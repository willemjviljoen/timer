import React, { useState, useEffect, useRef } from 'react';
import TagPill from './TagPill';
import TagPicker from './TagPicker';
import { toLocalDatetime, fromLocalDatetime } from '../utils/formatting';

export default function EditModal({ entry, onSave, onCancel, allTags, onCreateTag, isNew = false }) {
  const isActive = entry._isActive === true;
  const [description, setDescription] = useState(entry.description);
  const [startTime, setStartTime] = useState(toLocalDatetime(entry.start_time));
  const [endTime, setEndTime] = useState(toLocalDatetime(entry.end_time));
  const [entryTags, setEntryTags] = useState(entry.tags || []);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape' && !showPicker) onCancel(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel, showPicker]);

  useEffect(() => {
    if (!showPicker) return;
    const h = e => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showPicker]);

  const handleSave = () => {
    const start = new Date(startTime);
    if (!description.trim()) { setError('Description cannot be empty.'); return; }
    if (isNaN(start.getTime())) { setError('Please enter a valid start time.'); return; }
    if (isActive) {
      if (start.getTime() > Date.now()) { setError('Start time cannot be in the future.'); return; }
      onSave({
        id: entry.id,
        description: description.trim(),
        startTime: fromLocalDatetime(startTime),
        tagIds: entryTags,
      });
      return;
    }
    const end = new Date(endTime);
    if (isNaN(end.getTime())) { setError('Please enter valid dates.'); return; }
    if (end <= start) { setError('End time must be after start time.'); return; }
    onSave({
      id: entry.id,
      description: description.trim(),
      startTime: fromLocalDatetime(startTime),
      endTime: fromLocalDatetime(endTime),
      durationMs: end.getTime() - start.getTime(),
      tagIds: entryTags,
    });
  };

  const durationPreview = () => {
    try {
      const ms = isActive
        ? Date.now() - new Date(startTime).getTime()
        : new Date(endTime).getTime() - new Date(startTime).getTime();
      if (ms <= 0 || isNaN(ms)) return '--';
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
      const p = n => String(n).padStart(2, '0');
      return `${p(h)}h ${p(m)}m ${p(s)}s`;
    } catch { return '--'; }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{isActive ? 'Edit Active Timer' : isNew ? 'New Entry' : 'Edit Entry'}</h3>
          <button className="modal__close" onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal__body">
          <label className="modal__label">Description</label>
          <input className="modal__input" type="text" value={description}
            onChange={e => { setDescription(e.target.value); setError(''); }} autoFocus />

          {allTags && (
            <>
              <label className="modal__label" style={{ marginTop: 4 }}>Tags</label>
              <div style={{ position: 'relative', marginBottom: 14 }} ref={pickerRef}>
                <div onClick={() => setShowPicker(!showPicker)}
                  style={{ minHeight: 40, padding: '6px 10px', background: 'var(--bg-input)', border: '1.5px solid var(--border)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  {entryTags.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Click to add tags...</span>}
                  {entryTags.map(tid => { const tag = allTags.find(t => t.id === tid); return tag ? <TagPill key={tid} tag={tag} size="md" onRemove={id => setEntryTags(prev => prev.filter(t => t !== id))} /> : null; })}
                </div>
                {showPicker && (
                  <TagPicker
                    allTags={allTags}
                    selectedTagIds={entryTags}
                    onToggle={id => setEntryTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])}
                    onCreate={async (name, color) => { const t = await onCreateTag(name, color); if (t?.id) setEntryTags(prev => [...prev, t.id]); }}
                    onClose={() => setShowPicker(false)}
                  />
                )}
              </div>
            </>
          )}

          <div className="modal__row">
            <div className="modal__field">
              <label className="modal__label">Start time</label>
              <input className="modal__input" type="datetime-local" value={startTime}
                onChange={e => { setStartTime(e.target.value); setError(''); }} />
            </div>
            <div className="modal__field">
              <label className="modal__label">End time</label>
              {isActive ? (
                <div className="modal__input" style={{ display: 'flex', alignItems: 'center', color: 'var(--green, #22c55e)', fontWeight: 600, cursor: 'default' }}>Running…</div>
              ) : (
                <input className="modal__input" type="datetime-local" value={endTime}
                  onChange={e => { setEndTime(e.target.value); setError(''); }} />
              )}
            </div>
          </div>
          <div className="modal__duration-preview">Duration: <strong>{durationPreview()}</strong></div>
          {error && <div className="modal__error">{error}</div>}
        </div>
        <div className="modal__footer">
          <button className="modal__btn modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="modal__btn modal__btn--save" onClick={handleSave}>{isActive ? 'Update Timer' : isNew ? 'Create Entry' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}
