import React, { useState, useEffect } from 'react';

function toLocalDatetime(isoString) {
  try {
    const d = new Date(isoString);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

function fromLocalDatetime(localStr) {
  try {
    return new Date(localStr).toISOString();
  } catch {
    return '';
  }
}

export default function EditModal({ entry, onSave, onCancel }) {
  const [description, setDescription] = useState(entry.description);
  const [startTime, setStartTime] = useState(toLocalDatetime(entry.start_time));
  const [endTime, setEndTime] = useState(toLocalDatetime(entry.end_time));
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const handleSave = () => {
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setError('Please enter valid dates.');
      return;
    }
    if (end <= start) {
      setError('End time must be after start time.');
      return;
    }
    if (!description.trim()) {
      setError('Description cannot be empty.');
      return;
    }

    const durationMs = end.getTime() - start.getTime();

    onSave({
      id: entry.id,
      description: description.trim(),
      startTime: fromLocalDatetime(startTime),
      endTime: fromLocalDatetime(endTime),
      durationMs,
    });
  };

  const durationPreview = () => {
    try {
      const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
      if (ms <= 0 || isNaN(ms)) return '--';
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    } catch {
      return '--';
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Edit Entry</h3>
          <button className="modal__close" onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal__body">
          <label className="modal__label">Description</label>
          <input
            className="modal__input"
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setError(''); }}
            autoFocus
          />

          <div className="modal__row">
            <div className="modal__field">
              <label className="modal__label">Start time</label>
              <input
                className="modal__input"
                type="datetime-local"
                value={startTime}
                onChange={(e) => { setStartTime(e.target.value); setError(''); }}
              />
            </div>
            <div className="modal__field">
              <label className="modal__label">End time</label>
              <input
                className="modal__input"
                type="datetime-local"
                value={endTime}
                onChange={(e) => { setEndTime(e.target.value); setError(''); }}
              />
            </div>
          </div>

          <div className="modal__duration-preview">
            Duration: <strong>{durationPreview()}</strong>
          </div>

          {error && <div className="modal__error">{error}</div>}
        </div>

        <div className="modal__footer">
          <button className="modal__btn modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="modal__btn modal__btn--save" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}
