import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function TrackerBar({ onEntrySaved, settings }) {
  const [description, setDescription] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // milliseconds
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const inputRef = useRef(null);
  const notificationFiredRef = useRef(false);

  const api = window.electronAPI;

  // ── Timer logic ────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (!description.trim()) {
      inputRef.current?.focus();
      return;
    }

    const startTime = new Date().toISOString();
    startTimeRef.current = startTime;
    setIsRunning(true);
    setShowSuggestions(false);
    notificationFiredRef.current = false;

    // Persist active timer to DB for crash recovery
    api?.saveActiveTimer?.({ description: description.trim(), startTime });

    const started = Date.now();
    intervalRef.current = setInterval(() => {
      setElapsed(Date.now() - started);
    }, 1000);
  }, [description, api]);

  const stopTimer = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const endTime = new Date().toISOString();
    const durationMs = elapsed;

    // Save the entry
    if (api?.saveEntry) {
      try {
        await api.saveEntry({
          description: description.trim(),
          startTime: startTimeRef.current,
          endTime: endTime,
          durationMs: durationMs,
        });
        onEntrySaved?.();
      } catch (err) {
        console.error('Failed to save entry:', err);
      }
    }

    // Reset
    setIsRunning(false);
    setElapsed(0);
    setDescription('');
    startTimeRef.current = null;
    inputRef.current?.focus();

    // Clear persisted active timer
    api?.clearActiveTimer?.();
  }, [description, elapsed, api, onEntrySaved]);

  const toggleTimer = useCallback(() => {
    if (isRunning) {
      stopTimer();
    } else {
      startTimer();
    }
  }, [isRunning, startTimer, stopTimer]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ── Global Ctrl+Space shortcut ──────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        toggleTimer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleTimer]);

  // ── Notification threshold check ────────────────────────────────
  useEffect(() => {
    if (!isRunning || !settings) return;
    const thresholdMs = (settings.notificationThresholdMinutes ?? 120) * 60 * 1000;
    if (elapsed >= thresholdMs && !notificationFiredRef.current) {
      notificationFiredRef.current = true;
      const mins = Math.floor(elapsed / 60000);
      api?.showNotification?.(
        'Timer Alert ⏰',
        `"${description}" has been running for ${mins} minute${mins !== 1 ? 's' : ''}.`
      );
    }
  }, [elapsed, isRunning, settings, description, api]);

  // ── Restore active timer on mount (crash recovery) ────────────
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!api?.getActiveTimer) return;
      try {
        const active = await api.getActiveTimer();
        if (!active || cancelled) return;

        const startDate = new Date(active.start_time);
        startTimeRef.current = active.start_time;
        setDescription(active.description);
        setIsRunning(true);

        const offset = Date.now() - startDate.getTime();
        setElapsed(offset);

        intervalRef.current = setInterval(() => {
          setElapsed(Date.now() - startDate.getTime());
        }, 1000);
      } catch (err) {
        console.error('Failed to restore active timer:', err);
      }
    }
    restore();
    return () => { cancelled = true; };
  }, [api]);

  // ── Format elapsed time → HH:MM:SS ───────────────────────────
  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours   = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n) => String(n).padStart(2, '0');

    return { hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) };
  };

  const time = formatTime(elapsed);

  // ── Autocomplete ───────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (query) => {
    if (!api?.searchDescriptions || query.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const results = await api.searchDescriptions(query.trim());
      setSuggestions(results || []);
      setShowSuggestions(results && results.length > 0);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [api]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setDescription(val);
    if (isRunning) {
      // Update persisted description for crash recovery
      api?.saveActiveTimer?.({ description: val.trim(), startTime: startTimeRef.current });
    } else {
      fetchSuggestions(val);
    }
  };

  const handleSelectSuggestion = (desc) => {
    setDescription(desc);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    // Autocomplete navigation
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
      if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex].description);
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }

    // Enter to start/stop timer
    if (e.key === 'Enter') {
      e.preventDefault();
      toggleTimer();
    }
  };

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => setShowSuggestions(false), 150);
  };

  const handleFocus = () => {
    if (!isRunning && description.trim().length > 0 && suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="tracker">
      {/* Description input with autocomplete */}
      <div className="tracker__input-wrap">
        <input
          ref={inputRef}
          className="tracker__input"
          type="text"
          placeholder="What are you working on?"
          value={description}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
          autoFocus
        />

        {showSuggestions && suggestions.length > 0 && (
          <div className="autocomplete">
            {suggestions.map((item, i) => (
              <div
                key={item.description}
                className={`autocomplete__item ${i === selectedIndex ? 'selected' : ''}`}
                onMouseDown={() => handleSelectSuggestion(item.description)}
              >
                <span className="autocomplete__desc">{item.description}</span>
                <span className="autocomplete__meta">
                  {item.use_count}x
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timer display */}
      <div className={`timer ${isRunning ? 'running' : ''}`}>
        <span className="timer__segment">
          <span className="timer__value">{time.hours}</span>
          <span className="timer__label">h</span>
          <span className="timer__colon">:</span>
        </span>
        <span className="timer__segment">
          <span className="timer__value">{time.minutes}</span>
          <span className="timer__label">m</span>
          <span className="timer__colon">:</span>
        </span>
        <span className="timer__segment">
          <span className="timer__value">{time.seconds}</span>
          <span className="timer__label">s</span>
        </span>
      </div>

      {/* Start / Stop button */}
      <button
        className={`tracker__btn ${isRunning ? 'tracker__btn--stop' : 'tracker__btn--start'}`}
        onClick={toggleTimer}
        title={isRunning ? 'Stop & save' : 'Start timer'}
      >
        {isRunning ? (
          // Stop icon (square)
          <svg viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          // Play icon (triangle)
          <svg viewBox="0 0 24 24">
            <polygon points="7,4 21,12 7,20" />
          </svg>
        )}
      </button>
    </div>
  );
}
