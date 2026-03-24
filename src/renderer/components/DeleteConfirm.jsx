import React, { useEffect } from 'react';

export default function DeleteConfirm({ entry, onConfirm, onCancel }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--small" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Delete Entry</h3>
          <button className="modal__close" onClick={onCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal__body">
          <p className="delete-confirm__message">
            Are you sure you want to delete this entry?
          </p>
          <div className="delete-confirm__entry">
            <span className="delete-confirm__desc">{entry.description}</span>
          </div>
          <p className="delete-confirm__warning">
            This action cannot be undone.
          </p>
        </div>

        <div className="modal__footer">
          <button className="modal__btn modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="modal__btn modal__btn--delete" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
