# Labelr

Self-hosted text labeling tool for multi-label classification. Multiple contributors can annotate text items in parallel, each working on their own chunk.

Built with **FastAPI** + **React/Vite**, runs entirely in Docker Compose — no external dependencies.

**Try it live → [labelr.novationlabs.fr](https://labelr.novationlabs.fr)**

> **Don't want to read through the code?** Open this repo in [Claude Code](https://claude.ai/code), ask it to read `README.md` and `docs/CLAUDE.md`, and it will understand the full project instantly — architecture, pitfalls, and all.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/image1.png" alt="Labeling interface" width="100%" />
      <sub><b>Labeling interface</b></sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/image2.png" alt="Statistics dashboard" width="100%" />
      <sub><b>Statistics dashboard</b></sub>
    </td>
  </tr>
</table>

## Features

- **Multi-label** annotation: assign one or more classes per item
- **Chunk-based** work allocation: each contributor gets their own slice of the dataset
- **Keyboard shortcuts** for fast labeling (QWERTY layout, fully navigable without a mouse)
- **Live statistics**: coverage, label distribution, per-contributor progress
- **Append-only storage**: JSONL files, no database required
- **Hot reload** in development: edit code, see changes instantly
- **Export** to JSON with all annotations

## Quick start

```bash
# 1. Clone
git clone https://github.com/NovationLabs/labelr.git
cd labelr

# 2. Configure
cp .env.example .env
# Edit .env to set your domain and ports

# 3. Add your dataset
# Create data/dataset.jsonl — one JSON object per line, must have "index" and "text" fields:
# {"index": 0, "text": "Your first text item"}
# {"index": 1, "text": "Your second text item"}

# 4. (Optional) Add custom labels
# Create data/labels.json — JSON array of strings:
# ["Label A", "Label B", "Label C", "Other"]

# 5. Start
docker compose up -d
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

## Dataset format

Each line in `dataset.jsonl` must be a valid JSON object with at minimum:

```json
{"index": 0, "text": "Text to label"}
```

The `index` field must be a sequential integer starting at 0. All additional fields are preserved in the export.

## Custom labels

Create `data/labels.json` to define your own label set:

```json
["Positive", "Negative", "Neutral", "Off-topic", "Other"]
```

If this file does not exist, the default labels are used: `Question` · `Complaint` · `Suggestion` · `Praise` · `Bug Report` · `Feature Request` · `Urgent` · `Other`.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Switch between Label and Statistics views |
| `Space` | Toggle keyboard shortcuts on/off |
| `Q W E R T Y …` | Select/deselect labels (QWERTY layout, default) |
| `A Z E R T Y …` | Select/deselect labels (AZERTY layout, see below) |
| `Enter` | Submit annotation |
| `Esc` | Skip item |
| `Backspace` | Undo last annotation |

### Switching keyboard layout

The default layout is QWERTY. To switch to AZERTY, edit `frontend/src/App.jsx` and swap the active line:

```js
// QWERTY (default)
const KEYBOARD_KEYS = "qwertyuiopasdfghjklzxcvbnm".split("");

// AZERTY (uncomment to use instead)
// const KEYBOARD_KEYS = "azertyuiopqsdfghjklmwxcvbn".split("");
```

## Data storage

All data is stored as append-only JSONL files in the `data/` directory:

| File | Description |
|------|-------------|
| `dataset.jsonl` | Your source dataset (you provide this) |
| `labels.jsonl` | All annotations (one line per submission) |
| `progress.jsonl` | Per-contributor chunk progress |
| `labels.json` | Optional: custom label list |

The last annotation per item index wins (overwrites are supported by re-submitting).

## Export

Download all annotations as JSON:

```bash
curl http://localhost:8000/export > annotations.json
```

## Architecture

```
labelr/
├── backend/
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── index.css
├── data/
│   ├── dataset.jsonl
│   ├── labels.jsonl
│   └── process.jsonl
└── docker-compose.yml
```

## Hosting behind a custom domain

If you expose the frontend via a reverse proxy or tunnel (e.g. Cloudflare Tunnel, nginx), add your domain to the `allowedHosts` list in `frontend/vite.config.js`:

```js
allowedHosts: [
  'localhost',
  'your-domain.com', // replace with your actual domain
],
```

Without this, Vite will block requests with a "host not allowed" error.

## Development

Hot reload is enabled by default:
- **Frontend**: Vite HMR — edit `frontend/src/`, changes appear instantly
- **Backend**: uvicorn `--reload` — edit `backend/main.py`, reloads automatically
- No `docker compose build` needed for code changes

After modifying the dataset file, restart the backend (it keeps the dataset in memory):

```bash
docker compose restart backend
```
