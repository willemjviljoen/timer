import React, { useState, useEffect, useRef } from 'react';
import AuthButton from './AuthButton';

// ─── Color palette for projects ──────────────────────────────────
const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
  '#f97316', '#e85d04', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6b7280', '#78716c',
];

// ─── Project Form (inline add / edit) ────────────────────────────
function ProjectForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [clientName, setClientName] = useState(initial?.client_name || '');
  const [color, setColor] = useState(initial?.color || '#6366f1');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), clientName: clientName.trim(), color });
  };

  return (
    <div className="project-form">
      <div className="project-form__fields">
        <div className="project-form__field">
          <label className="modal__label">Client name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <input
            className="modal__input"
            type="text"
            placeholder="e.g. Acme Corp"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
        </div>
        <div className="project-form__field">
          <label className="modal__label">Project name</label>
          <input
            ref={inputRef}
            className="modal__input"
            type="text"
            placeholder="e.g. Website Redesign"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
            style={{ marginBottom: 8 }}
          />
        </div>
        <div className="project-form__field">
          <label className="modal__label">Color</label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PROJECT_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                style={{
                  width: 22, height: 22, borderRadius: 4, border: c === color ? '2px solid var(--text-primary)' : '2px solid transparent',
                  background: c, cursor: 'pointer', transition: 'border-color .15s', padding: 0,
                }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="modal__btn modal__btn--cancel" onClick={onCancel} style={{ height: 30, fontSize: 12, padding: '0 12px' }}>Cancel</button>
        <button className="modal__btn modal__btn--save" onClick={handleSubmit} disabled={!name.trim()} style={{ height: 30, fontSize: 12, padding: '0 12px', opacity: name.trim() ? 1 : 0.4 }}>
          {initial ? 'Update' : 'Add Project'}
        </button>
      </div>
    </div>
  );
}

