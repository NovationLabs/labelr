from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import threading

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA_DIR      = Path("/data")
DATA_DIR.mkdir(exist_ok=True)
DATASET_FILE  = DATA_DIR / "dataset.jsonl"
ANNOT_FILE    = DATA_DIR / "labels.jsonl"
PROGRESS_FILE = DATA_DIR / "progress.jsonl"

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "10"))
LABELS     = json.loads(os.getenv("LABELS", '["Question","Complaint","Suggestion","Praise","Bug Report","Feature Request","Urgent","Other"]'))
write_lock = threading.RLock()
# Dataset loaded once into memory at startup
DATASET: list[dict] = []

# ── startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    global DATASET
    if not DATASET_FILE.exists():
        print("[startup] dataset.jsonl not found — please add your dataset file first")
        return
    DATASET = [json.loads(l) for l in DATASET_FILE.read_text().splitlines() if l.strip()]
    print(f"[startup] {len(DATASET)} items loaded into memory")

# ── helpers ───────────────────────────────────────────────────────────────────

def load_annotations() -> dict:
    out = {}
    if not ANNOT_FILE.exists():
        return out
    for line in ANNOT_FILE.read_text().splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        out[e["index"]] = e
    return out

def append_annotation(entry: dict):
    with write_lock:
        with open(ANNOT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def load_progress() -> dict:
    out = {}
    if not PROGRESS_FILE.exists():
        return out
    for line in PROGRESS_FILE.read_text().splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        out[e["labeler"]] = e
    return out

def append_progress(entry: dict):
    with write_lock:
        with open(PROGRESS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def load_all_chunks() -> dict[str, list]:
    """Returns all distinct chunks per labeler (latest state per chunk)."""
    if not PROGRESS_FILE.exists():
        return {}
    latest: dict[tuple, dict] = {}
    for line in PROGRESS_FILE.read_text().splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        key = (e["labeler"], e["start"], e["end"])
        latest[key] = e
    out: dict[str, list] = {}
    for (labeler, _, __), e in latest.items():
        out.setdefault(labeler, []).append(e)
    for chunks in out.values():
        chunks.sort(key=lambda c: c["start"])
    return out

def allocate_chunk(labeler: str, total: int) -> dict | None:
    progress = load_progress()
    next_start = max((v["end"] for v in progress.values()), default=0)
    if next_start >= total:
        return None
    entry = {
        "labeler": labeler,
        "start": next_start,
        "end": min(next_start + CHUNK_SIZE, total),
        "cursor": next_start,
        "allocated_at": datetime.now(timezone.utc).isoformat(),
    }
    append_progress(entry)
    return entry

def get_or_allocate(labeler: str, total: int) -> dict | None:
    progress = load_progress()
    if labeler in progress:
        p = progress[labeler]
        if p["cursor"] >= p["end"]:
            return allocate_chunk(labeler, total)
        return p
    with write_lock:
        progress = load_progress()
        if labeler not in progress:
            return allocate_chunk(labeler, total)
        return progress[labeler]

def update_cursor(labeler: str, cursor: int):
    progress = load_progress()
    if labeler not in progress:
        return
    entry = {**progress[labeler], "cursor": cursor, "updated_at": datetime.now(timezone.utc).isoformat()}
    append_progress(entry)

# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "dataset": len(DATASET)}

@app.get("/labels")
def get_labels():
    return LABELS

class SessionBody(BaseModel):
    labeler: str

@app.post("/session")
def create_session(body: SessionBody):
    total = len(DATASET)
    if total == 0:
        return {"labeler": body.labeler, "chunk": None, "items": [], "total_dataset": 0}

    chunk = get_or_allocate(body.labeler, total)
    if chunk is None:
        return {"labeler": body.labeler, "chunk": None, "items": [], "total_dataset": total, "done": True}

    annotations = load_annotations()
    items = [
        {
            "index": row["index"],
            "text": row["text"],
            "note": row.get("note"),
            "good": row.get("good"),
            "annotation": annotations.get(row["index"]),
        }
        for row in DATASET[chunk["start"]:chunk["end"]]
    ]

    return {
        "labeler": body.labeler,
        "chunk": {"start": chunk["start"], "end": chunk["end"], "cursor": chunk["cursor"]},
        "items": items,
        "total_dataset": total,
        "total_labeled": len(annotations),
    }

class AnnotateBody(BaseModel):
    index: int
    labeler: str
    classes: list

@app.post("/label")
def post_label(body: AnnotateBody):
    if body.index < 0 or body.index >= len(DATASET):
        raise HTTPException(404, "Index out of range")

    row = DATASET[body.index]
    append_annotation({
        **row,
        "labeler": body.labeler,
        "classes": body.classes,
    })

    progress = load_progress()
    if body.labeler in progress:
        chunk = progress[body.labeler]
        new_cursor = max(chunk["cursor"], body.index + 1)
        update_cursor(body.labeler, new_cursor)
        if new_cursor >= chunk["end"]:
            return {"ok": True, "new_chunk": allocate_chunk(body.labeler, len(DATASET))}

    return {"ok": True, "new_chunk": None}

@app.get("/stats")
def get_stats():
    annotations = load_annotations()
    all_chunks = load_all_chunks()
    class_counts: dict[str, int] = {}
    for e in annotations.values():
        for c in e["classes"]:
            class_counts[c] = class_counts.get(c, 0) + 1
    total_by_labeler: dict[str, int] = {}
    for e in annotations.values():
        lb = e.get("labeler", "")
        total_by_labeler[lb] = total_by_labeler.get(lb, 0) + 1

    labelers = {}
    for pseudo, chunks in all_chunks.items():
        total_done = total_by_labeler.get(pseudo, 0)
        chunk_list = []
        for p in chunks:
            chunk_size = p["end"] - p["start"]
            done_chunk = sum(1 for i in range(p["start"], p["end"]) if i in annotations)
            chunk_list.append({
                "start": p["start"], "end": p["end"],
                "done": done_chunk, "chunk_size": chunk_size,
                "pct": round(done_chunk / chunk_size * 100) if chunk_size else 0,
            })
        labelers[pseudo] = {"chunks": chunk_list, "total_done": total_done}
    return {
        "total_dataset": len(DATASET),
        "total_labeled": len(annotations),
        "class_counts": class_counts,
        "labelers": labelers,
    }

@app.get("/export")
def export():
    annotations = load_annotations()
    return [
        {
            **row,
            "labeler": annotations[row["index"]]["labeler"] if row["index"] in annotations else "",
            "classes": ", ".join(annotations[row["index"]]["classes"]) if row["index"] in annotations else "",
        }
        for row in DATASET
    ]
