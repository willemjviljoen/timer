import React, { useState, useRef, useEffect, useCallback } from 'react';
import TagPill from './TagPill';
import TagPicker from './TagPicker';

export default function TrackerBar({ onEntrySaved, settings, allTags, onCreateTag }) {
  const [description, setDescription] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [activeTags, setActiveTags] = useState([]);
  const [showTagPicker, setShowTagPicker] = useState(false);

  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const inputRef = useRef(null);
  const notificationFiredRef = useRef(false);
  const tagPickerRef = useRef(null);

  const api = window.electronAPI;

  // Close tag picker on outside click
  useEffect(() => {
    if (!showTagPicker) return;
    const h = e => { if (tagPickerRef.current && !tagPickerRef.current.contains(e.target)) setShowTagPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showTagPicker]);

  // ── Timer logic ────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (!description.trim()) { inputRef.current?.focus(); return; }
    const startTime = new Date().toISOString();
    startTimeRef.current = startTime;
    setIsRunning(true);
    setShowSuggestions(false);
    setShowTagPicker(false);
    notificationFiredRef.current = false;
    api?.saveActiveTimer?.({ description: description.trim(), startTime });
    const started = Date.now();
    intervalRef.current = setInterval(() => { setElapsed(Date.now() - started); }, 1000);
  }, [description, api]);

  const stopTimer = useCallback(async () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    const endTime = new Date().toISOString();
    const durationMs = elapsed;
    if (api?.saveEntry) {
      try {
        await api.saveEntry({
          description: description.trim(),
          startTime: startTimeRef.current,
          endTime,
          durationMs,
          tagIds: activeTags,
        });
        onEntrySaved?.();
      } catch (err) {
        console.error('Failed to save entry:', err);
      }
    }
    setIsRunning(false);
    setElapsed(0);
    setDescription('');
    setActiveTags([]);
    startTimeRef.current = null;
    inputRef.current?.focus();
    api?.clearActiveTimer?.();
  }, [description, elapsed, activeTags, api, onEntrySaved]);

  const toggleTimer = useCallback(() => {
    if (isRunning) stopTimer(); else startTimer();
  }, [isRunning, startTimer, stopTimer]);

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  // Global Ctrl+Space shortcut
  useEffect(() => {
    const handler = e => { if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); toggleTimer(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleTimer]);

  // Notification threshold
  useEffect(() => {
    if (!isRunning || !settings) return;
    const thresholdMs = (settings.notificationThresholdMinutes ?? 120) * 60 * 1000;
    if (elapsed >= thresholdMs && !notificationFiredRef.current) {
      notificationFiredRef.current = true;
      const mins = Math.floor(elapsed / 60000);
      api?.showNotification?.('Timer Alert ⏰', `"${description}" has been running for ${mins} minute${mins !== 1 ? 's' : ''}.`);
    }
  }, [elapsed, isRunning, settings, description, api]);

  // Crash recovery
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
        intervalRef.current = setInterval(() => { setElapsed(Date.now() - startDate.getTime()); }, 1000);
      } catch (err) {
        console.error('Failed to restore active timer:', err);
      }
    }
    restore();
    return () => { cancelled = true; };
  }, [api]);

  // Format elapsed time
  const formatTime = ms => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const p = n => String(n).padStart(2, '0');
    return { hours: p(hours), minutes: p(minutes), seconds: p(seconds) };
  };
  const time = formatTime(elapsed);

  // Autocomplete
  const fetchSuggestions = useCallback(async query => {
    if (!api?.searchDescriptions || query.trim().length === 0) { setSuggestions([]); setShowSuggestions(false); return; }
    try {
      const results = await api.searchDescriptions(query.trim());
      setSuggestions(results || []);
      setShowSuggestions(results && results.length > 0);
      setSelectedIndex(-1);
    } catch { setSuggestions([]); setShowSuggestions(false); }
  }, [api]);

  const handleInputChange = e => {
    const val = e.target.value;
    setDescription(val);
    if (isRunning) {
      api?.saveActiveTimer?.({ description: val.trim(), startTime: startTimeRef.current });
    } else {
      fetchSuggestions(val);
    }
  };

  const handleSelectSuggestion = desc => {
    setDescription(desc);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = e => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => (p + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => (p <= 0 ? suggestions.length - 1 : p - 1)); return; }
      if (e.key === 'Enter' && selectedIndex >= 0) { e.preventDefault(); handleSelectSuggestion(suggestions[selectedIndex].description); return; }
      if (e.key === 'Escape') { setShowSuggestions(false); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); toggleTimer(); }
  };

  const handleCreateTag = useCallback((name, color) => {
    return onCreateTag(name, color);
  }, [onCreateTag]);

  return (
    <div className="tracker">
      <div className="tracker__input-wrap" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Description input */}
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              ref={inputRef}
              className="tracker__input"
              type="text"
              placeholder="What are you working on?"
              value={description}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => { if (!isRunning && description.trim().length > 0 && suggestions.length > 0) setShowSuggestions(true); }}
              disabled={isRunning}
              autoFocus
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="autocomplete">
                {suggestions.map((item, i) => (
                  <div key={item.description}
                    className={`autocomplete__item ${i === selectedIndex ? 'selected' : ''}`}
                    onMouseDown={() => handleSelectSuggestion(item.description)}>
                    <span className="autocomplete__desc">{item.description}</span>
                    <span className="autocomplete__meta">{item.use_count}x</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tag button */}
          <div style={{ position: 'relative' }} ref={tagPickerRef}>
            <button
              onClick={() => { if (!isRunning) setShowTagPicker(!showTagPicker); }}
              disabled={isRunning}
              title="Add tags"
              className="tracker__tag-btn"
              style={{
                width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                background: activeTags.length > 0 ? '#e85d0418' : 'var(--bg-input)',
                border: `1.5px solid ${activeTags.length > 0 ? '#e85d0440' : 'var(--border)'}`,
                borderRadius: 6, cursor: isRunning ? 'default' : 'pointer',
                color: activeTags.length > 0 ? '#e85d04' : 'var(--text-dim)',
                opacity: isRunning ? 0.4 : 1, transition: 'all .15s',
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
              {activeTags.length > 0 && (
                <span style={{ position: 'absolute', top: -5, right: -5, width: 17, height: 17, borderRadius: '50%', background: '#e85d04', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace" }}>
                  {activeTags.length}
                </span>
              )}
            </button>
            {showTagPicker && (
              <TagPicker
                allTags={allTags}
                selectedTagIds={activeTags}
                onToggle={id => setActiveTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])}
                onCreate={(name, color) => { const t = handleCreateTag(name, color); setActiveTags(prev => [...prev, t.id]); }}
                onClose={() => setShowTagPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Active tag pills */}
        {activeTags.length > 0 && !isRunning && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 2 }}>
            {activeTags.map(tid => {
              const tag = allTags.find(t => t.id === tid);
              return tag ? <TagPill key={tid} tag={tag} size="sm" onRemove={id => setActiveTags(prev => prev.filter(t => t !== id))} /> : null;
            })}
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

      {/* Start/Stop button */}
      <button
        className={`tracker__btn ${isRunning ? 'tracker__btn--stop' : 'tracker__btn--start'}`}
        onClick={toggleTimer}
        title={isRunning ? 'Stop & save' : 'Start timer'}>
        {isRunning
          ? <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          : <svg viewBox="0 0 24 24"><polygon points="7,4 21,12 7,20" /></svg>}
      </button>
    </div>
  );
}