// ─── Projects Tab Content ────────────────────────────────────────
function ProjectsTab({ allProjects, onProjectsChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const api = window.electronAPI;

  const handleCreate = async ({ name, clientName, color }) => {
    await api?.createProject?.({ name, clientName, color });
    setShowForm(false);
    onProjectsChanged?.();
  };

  const handleUpdate = async ({ name, clientName, color }) => {
    if (!editingProject) return;
    await api?.updateProject?.({ id: editingProject.id, name, clientName, color });
    setEditingProject(null);
    onProjectsChanged?.();
  };

  const handleDelete = async (id) => {
    await api?.deleteProject?.(id);
    setConfirmDelete(null);
    onProjectsChanged?.();
  };

  // Group projects by client
  const grouped = {};
  const noClient = [];
  (allProjects || []).forEach(p => {
    if (p.client_name) {
      if (!grouped[p.client_name]) grouped[p.client_name] = [];
      grouped[p.client_name].push(p);
    } else {
      noClient.push(p);
    }
  });
  const clientNames = Object.keys(grouped).sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Project list */}
      {allProjects && allProjects.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 }}>
          {/* Projects grouped by client */}
          {clientNames.map(client => (
            <div key={client}>
              <div className="project-list__client-header">{client}</div>
              {grouped[client].map(proj => (
                <ProjectRow key={proj.id} project={proj}
                  isEditing={editingProject?.id === proj.id}
                  onEdit={() => { setEditingProject(proj); setShowForm(false); }}
                  onDelete={() => setConfirmDelete(proj)}
                  onSaveEdit={handleUpdate}
                  onCancelEdit={() => setEditingProject(null)}
                />
              ))}
            </div>
          ))}
          {/* Projects without a client */}
          {noClient.length > 0 && clientNames.length > 0 && (
            <div className="project-list__client-header">No client</div>
          )}
          {noClient.map(proj => (
            <ProjectRow key={proj.id} project={proj}
              isEditing={editingProject?.id === proj.id}
              onEdit={() => { setEditingProject(proj); setShowForm(false); }}
              onDelete={() => setConfirmDelete(proj)}
              onSaveEdit={handleUpdate}
              onCancelEdit={() => setEditingProject(null)}
            />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', padding: '12px 0', textAlign: 'center' }}>
          No projects yet. Add one to start linking time entries.
        </p>
      )}

      {/* Add project */}
      {showForm ? (
        <ProjectForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
      ) : !editingProject && (
        <button
          className="settings__export-btn"
          onClick={() => { setShowForm(true); setEditingProject(null); }}
          style={{ alignSelf: 'flex-start' }}
        >
          + Add project
        </button>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="project-delete-confirm">
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Delete <strong>{confirmDelete.client_name ? `${confirmDelete.client_name} / ` : ''}{confirmDelete.name}</strong>? Entries will be unlinked.
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="modal__btn modal__btn--cancel" onClick={() => setConfirmDelete(null)} style={{ height: 26, fontSize: 11, padding: '0 10px' }}>No</button>
            <button className="modal__btn modal__btn--delete" onClick={() => handleDelete(confirmDelete.id)} style={{ height: 26, fontSize: 11, padding: '0 10px' }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single project row ──────────────────────────────────────────
function ProjectRow({ project, isEditing, onEdit, onDelete, onSaveEdit, onCancelEdit }) {
  if (isEditing) {
    return (
      <div style={{ padding: '8px 0' }}>
        <ProjectForm initial={project} onSave={onSaveEdit} onCancel={onCancelEdit} />
      </div>
    );
  }

  return (
    <div className="project-list__row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: project.color || '#6366f1', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.name}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button className="project-list__action-btn" onClick={onEdit} title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button className="project-list__action-btn project-list__action-btn--delete" onClick={onDelete} title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Main Settings Modal ─────────────────────────────────────────
export default function SettingsModal({ onClose, onSaved, updateInfo, allProjects, onProjectsChanged }) {
  const [activeTab, setActiveTab] = useState('general');
  const [threshold, setThreshold] = useState(120);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(updateInfo ?? null);

  const api = window.electronAPI;

  useEffect(() => {
    api?.getSettings?.().then(s => {
      setThreshold(s.notificationThresholdMinutes ?? 120);
      setSyncEnabled(s.syncEnabled ?? false);
    }).catch(() => {});
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    const validated = Math.max(1, Math.min(999, Number(threshold) || 120));
    await api?.saveSettings?.({ notificationThresholdMinutes: validated, syncEnabled });
    setSaved(true);
    onSaved?.();
    setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const result = await api?.exportCsv?.();
      setExportResult(result);
    } catch (e) {
      setExportResult({ ok: false, error: e.message });
    } finally {
      setExporting(false);
    }
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await api?.checkForUpdate?.();
      setCheckResult(result);
    } catch (e) {
      setCheckResult({ ok: false, error: e.message });
    } finally {
      setChecking(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'projects', label: 'Projects' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--settings" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal__header">
          <h2 className="modal__title">Settings</h2>
          <button className="modal__close" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="settings__tabs">
          {tabs.map(tab => (
            <button key={tab.id}
              className={`settings__tab ${activeTab === tab.id ? 'settings__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="modal__body settings__body">

          {activeTab === 'general' && (
            <>
              {/* ── Cloud Sync ── */}
              <div className="settings__section">
                <h3 className="settings__section-title">Cloud Sync</h3>
                <p className="settings__hint settings__hint--block">
                  Sync your timers and entries across devices in real time.
                </p>
                <div className="settings__row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: syncEnabled ? 12 : 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                    <input
                      type="checkbox"
                      checked={syncEnabled}
                      onChange={e => setSyncEnabled(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    Enable cloud sync
                  </label>
                </div>
                {syncEnabled && <AuthButton />}
              </div>

              {/* ── Notifications ── */}
              <div className="settings__section">
                <h3 className="settings__section-title">Notifications</h3>
                <label className="modal__label" htmlFor="notif-threshold">
                  Alert after timer runs (minutes)
                </label>
                <div className="settings__row">
                  <input
                    id="notif-threshold"
                    className="modal__input settings__number-input"
                    type="number"
                    min="1"
                    max="999"
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                  />
                  <p className="settings__hint">
                    A desktop notification fires once when the active timer exceeds this duration.
                  </p>
                </div>
              </div>

              {/* ── Data Export ── */}
              <div className="settings__section">
                <h3 className="settings__section-title">Data Export</h3>
                <p className="settings__hint settings__hint--block">
                  Export all time entries to a CSV file you can open in Excel or any spreadsheet app.
                </p>
                <button
                  className="settings__export-btn"
                  onClick={handleExportCsv}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting…' : 'Export CSV…'}
                </button>
                {exportResult && (
                  <p className={`settings__export-result ${exportResult.ok ? 'ok' : 'err'}`}>
                    {exportResult.cancelled
                      ? 'Cancelled.'
                      : exportResult.ok
                        ? `✓ Saved: ${exportResult.path}`
                        : `✗ ${exportResult.error}`}
                  </p>
                )}
              </div>

              {/* ── Updates ── */}
              <div className="settings__section">
                <h3 className="settings__section-title">Updates</h3>
                <div className="settings__update-row">
                  <button
                    className="settings__export-btn"
                    onClick={handleCheckUpdate}
                    disabled={checking}
                  >
                    {checking ? 'Checking…' : 'Check for updates'}
                  </button>
                  {checkResult && (
                    <span className={`settings__update-result ${checkResult.ok && checkResult.hasUpdate ? 'new' : checkResult.ok ? 'ok' : 'err'}`}>
                      {!checkResult.ok
                        ? `✗ ${checkResult.error}`
                        : checkResult.hasUpdate
                          ? <>
                              v{checkResult.latestVersion} available!{' '}
                              <button
                                className="settings__update-link"
                                onClick={() => api?.openExternal?.(checkResult.releaseUrl)}
                              >
                                Download →
                              </button>
                            </>
                          : `✓ You're on the latest version (v${checkResult.currentVersion})`
                      }
                    </span>
                  )}
                </div>
              </div>

              {/* ── Keyboard Shortcuts ── */}
              <div className="settings__section">
                <h3 className="settings__section-title">Keyboard Shortcuts</h3>
                <div className="settings__shortcuts">
                  <div className="settings__shortcut">
                    <span className="settings__shortcut-label">Start / Stop timer</span>
                    <span className="settings__shortcut-keys">
                      <kbd>Ctrl</kbd><span className="settings__key-sep">+</span><kbd>Space</kbd>
                      <span className="settings__shortcut-or">or</span>
                      <kbd>Enter</kbd>
                      <span className="settings__shortcut-note">(in input)</span>
                    </span>
                  </div>
                  <div className="settings__shortcut">
                    <span className="settings__shortcut-label">Close to tray</span>
                    <span className="settings__shortcut-keys">
                      <kbd>Ctrl</kbd><span className="settings__key-sep">+</span><kbd>W</kbd>
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'projects' && (
            <ProjectsTab allProjects={allProjects} onProjectsChanged={onProjectsChanged} />
          )}

        </div>

        {activeTab === 'general' && (
          <div className="modal__footer">
            <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
            <button className="modal__btn modal__btn--save" onClick={handleSave}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
