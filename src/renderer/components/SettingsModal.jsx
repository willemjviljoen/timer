import React, { useState, useEffect } from 'react';

export default function SettingsModal({ onClose, onSaved, updateInfo }) {
  const [threshold, setThreshold] = useState(120);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(updateInfo ?? null);

  const api = window.electronAPI;

  useEffect(() => {
    api?.getSettings?.().then(s => {
      setThreshold(s.notificationThresholdMinutes ?? 120);
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
    await api?.saveSettings?.({ notificationThresholdMinutes: validated });
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

        <div className="modal__body settings__body">

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

        </div>

        <div className="modal__footer">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal__btn modal__btn--save" onClick={handleSave}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>

      </div>
    </div>
  );
}
