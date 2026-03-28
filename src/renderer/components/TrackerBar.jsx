import React, { useState, useRef, useEffect, useCallback } from 'react';
import TagPill from './TagPill';
import TagPicker from './TagPicker';
import { formatTime } from '../utils/formatting';

export default function TrackerBar({ onEntrySaved, settings, allTags, allProjects, onCreateTag, onTimerStateChange }) {
  const [description, setDescription] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [projectSuggestions, setProjectSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [activeTags, setActiveTags] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectPickerFilter, setProjectPickerFilter] = useState('');

  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const inputRef = useRef(null);
  const notificationFiredRef = useRef(false);
  const tagPickerRef = useRef(null);
  const projectPickerRef = useRef(null);

  const api = window.electronAPI;

  // Total items in dropdown (projects first, then descriptions)
  const totalSuggestions = projectSuggestions.length + suggestions.length;

  // Close tag picker on outside click
  useEffect(() => {
    if (!showTagPicker) return;
    const h = e => { if (tagPickerRef.current && !tagPickerRef.current.contains(e.target)) setShowTagPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showTagPicker]);

  // Close project picker on outside click
  useEffect(() => {
    if (!showProjectPicker) return;
    const h = e => { if (projectPickerRef.current && !projectPickerRef.current.contains(e.target)) { setShowProjectPicker(false); setProjectPickerFilter(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showProjectPicker]);

  // ── Timer logic ────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    if (!description.trim()) { inputRef.current?.focus(); return; }
    const startTime = new Date().toISOString();
    startTimeRef.current = startTime;
    setIsRunning(true);
    setShowSuggestions(false);
    setShowTagPicker(false);
    notificationFiredRef.current = false;
    api?.saveActiveTimer?.({ description: description.trim(), startTime, projectId: activeProjectId });
    const started = Date.now();
    intervalRef.current = setInterval(() => { setElapsed(Date.now() - started); }, 1000);
    onTimerStateChange?.({ isRunning: true, description: description.trim(), elapsed: 0, startTime, projectId: activeProjectId });
  }, [description, activeProjectId, api, onTimerStateChange]);

  const stopTimer = useCallback(async () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    const endTime = new Date().toISOString();
    const durationMs = startTimeRef.current ? Date.now() - new Date(startTimeRef.current).getTime() : elapsed;
    if (api?.saveEntry) {
      try {
        await api.saveEntry({
          description: description.trim(),
          startTime: startTimeRef.current,
          endTime,
          durationMs,
          tagIds: activeTags,
          projectId: activeProjectId,
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
    setActiveProjectId(null);
    startTimeRef.current = null;
    inputRef.current?.focus();
    api?.clearActiveTimer?.();
    onTimerStateChange?.({ isRunning: false, description: '', elapsed: 0, projectId: null });
  }, [description, elapsed, activeTags, activeProjectId, api, onEntrySaved, onTimerStateChange]);

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
        if (active.project_id) setActiveProjectId(active.project_id);
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

  // Listen for control events from thumbbar and mini widget
  useEffect(() => {
    const handlePlayPause = () => toggleTimer();
    const handleStop = () => stopTimer();
    const handlePlay = () => { if (!isRunning) startTimer(); };
    const handlePause = () => { if (isRunning) stopTimer(); };
    const handleSetTaskDescription = (e) => { setDescription(e.detail); };
    const handleUpdateActiveTimer = (e) => {
      const { description: desc, startTime } = e.detail;
      if (desc != null) setDescription(desc);
      if (startTime) {
        startTimeRef.current = startTime;
        const offset = Date.now() - new Date(startTime).getTime();
        setElapsed(offset);
        if (intervalRef.current) clearInterval(intervalRef.current);
        const startDate = new Date(startTime);
        intervalRef.current = setInterval(() => { setElapsed(Date.now() - startDate.getTime()); }, 1000);
        api?.saveActiveTimer?.({ description: desc ?? description, startTime, projectId: activeProjectId });
      }
    };

    window.addEventListener('tracker-play-pause', handlePlayPause);
    window.addEventListener('tracker-stop', handleStop);
    window.addEventListener('tracker-play', handlePlay);
    window.addEventListener('tracker-pause', handlePause);
    window.addEventListener('set-task-description', handleSetTaskDescription);
    window.addEventListener('update-active-timer', handleUpdateActiveTimer);

    return () => {
      window.removeEventListener('tracker-play-pause', handlePlayPause);
      window.removeEventListener('tracker-stop', handleStop);
      window.removeEventListener('tracker-play', handlePlay);
      window.removeEventListener('tracker-pause', handlePause);
      window.removeEventListener('set-task-description', handleSetTaskDescription);
      window.removeEventListener('update-active-timer', handleUpdateActiveTimer);
    };
  }, [toggleTimer, stopTimer, startTimer, isRunning, description, activeProjectId, api]);

  // Report elapsed time changes to parent
  useEffect(() => {
    if (isRunning) {
      onTimerStateChange?.({ isRunning, description, elapsed, startTime: startTimeRef.current, projectId: activeProjectId });
    }
  }, [elapsed, isRunning, description, activeProjectId, onTimerStateChange]);

  // ── Remote sync: active timer changes from another device ───────
  useEffect(() => {
    if (!api?.onActiveTimerSync) return;
    api.onActiveTimerSync((data) => {
      if (data) {
        // Remote device started or updated a timer — apply it locally
        const startDate = new Date(data.startTime);
        startTimeRef.current = data.startTime;
        setDescription(data.description);
        setIsRunning(true);
        setShowSuggestions(false);
        setShowTagPicker(false);
        notificationFiredRef.current = false;
        const offset = Date.now() - startDate.getTime();
        setElapsed(offset);
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => { setElapsed(Date.now() - startDate.getTime()); }, 1000);
        onTimerStateChange?.({ isRunning: true, description: data.description, elapsed: offset, startTime: data.startTime, projectId: activeProjectId });
      } else {
        // Remote device stopped the timer
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        setIsRunning(false);
        setElapsed(0);
        setDescription('');
        setActiveTags([]);
        setActiveProjectId(null);
        startTimeRef.current = null;
        onTimerStateChange?.({ isRunning: false, description: '', elapsed: 0, projectId: null });
      }
    });
  }, [api, onTimerStateChange]);

  const time = formatTime(elapsed);

  // Autocomplete — now returns { descriptions, projects }
  const fetchSuggestions = useCallback(async query => {
    if (!api?.searchDescriptions || query.trim().length === 0) {
      setSuggestions([]);
      setProjectSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const result = await api.searchDescriptions(query.trim());
      const descs = result?.descriptions || result || [];
      const projs = result?.projects || [];
      setSuggestions(descs);
      setProjectSuggestions(projs);
      setShowSuggestions((Array.isArray(descs) && descs.length > 0) || (Array.isArray(projs) && projs.length > 0));
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
      setProjectSuggestions([]);
      setShowSuggestions(false);
    }
  }, [api]);

  const handleInputChange = e => {
    const val = e.target.value;
    setDescription(val);
    if (isRunning) {
      api?.saveActiveTimer?.({ description: val.trim(), startTime: startTimeRef.current, projectId: activeProjectId });
    } else {
      fetchSuggestions(val);
    }
  };

  const handleSelectSuggestion = (desc, projectId) => {
    setDescription(desc);
    if (projectId) setActiveProjectId(projectId);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleSelectProject = (project) => {
    setActiveProjectId(project.id);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = e => {
    if (showSuggestions && totalSuggestions > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => (p + 1) % totalSuggestions); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => (p <= 0 ? totalSuggestions - 1 : p - 1)); return; }
      if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        if (selectedIndex < projectSuggestions.length) {
          // Selected a project
          handleSelectProject(projectSuggestions[selectedIndex]);
        } else {
          // Selected a description
          const descItem = suggestions[selectedIndex - projectSuggestions.length];
          handleSelectSuggestion(descItem.description, descItem.project_id);
        }
        return;
      }
      if (e.key === 'Escape') { setShowSuggestions(false); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); toggleTimer(); }
  };

  const handleCreateTag = useCallback((name, color) => {
    return onCreateTag(name, color);
  }, [onCreateTag]);

  // Find the active project object for display
  const activeProject = activeProjectId && allProjects
    ? allProjects.find(p => p.id === activeProjectId)
    : null;

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
              onFocus={() => { if (!isRunning && description.trim().length > 0 && totalSuggestions > 0) setShowSuggestions(true); }}
              disabled={isRunning}
              autoFocus
            />
            {showSuggestions && totalSuggestions > 0 && (
              <div className="autocomplete">
                {/* Project matches */}
                {projectSuggestions.length > 0 && (
                  <>
                    <div className="autocomplete__section-label">Projects</div>
                    {projectSuggestions.map((proj, i) => (
                      <div key={`proj-${proj.id}`}
                        className={`autocomplete__item autocomplete__item--project ${i === selectedIndex ? 'selected' : ''}`}
                        onMouseDown={() => handleSelectProject(proj)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          <span className="autocomplete__project-dot" style={{ background: proj.color || '#6366f1' }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj.name}</span>
                            {proj.client_name && (
                              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj.client_name}</span>
                            )}
                          </div>
                        </div>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                      </div>
                    ))}
                  </>
                )}
                {/* Description matches */}
                {suggestions.length > 0 && (
                  <>
                    {projectSuggestions.length > 0 && (
                      <div className="autocomplete__section-label">Recent entries</div>
                    )}
                    {suggestions.map((item, i) => {
                      const idx = projectSuggestions.length + i;
                      const itemProject = item.project_id && allProjects
                        ? allProjects.find(p => p.id === item.project_id)
                        : null;
                      return (
                        <div key={item.description}
                          className={`autocomplete__item ${idx === selectedIndex ? 'selected' : ''}`}
                          onMouseDown={() => handleSelectSuggestion(item.description, item.project_id)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                            <span className="autocomplete__desc">{item.description}</span>
                            {itemProject && (
                              <span className="autocomplete__project-badge" style={{ borderColor: itemProject.color || '#6366f1', color: itemProject.color || '#6366f1' }}>
                                {itemProject.name}
                              </span>
                            )}
                          </div>
                          <span className="autocomplete__meta">{item.use_count}x</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Project picker button */}
          <div style={{ position: 'relative' }} ref={projectPickerRef}>
            <button
              onClick={() => { if (!isRunning) { setShowProjectPicker(!showProjectPicker); setShowTagPicker(false); setProjectPickerFilter(''); } }}
              disabled={isRunning}
              title="Select project"
              className="tracker__tag-btn"
              style={{
                width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                background: activeProjectId ? 'rgba(99,102,241,0.08)' : 'var(--bg-input)',
                border: `1.5px solid ${activeProjectId ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
                borderRadius: 6, cursor: isRunning ? 'default' : 'pointer',
                color: activeProjectId ? (activeProject?.color || '#6366f1') : 'var(--text-dim)',
                opacity: isRunning ? 0.4 : 1, transition: 'all .15s',
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              {activeProjectId && (
                <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: activeProject?.color || '#6366f1' }} />
              )}
            </button>
            {showProjectPicker && (() => {
              const projects = allProjects || [];
              const q = projectPickerFilter.toLowerCase();
              const filtered = projects.filter(p =>
                p.name.toLowerCase().includes(q) || (p.client_name || '').toLowerCase().includes(q)
              );
              return (
                <div className="autocomplete" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, left: 'auto', minWidth: 240, maxWidth: 320 }}>
                  {projects.length > 0 && (
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                      <input
                        type="text"
                        placeholder="Filter projects…"
                        value={projectPickerFilter}
                        onChange={e => setProjectPickerFilter(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') { setShowProjectPicker(false); setProjectPickerFilter(''); } }}
                        autoFocus
                        style={{ width: '100%', height: 30, padding: '0 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none' }}
                      />
                    </div>
                  )}
                  {projects.length > 0 && (
                    <div
                      className={`autocomplete__item ${!activeProjectId ? 'selected' : ''}`}
                      onMouseDown={() => { setActiveProjectId(null); setShowProjectPicker(false); setProjectPickerFilter(''); }}>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>No project</span>
                    </div>
                  )}
                  {filtered.map(proj => (
                    <div key={proj.id}
                      className={`autocomplete__item ${proj.id === activeProjectId ? 'selected' : ''}`}
                      onMouseDown={() => { setActiveProjectId(proj.id); setShowProjectPicker(false); setProjectPickerFilter(''); }}>
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
                  {projects.length > 0 && filtered.length === 0 && (
                    <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>No matches</div>
                  )}
                  {projects.length === 0 && (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
                      No projects yet. Create one in Settings.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Tag button */}
          <div style={{ position: 'relative' }} ref={tagPickerRef}>
            <button
              onClick={() => { if (!isRunning) { setShowTagPicker(!showTagPicker); setShowProjectPicker(false); } }}
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
                onCreate={async (name, color) => { const t = await handleCreateTag(name, color); if (t?.id) setActiveTags(prev => [...prev, t.id]); }}
                onClose={() => setShowTagPicker(false)}
              />
            )}
          </div>
        </div>

        {/* Project indicator (shown below input when a project is connected) */}
        {activeProject && (
          <div className="tracker__project-indicator">
            <span className="tracker__project-dot" style={{ background: activeProject.color || '#6366f1' }} />
            <span className="tracker__project-name">
              {activeProject.client_name ? `${activeProject.client_name} / ` : ''}{activeProject.name}
            </span>
            {!isRunning && (
              <button className="tracker__project-clear" onClick={() => setActiveProjectId(null)} title="Remove project">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}

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
