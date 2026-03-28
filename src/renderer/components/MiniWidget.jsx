import React, { useState, useEffect, useRef } from 'react';

export default function MiniWidget({ timerState, allProjects, onToggleMode }) {
  const [displayTime, setDisplayTime] = useState('00:00:00');
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const intervalRef = useRef(null);
  const inputRef = useRef(null);
  const api = window.electronAPI;

  // Update display time every 100ms when running
  useEffect(() => {
    const updateDisplay = () => {
      let total = timerState?.elapsed || 0;
      const seconds = Math.floor(total / 1000) % 60;
      const minutes = Math.floor(total / 60000) % 60;
      const hours = Math.floor(total / 3600000);
      setDisplayTime(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateDisplay();
    if (timerState?.isRunning) {
      intervalRef.current = setInterval(updateDisplay, 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [timerState]);

  const handlePlayPause = () => {
    // In mini mode, require a description before starting
    if (!timerState?.description || !timerState.description.trim()) {
      handleOpenTaskInput();
    } else {
      window.dispatchEvent(new CustomEvent('tracker-play-pause'));
    }
  };

  const handleStop = () => {
    window.dispatchEvent(new CustomEvent('tracker-stop'));
  };

  const handleToggleMode = () => {
    onToggleMode?.();
  };

  const handleOpenTaskInput = () => {
    setTaskInput(timerState?.description || '');
    setShowTaskInput(true);
  };

  const handleSubmitTask = () => {
    if (taskInput.trim()) {
      // Dispatch custom event to update TrackerBar with new description
      window.dispatchEvent(new CustomEvent('set-task-description', { detail: taskInput.trim() }));
      setShowTaskInput(false);
      // Auto-start the timer after setting description
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('tracker-play-pause'));
      }, 100);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmitTask();
    } else if (e.key === 'Escape') {
      setShowTaskInput(false);
    }
  };

  // Focus input when dialog opens
  useEffect(() => {
    if (showTaskInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showTaskInput]);

  // Listen for always-on-top state changes
  useEffect(() => {
    api?.onAlwaysOnTopChanged?.((value) => {
      setIsPinned(value);
    });
  }, [api]);

  const handleTogglePin = () => {
    api?.toggleAlwaysOnTop?.();
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '6px 10px',
        boxSizing: 'border-box',
        fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
        color: '#fff',
      }}
    >
      {/* Header with controls - draggable area */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2px',
          WebkitAppRegion: 'drag',
          cursor: 'grab',
        }}
      >
        <div style={{ fontSize: '10px', color: '#666', fontWeight: 'bold' }}>TIMER</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {/* Pin button */}
          <button
            onClick={handleTogglePin}
            style={{
              background: 'none',
              border: 'none',
              color: isPinned ? '#e85d04' : '#999',
              cursor: 'pointer',
              padding: '0',
              width: '14px',
              height: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
              WebkitAppRegion: 'no-drag',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = isPinned ? '#e85d04' : '#999'; }}
            title={isPinned ? 'Unpin from top' : 'Pin on top'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
            </svg>
          </button>
          {/* Expand button */}
          <button
            onClick={handleToggleMode}
            style={{
              background: 'none',
              border: 'none',
              color: '#999',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0',
              width: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
              WebkitAppRegion: 'no-drag',
            }}
            onMouseEnter={(e) => { e.target.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.target.style.color = '#999'; }}
            title="Expand to full mode"
          >
            ⛶
          </button>
        </div>
      </div>

      {/* Timer Display */}
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div
          style={{
            fontSize: '28px',
            fontWeight: 'bold',
            fontFamily: 'monospace',
            letterSpacing: '1px',
            marginBottom: '0px',
            lineHeight: '1.2',
          }}
        >
          {displayTime}
        </div>
        <div
          onClick={() => !timerState?.isRunning && handleOpenTaskInput()}
          style={{
            fontSize: '10px',
            color: timerState?.description ? '#888' : '#666',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            lineHeight: '1.2',
            cursor: !timerState?.isRunning && !timerState?.description ? 'pointer' : 'default',
            textDecoration: !timerState?.isRunning && !timerState?.description ? 'underline' : 'none',
          }}
          title={timerState?.description || 'Click to enter task'}
        >
          {timerState?.description || 'Click to enter task'}
        </div>
        {(() => {
          const proj = timerState?.projectId && allProjects
            ? allProjects.find(p => p.id === timerState.projectId)
            : null;
          return proj ? (
            <div style={{
              fontSize: '9px',
              color: proj.color || '#6366f1',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              lineHeight: '1.2',
              fontFamily: 'monospace',
            }}>
              {proj.client_name ? `${proj.client_name} / ` : ''}{proj.name}
            </div>
          ) : null;
        })()}
      </div>

      {/* Control Button - Single context-aware button */}
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '2px' }}>
        {timerState?.isRunning ? (
          <button
            onClick={handleStop}
            style={{
              flex: 1,
              padding: '6px 8px',
              backgroundColor: '#ef476f',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              WebkitAppRegion: 'no-drag',
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#d63659';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#ef476f';
            }}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handlePlayPause}
            style={{
              flex: 1,
              padding: '6px 8px',
              backgroundColor: '#06a77d',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              WebkitAppRegion: 'no-drag',
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#058968';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#06a77d';
            }}
          >
            Start Timer
          </button>
        )}
      </div>

      {/* Task Input Modal - only in mini mode */}
      {showTaskInput && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowTaskInput(false)}
        >
          <div
            style={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '16px',
              minWidth: '280px',
              maxWidth: '90vw',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#999', display: 'block', marginBottom: '6px' }}>
                Task Description
              </label>
              <input
                ref={inputRef}
                type="text"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter task name..."
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: '#0a0a0a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSubmitTask}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: '#06a77d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                OK
              </button>
              <button
                onClick={() => setShowTaskInput(false)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: '#333',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
