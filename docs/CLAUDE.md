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
│   ├── vite.config.js      # proxy /api → backend:8000
│   ├── package.json        # lucide-react included
│   └── src/
│       ├── main.jsx        # React entry point
│       ├── App.jsx         # all UI logic (single component file)
│       └── index.css       # vanilla CSS, custom design tokens
├── data/                   # mounted as Docker volume
│   ├── dataset.jsonl       # dataset
│   ├── labels.jsonl        # annotations (append-only)
│   ├── labels.json         # optional: custom label list (overrides defaults)
│   └── progress.jsonl      # per-chunk progress (append-only)
└── docker-compose.yml
```

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

---

## Backend — `backend/main.py`

### Storage
Everything is append-only JSONL on `/data/` (mounted from `./data`).

| File | Content |
|---|---|
| `dataset.jsonl` | source items, indexed 0–N sequentially |
| `labels.jsonl` | one line per annotation (`{index, labeler, classes, text, …}`) |
| `progress.jsonl` | one line per chunk update (`{labeler, start, end, cursor, …}`) |
| `labels.json` | optional custom label list (array of strings) |

**Important**: dataset indices are array positions (0-based). `DATASET[body.index]` — any dataset modification must re-index sequentially.

### Chunk system
- `CHUNK_SIZE = 200` items per chunk
- Each labeler receives a chunk via `get_or_allocate()`, allocated in `progress.jsonl`
- `load_progress()` → returns only the latest chunk per labeler (for allocation)
- `load_all_chunks()` → returns all distinct chunks per labeler (for stats)
- Chunk uniqueness key: `(labeler, start, end)`

### Routes

| Route | Method | Description |
|---|---|---|
| `GET /labels` | — | List of classes (from `labels.json` or defaults) |
| `POST /session` | `{labeler}` | Start/resume a session, returns chunk + items |
| `POST /label` | `{index, labeler, classes}` | Save annotation + advance cursor |
| `GET /stats` | — | Global statistics (KPIs, class distribution, contributors) |
| `GET /export` | — | Full export as JSON |

### `load_annotations()`
Reads `labels.jsonl` and keeps the **last** annotation per index (dict keyed by `index`). All routes use this behavior: an annotation can be overwritten by re-submitting the same index.

### `total_by_labeler`
In `/stats`, total annotations per labeler is computed by iterating `annotations.values()` (all annotations, not just the current chunk).

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
| `DoneScreen` | Shown in main layout when all items are labeled (no early return → FloatingMenu stays accessible) |
| `Icon` | Lucide wrapper (Tag, ChartArea, RefreshCw) |

### Main state (in `App`)
```js
user          // string | null
view          // "label" | "stats"
session       // object returned by POST /session
labels        // list of classes
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
| `Q W E R T Y …` / `A Z E R T Y …` | Select label (QWERTY default, AZERTY available) | If keysEnabled |
| `↵ Enter` | Submit (if ≥1 selected) | If keysEnabled |
| `Esc` | Skip | If keysEnabled |
| `⌫ Backspace` | Undo (go back to previous item) | If keysEnabled |

Key mapping — swap the active line in `App.jsx` to change layout:
```js
const KEYBOARD_KEYS = "qwertyuiopasdfghjklzxcvbnm".split(""); // QWERTY (default)
// const KEYBOARD_KEYS = "azertyuiopqsdfghjklmwxcvbn".split(""); // AZERTY
```

### kbd badges
Displayed only if `keysEnabled === true`. Style `.kbd`: small bordered box, `text-transform: uppercase`, reduced opacity.

---

## Frontend — `frontend/src/index.css`

### Design tokens (CSS variables)
Defined on `:root` — colors, typography, radii. No external UI library.

### Key points
- `html { scrollbar-gutter: stable; }` — prevents FloatingMenu shift when scrollbar appears/disappears (viewport scrollbar belongs to `html`, not `body`)
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

### `dataset.jsonl` / `dataset_mini.jsonl`
One JSON object per line. Required field: `text` (string). The `index` field is the 0-based array position.

Minimal example:
```json
{"index": 0, "text": "Your text item here"}
{"index": 1, "text": "Another text item"}
```

Any additional fields are preserved and included in the export.

**Note**: the backend does `DATASET[body.index]` (array access by position). If you regenerate the dataset, always re-index 0-based sequentially.

### Custom labels (`data/labels.json`)
Create this file to override the default labels. Format: JSON array of strings.
```json
["Label A", "Label B", "Label C", "Other"]
```

### Default labels (when `labels.json` is absent)
Question · Complaint · Suggestion · Praise · Bug Report · Feature Request · Urgent · Other

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
6. **Vite blocked host error**: when exposing the frontend via a custom domain or tunnel, add the domain to `allowedHosts` in `frontend/vite.config.js` — otherwise Vite rejects the request with "host not allowed".
   ```js
   allowedHosts: ['localhost', 'your-domain.com']
   ```
