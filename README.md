# TimeTracker

A minimal, single-bar desktop time tracker. Type what you're working on, hit play, and stop when done — entries are saved to a local SQLite database.

![Electron](https://img.shields.io/badge/Electron-29-blue)
![React](https://img.shields.io/badge/React-18-61DAFB)
![SQLite](https://img.shields.io/badge/SQLite-local-green)

## Features

- **Compact single-bar UI** — sits at the top of your screen or floats as a widget
- **Pin on top** — keep it always visible while you work
- **System tray** — close to tray, runs in background
- **SQLite storage** — all entries persisted locally in `%APPDATA%/timetracker/timetracker.db`
- **Autocomplete** — start typing and see previous activity descriptions to reuse
- **Keyboard-first** — Enter to start/stop, arrow keys to navigate suggestions
- **Timer format** — DD:HH:MM:SS (days appear only when > 0)

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ (LTS recommended)
- npm or yarn
- Windows 10/11 (primary target), macOS/Linux also supported

## Quick Start

```bash
# Clone or copy the project
cd timetracker

# Install dependencies
npm install

# Run in development mode
npm run dev
```

This starts webpack-dev-server on port 9000 and launches Electron pointing at it.

> **Note on npm audit warnings:** Electron projects pull in a large dependency tree (Chromium, Node.js internals) which triggers many npm audit warnings. Most of these are **false positives** — they flag vulnerabilities in server-side code paths that are never exposed in a desktop app. You can safely ignore them during development. If you want a clean audit output, run:
> ```bash
> npm audit --omit=dev
> ```
> This audits only your production dependencies (`better-sqlite3`), which is the only code that actually ships in your final binary.

## Build for Distribution

```bash
# Build the React frontend
npm run build

# Package as Windows installer
npm run dist
```

The installer will be in `release/`.

## Project Structure

```
timetracker/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron main process (tray, DB, IPC)
│   │   └── preload.js       # Secure IPC bridge
│   └── renderer/
│       ├── index.js          # React entry
│       ├── App.jsx           # Root component
│       ├── components/
│       │   ├── TitleBar.jsx  # Custom frameless title bar
│       │   ├── TrackerBar.jsx # Timer + input + button
│       │   └── SavedFlash.jsx # Save confirmation toast
│       └── styles/
│           └── global.css    # All styles
├── public/
│   └── index.html            # HTML template
├── webpack.config.js
└── package.json
```

## Database Schema

```sql
CREATE TABLE time_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT    NOT NULL,
  start_time  TEXT    NOT NULL,        -- ISO 8601
  end_time    TEXT    NOT NULL,        -- ISO 8601
  duration_ms INTEGER NOT NULL,        -- duration in milliseconds
  created_at  TEXT    DEFAULT (datetime('now','localtime'))
);
```

## Keyboard Shortcuts

| Key     | Action                                |
|---------|---------------------------------------|
| Enter   | Start or stop the timer               |
| ↑ / ↓  | Navigate autocomplete suggestions     |
| Escape  | Close autocomplete dropdown           |

## Roadmap

- [ ] History panel (slide-down to view past entries)
- [ ] CSV / JSON export
- [ ] Daily / weekly summaries
- [ ] Cross-platform builds (macOS, Linux)
- [ ] Cloud sync option
