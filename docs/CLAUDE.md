# Labelr — Context for Claude

## Project overview

Self-hosted text labeling tool. Allows multiple contributors to annotate text items by assigning one or more predefined classes (multi-label classification).

Stack: **FastAPI** (Python) + **React / Vite** (no TypeScript, no UI lib) — everything runs in Docker Compose.

---

## Architecture

```
labelr/
├── backend/
│   ├── Dockerfile          # python:3.11-slim, uvicorn --reload
│   ├── main.py             # FastAPI API (single file)
│   └── requirements.txt
├── frontend/
│   ├── Dockerfile          # node:20-alpine, npm run dev --host (HMR)
│   ├── index.html
│   ├── vite.config.js      # proxy /api → backend:8000, exposes env vars to React
│   ├── package.json        # lucide-react included
│   └── src/
│       ├── main.jsx        # React entry point
│       ├── App.jsx         # all UI logic (single component file)
│       └── index.css       # vanilla CSS, custom design tokens
├── data/                   # mounted as Docker volume
│   ├── dataset.jsonl       # source dataset (user-provided)
│   ├── labels.jsonl        # annotations (append-only)
│   └── progress.jsonl      # per-chunk progress (append-only)
├── .env                    # local config (not committed)
├── .env.example            # template
└── docker-compose.yml
```

---

## Configuration

All runtime config lives in `.env` and is passed via `docker-compose.yml`. **No hardcoded values in source files.**

| Variable | Default | Where used |
|---|---|---|
| `FRONTEND_PORT` | `3000` | docker-compose ports |
| `BACKEND_PORT` | `8000` | docker-compose ports |
| `ALLOWED_HOST` | `your-domain.com` | vite.config.js allowedHosts |
| `KEYBOARD_LAYOUT` | `QWERTY` | vite.config.js → `VITE_KEYBOARD_LAYOUT` → App.jsx |
| `CHUNK_SIZE` | `10` | backend/main.py |
| `SHUFFLE` | `False` | backend/main.py (startup shuffle) + vite.config.js → `VITE_SHUFFLE` → App.jsx (per-submit shuffle) |
| `EXPORT_TOKEN` | _(empty)_ | If set, `GET /export?token=` must match. Empty = no protection. |
| `LABELS` | default set | backend/main.py — JSON array string |

### How env vars reach the frontend

`docker-compose.yml` passes env vars to the frontend container → `vite.config.js` reads them via `process.env.*` and exposes them as `import.meta.env.VITE_*` via the `define` block → `App.jsx` reads `import.meta.env.VITE_*`.

Adding a new frontend env var requires touching all three: `.env`, `docker-compose.yml`, `vite.config.js`, and `App.jsx`.

---

## Running the project

```bash
docker compose up -d
```

- Frontend: http://localhost:3000
- Backend:  http://localhost:8000

**Hot reload**:
- Frontend: Vite HMR via volume mount (`./frontend/src`, `index.html`, `public`, `vite.config.js`)
- Backend: uvicorn `--reload` via volume mount (`./backend:/app`)
- No `docker compose build` needed for code changes
- `docker compose up --build -d` required when changing `Dockerfile`, `requirements.txt`, `package.json`, or env vars consumed at build time

---

## Backend — `backend/main.py`

### Storage
Everything is append-only JSONL on `/data/` (mounted from `./data`).

| File | Content |
|---|---|
| `dataset.jsonl` | source items, indexed 0–N sequentially |
| `labels.jsonl` | one line per annotation (`{index, labeler, classes, text, …}`) |
| `progress.jsonl` | one line per chunk update (`{labeler, start, end, cursor, …}`) |

**Important**: dataset indices are array positions (0-based). `DATASET[body.index]` — any dataset modification must re-index sequentially.

### Labels
Labels are loaded from the `LABELS` env var (JSON array string). They are shuffled at startup if `SHUFFLE=True`. There is no `data/labels.json` — labels are configured entirely via `.env`.

### Shuffle
`SHUFFLE=True` in `.env`:
- Backend: `random.shuffle(LABELS)` at startup → `/labels` returns a different order each time the server starts
- Frontend: after each successful submit, `setLabels(prev => [...prev].sort(() => Math.random() - 0.5))` re-shuffles the displayed buttons

### Chunk system
- `CHUNK_SIZE` items per chunk (set via `.env`)
- Each labeler receives a chunk via `get_or_allocate()`, allocated in `progress.jsonl`
- `load_progress()` → returns only the latest chunk per labeler (for allocation)
- `load_all_chunks()` → returns all distinct chunks per labeler (for stats)
- Chunk uniqueness key: `(labeler, start, end)`

### Routes

| Route | Method | Description |
|---|---|---|
| `GET /` | — | Health check |
| `GET /labels` | — | List of classes (from `LABELS` env var, shuffled if `SHUFFLE=True`) |
| `POST /session` | `{labeler}` | Start/resume a session, returns chunk + items |
| `POST /label` | `{index, labeler, classes}` | Save annotation + advance cursor |
| `GET /stats` | — | Global statistics (KPIs, class distribution, contributors) |
| `GET /export` | `?token=` | Full export as JSON — protected by `EXPORT_TOKEN` if set |

