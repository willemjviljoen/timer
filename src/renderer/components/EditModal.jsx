import React, { useState, useEffect, useRef } from 'react';
import TagPill from './TagPill';
import TagPicker from './TagPicker';
import { toLocalDatetime, fromLocalDatetime } from '../utils/formatting';

export default function EditModal({ entry, onSave, onCancel, allTags, allProjects, onCreateTag, isNew = false }) {
  const isActive = entry._isActive === true;
  const [description, setDescription] = useState(entry.description);
  const [startTime, setStartTime] = useState(toLocalDatetime(entry.start_time));
  const [endTime, setEndTime] = useState(toLocalDatetime(entry.end_time));
  const [entryTags, setEntryTags] = useState(entry.tags || []);
  const [projectId, setProjectId] = useState(entry.project_id || null);
  const [showPicker, setShowPicker] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [error, setError] = useState('');
  const projectFilterRef = useRef(null);
  const pickerRef = useRef(null);
  const projectDropdownRef = useRef(null);

  useEffect(() => {
    const handleKey = e => { if (e.key === 'Escape' && !showPicker && !showProjectDropdown) onCancel(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel, showPicker, showProjectDropdown]);

  useEffect(() => {
    if (!showPicker) return;
    const h = e => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showPicker]);

  useEffect(() => {
    if (!showProjectDropdown) return;
    const h = e => { if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target)) { setShowProjectDropdown(false); setProjectFilter(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showProjectDropdown]);

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
        projectId,
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
      projectId,
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

  const selectedProject = projectId && allProjects ? allProjects.find(p => p.id === projectId) : null;

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

          {/* Project selector */}
          {allProjects && allProjects.length > 0 && (
            <>
              <label className="modal__label" style={{ marginTop: 4 }}>Project</label>
              <div style={{ position: 'relative', marginBottom: 14 }} ref={projectDropdownRef}>
                <div onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                  style={{ minHeight: 40, padding: '6px 12px', background: 'var(--bg-input)', border: '1.5px solid var(--border)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedProject ? (
                    <>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: selectedProject.color || '#6366f1', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                        {selectedProject.client_name ? `${selectedProject.client_name} / ` : ''}{selectedProject.name}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setProjectId(null); }}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>No project (optional)</span>
                  )}
                </div>
                {showProjectDropdown && (() => {
                  const q = projectFilter.toLowerCase();
                  const filtered = allProjects.filter(p =>
                    p.name.toLowerCase().includes(q) || (p.client_name || '').toLowerCase().includes(q)
                  );
                  return (
                    <div className="autocomplete" style={{ top: 'calc(100% + 4px)' }}>
                      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                        <input
                          ref={projectFilterRef}
                          type="text"
                          placeholder="Filter projects…"
                          value={projectFilter}
                          onChange={e => setProjectFilter(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') { setShowProjectDropdown(false); setProjectFilter(''); } }}
                          autoFocus
                          style={{ width: '100%', height: 30, padding: '0 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none' }}
                        />
                      </div>
                      <div
                        className={`autocomplete__item ${!projectId ? 'selected' : ''}`}
                        onMouseDown={() => { setProjectId(null); setShowProjectDropdown(false); setProjectFilter(''); }}>
                        <span className="autocomplete__desc" style={{ color: 'var(--text-dim)' }}>No project</span>
                      </div>
                      {filtered.map(proj => (
                        <div key={proj.id}
                          className={`autocomplete__item ${proj.id === projectId ? 'selected' : ''}`}
                          onMouseDown={() => { setProjectId(proj.id); setShowProjectDropdown(false); setProjectFilter(''); }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: proj.color || '#6366f1', flexShrink: 0 }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj.name}</span>
                              {proj.client_name && (
                                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj.client_name}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {filtered.length === 0 && (
                        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>No matches</div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </>
          )}

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
