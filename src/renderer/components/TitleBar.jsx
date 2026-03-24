import React, { useState, useEffect } from 'react';

export default function TitleBar() {
  const [pinned, setPinned] = useState(false);
  const api = window.electronAPI;

  useEffect(() => {
    if (api?.onAlwaysOnTopChanged) {
      api.onAlwaysOnTopChanged((value) => setPinned(value));
    }
  }, []);

  return (
    <div className="titlebar">
      <span className="titlebar__label">TimeTracker</span>

      <div className="titlebar__controls">
        {/* Pin / Always-on-top */}
        <button
          className={`titlebar__btn titlebar__btn--pin ${pinned ? 'active' : ''}`}
          title={pinned ? 'Unpin from top' : 'Pin on top'}
          onClick={() => api?.toggleAlwaysOnTop()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
        </button>

        {/* Minimize */}
        <button
          className="titlebar__btn"
          title="Minimize"
          onClick={() => api?.minimizeWindow()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Close to tray */}
        <button
          className="titlebar__btn titlebar__btn--close"
          title="Close to tray"
          onClick={() => api?.closeWindow()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