### `load_annotations()`
Reads `labels.jsonl` and keeps the **last** annotation per index (dict keyed by `index`). All routes use this behavior: an annotation can be overwritten by re-submitting the same index.

---

## Frontend — `frontend/src/App.jsx`

### Components

| Component | Role |
|---|---|
| `App` | Global state, view routing, keyboard handler |
| `FloatingMenu` | Fixed top bar: Label / Statistics + shortcuts toggle |
| `LabellerView` | Annotation interface |
| `StatsView` | Statistics dashboard |
| `LoginScreen` | Name input at startup |
| `DoneScreen` | Shown in main layout when all items are labeled |
| `Icon` | Lucide wrapper (Tag, ChartArea, RefreshCw) |

### Main state (in `App`)
```js
user          // string | null
view          // "label" | "stats"
session       // object returned by POST /session
labels        // list of classes (re-shuffled after each submit if SHUFFLE=True)
cursor        // index in items[] of the current chunk
selected      // classes selected for the current item
saving        // bool (lock during POST /label)
todayCount    // local counter (not persisted)
stats         // object returned by GET /stats
keysEnabled   // bool — keyboard shortcuts active
```

### Keyboard shortcuts

| Key | Action | Always active |
|---|---|---|
| `Tab` | Switch Label ↔ Statistics | Yes |
| `Space` | Toggle keysEnabled | Yes |
| `Q W E R T Y …` / `A Z E R T Y …` | Select label | If keysEnabled |
| `↵ Enter` | Submit (if ≥1 selected) | If keysEnabled |
| `Esc` | Skip | If keysEnabled |
| `⌫ Backspace` | Undo (go back to previous item) | If keysEnabled |

Layout is set via `KEYBOARD_LAYOUT` in `.env` (`QWERTY` or `AZERTY`). **Do not hardcode in App.jsx.**

### kbd badges
Displayed only if `keysEnabled === true`. Style `.kbd`: small bordered box, `text-transform: uppercase`, reduced opacity. When `SHUFFLE=True`, keyboard shortcuts shift with the labels after each submit — this is intentional to avoid position/key bias.

---

## Frontend — `frontend/src/index.css`

### Design tokens (CSS variables)
Defined on `:root` — colors, typography, radii. No external UI library.

### Key points
- `html { scrollbar-gutter: stable; }` — prevents FloatingMenu shift when scrollbar appears/disappears
- No `overflow: hidden` on `html`/`body` — native document scroll
- `.page-wrap { min-height: 100vh; }` — allows scroll to work on the stats page

### Key classes
- `.floating-menu` — fixed top bar (position: fixed)
- `.kbd`, `.kbd--light`, `.kbd--space` — shortcut badges
- `.toggle-pill` / `.toggle-knob` — shortcut visual toggle
- `.chunk-list` / `.range` — chunk list in stats table
- `.dist` — 2-column grid for label distribution

---

## Dataset format

### `dataset.jsonl`
One JSON object per line. Required fields: `index` (int, 0-based sequential) and `text` (string).

```json
{"index": 0, "text": "Your text item here"}
{"index": 1, "text": "Another text item"}
```

Any additional fields are preserved and included in the export.

**Note**: the backend does `DATASET[body.index]` (array access by position). If you regenerate the dataset, always re-index 0-based sequentially.

---

## Notable dependencies

| Package | Usage |
|---|---|
| `lucide-react` | Icons (Tag, ChartArea, RefreshCw, Keyboard) |
| `fastapi` + `uvicorn` | Backend API |
| `threading.RLock` | Thread-safe concurrent writes to JSONL files |

---

## Known pitfalls

1. **Dataset re-indexing**: always sequential 0-based, otherwise `/label` returns 404.
2. **Backend keeps dataset in memory**: after modifying `dataset.jsonl`, restart the backend container (`docker compose restart backend`).
3. **progress.jsonl owned by root**: if created by the container, editing from the host requires `sudo`. To reset: `sudo truncate -s 0 data/progress.jsonl`.
4. **Tab disabled with keysEnabled=false**: Tab must be handled **before** the `!keysEnabled` check in the keydown handler.
5. **DoneScreen inside the layout**: do not early-return for the done state, or the FloatingMenu disappears. Insert it as a branch in the main ternary expression.
6. **Vite blocked host error**: when exposing via a custom domain, set `ALLOWED_HOST` in `.env` — it is injected into `vite.config.js allowedHosts` automatically.
7. **Frontend env vars require rebuild**: `VITE_*` vars are baked in at build time. Changing `SHUFFLE`, `KEYBOARD_LAYOUT`, or `ALLOWED_HOST` in `.env` requires `docker compose up --build -d`.
