import { useState, useEffect, useCallback, useMemo } from "react";
import { Tag, ChartArea, RefreshCw, Keyboard } from "lucide-react";

const API = "/api";
const KEYBOARD_KEYS = "qwertyuiopasdfghjklzxcvbnm".split("");
// const KEYBOARD_KEYS = "azertyuiopqsdfghjklmwxcvbn".split("");

export default function App() {
  const [user, setUser]         = useState(null);
  const [view, setView]         = useState("label"); // 'label' | 'stats'
  const [session, setSession]   = useState(null);
  const [labels, setLabels]     = useState([]);
  const [cursor, setCursor]     = useState(0);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving]     = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [stats, setStats]       = useState(null);
  const [keysEnabled, setKeysEnabled] = useState(true);

  const fetchLabels = useCallback(async () => {
    const r = await fetch(`${API}/labels`);
    setLabels(await r.json());
  }, []);

  const fetchStats = useCallback(async () => {
    const r = await fetch(`${API}/stats`);
    setStats(await r.json());
  }, []);

  const startSession = useCallback(async (labeler) => {
    const r = await fetch(`${API}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labeler }),
    });
    const d = await r.json();
    setSession(d);
    const chunkCursor = d.chunk ? Math.max(0, d.chunk.cursor - d.chunk.start) : 0;
    setCursor(chunkCursor);
    setSelected([]);
  }, []);

  const handleLogin = async (pseudo) => {
    setUser(pseudo);
    await fetchLabels();
    await startSession(pseudo);
  };

  const handleLogout = () => {
    setUser(null);
    setSession(null);
    setSelected([]);
    setCursor(0);
    setTodayCount(0);
  };

  const items = session?.items || [];
  const currentItem = items[cursor] ?? null;

  useEffect(() => {
    if (currentItem?.annotation) setSelected(currentItem.annotation.classes);
    else setSelected([]);
  }, [cursor]);

  useEffect(() => {
    if (view === "stats" && user) fetchStats();
  }, [view, user, fetchStats]);

  const toggleLabel = useCallback((label) => {
    setSelected(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  }, []);

  const handleValidate = useCallback(async () => {
    if (!currentItem || selected.length === 0 || saving) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: currentItem.index, labeler: user, classes: selected }),
      });
      const d = await r.json();
      setTodayCount(c => c + 1);
      if (d.new_chunk) {
        await startSession(user);
      } else if (cursor < items.length - 1) {
        setCursor(c => c + 1);
        setSelected([]);
      } else {
        await startSession(user);
      }
    } finally {
      setSaving(false);
    }
  }, [currentItem, selected, saving, cursor, items.length, user, startSession]);

  const handleSkip = useCallback(async () => {
    if (cursor >= items.length - 1 || !currentItem) return;
    try {
      const r = await fetch(`${API}/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: currentItem.index, labeler: user, classes: [] }),
      });
      const d = await r.json();
      if (d.new_chunk) {
        await startSession(user);
      } else {
        setCursor(c => c + 1);
        setSelected([]);
      }
    } catch {
      setCursor(c => c + 1);
      setSelected([]);
    }
  }, [cursor, items.length, currentItem, user, startSession]);

  const handleUndo = useCallback(() => {
    if (cursor > 0) {
      setCursor(c => c - 1);
      setTodayCount(c => Math.max(0, c - 1));
    }
  }, [cursor]);

  useEffect(() => {
    const handler = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Tab") {
        e.preventDefault();
        setView(v => v === "label" ? "stats" : "label");
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setKeysEnabled(v => !v);
        return;
      }
      if (!keysEnabled) return;
      if (view !== "label") return;
      if (e.key === "Backspace") { handleUndo(); return; }
      const idx = KEYBOARD_KEYS.indexOf(e.key.toLowerCase());
      if (idx >= 0 && idx < labels.length) { toggleLabel(labels[idx]); return; }
      if (e.key === "Enter" && selected.length > 0) handleValidate();
      if (e.key === "Escape") handleSkip();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleValidate, handleSkip, handleUndo, toggleLabel, selected, view, labels, keysEnabled]);

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="page-wrap">
      <FloatingMenu view={view} setView={setView} keysEnabled={keysEnabled} onToggleKeys={() => setKeysEnabled(v => !v)} />
      {(!session || session.total_dataset === 0) ? (
        <div className="empty-state">No dataset available.</div>
      ) : session.done && view === "label" ? (
        <DoneScreen onRetry={() => startSession(user)} />
      ) : view === "label" ? (
        <LabellerView
          item={currentItem}
          items={items}
          cursor={cursor}
          labels={labels}
          selected={selected}
          saving={saving}
          session={session}
          keysEnabled={keysEnabled}
          onToggle={toggleLabel}
          onValidate={handleValidate}
          onSkip={handleSkip}
          onUndo={handleUndo}
        />
      ) : (
        <StatsView stats={stats} onRefresh={fetchStats} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   FLOATING MENU
   ───────────────────────────────────────────────────────────── */
function FloatingMenu({ view, setView, keysEnabled, onToggleKeys }) {
  return (
    <div className="floating-menu">
      <button
        className={`fm-item ${view === "label" ? "is-active" : ""}`}
        onClick={() => setView("label")}
      >
        <Icon name="tag" /> Label
      </button>
      <button
        className={`fm-item ${view === "stats" ? "is-active" : ""}`}
        onClick={() => setView("stats")}
      >
        <Icon name="chart" /> Statistics
      </button>
      <div className="fm-sep" />
      <button className="fm-keys-toggle" onClick={onToggleKeys} title={keysEnabled ? "Disable shortcuts" : "Enable shortcuts"}>
        <Keyboard size={13} strokeWidth={1.7} />
        <span className={`toggle-pill ${keysEnabled ? "is-on" : ""}`}>
          <span className="toggle-knob" />
        </span>
        <kbd className="kbd kbd--space">␣</kbd>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   LABELLISER
   ───────────────────────────────────────────────────────────── */
function LabellerView({ item, items, cursor, labels, selected, saving, session, keysEnabled, onToggle, onValidate, onSkip, onUndo }) {
  if (!item) {
    return <div className="empty-state">Chunk complete. Waiting for a new chunk…</div>;
  }

  const good = item.good;
  const signalLabel = good === true ? "Good" : good === false ? "Bad" : null;
  const signalCls   = good === true ? "signal-good" : good === false ? "signal-bad" : "";

  const chunk = session?.chunk;
  const chunkSize = chunk ? (chunk.end - chunk.start) : items.length;
  const chunkDone = cursor;
  const chunkPct  = chunkSize > 0 ? Math.round(chunkDone / chunkSize * 100) : 0;

  return (
    <main className="page-main">
      <div className="chunk-strip">
        <div className="chunk-strip-row">
          <span className="chunk-strip-label">My chunk</span>
          <span className="chunk-strip-num">
            {chunkDone}<span className="of"> / {chunkSize}</span>
            <span className="muted"> · {chunkPct}%</span>
          </span>
        </div>
        <div className="chunk-strip-bar">
          <div className="chunk-strip-fill" style={{ width: `${chunkPct}%` }} />
        </div>
      </div>

      <div className="labeller">
        <div className="vc-meta-row">
          {signalLabel && <span className={`signal ${signalCls}`}>{signalLabel}</span>}
          <span className="vc-index">#{item.index}</span>
          <button className="undo-link" onClick={onUndo} disabled={cursor === 0}>
            {keysEnabled && <kbd className="kbd">⌫</kbd>} Undo
          </button>
        </div>

        <div className="verbatim-card">
          <div className="vc-body">{item.text}</div>
        </div>

        <div className="label-grid">
          {labels.map((l, idx) => (
            <button
              key={l}
              className={`label-btn ${selected.includes(l) ? "is-on" : ""}`}
              onClick={() => onToggle(l)}
              type="button"
            >
              {keysEnabled && idx < KEYBOARD_KEYS.length && <kbd className="kbd">{KEYBOARD_KEYS[idx]}</kbd>}
              {l}
            </button>
          ))}
        </div>

        <div className="actions">
          <button
            className="btn-primary"
            onClick={onValidate}
            disabled={selected.length === 0 || saving}
          >
            {saving ? "…" : `Submit${selected.length > 0 ? ` (${selected.length})` : ""}`}
            {keysEnabled && <kbd className="kbd kbd">↵</kbd>}
          </button>
          <button className="btn-skip" onClick={onSkip} disabled={cursor >= items.length - 1}>
            Skip {keysEnabled && <kbd className="kbd">esc</kbd>}
          </button>
        </div>

        <div className="lbl-foot">
          {session?.total_labeled ?? 0} / {session?.total_dataset ?? 0} total
        </div>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────
   STATISTIQUES
   ───────────────────────────────────────────────────────────── */
function StatsView({ stats, onRefresh }) {
  const total      = stats?.total_dataset ?? 0;
  const labeled    = stats?.total_labeled ?? 0;
  const pct        = total ? (labeled / total * 100) : 0;
  const labelers   = stats?.labelers || {};
  const classCounts = stats?.class_counts || {};

  const distArr = useMemo(() =>
    Object.entries(classCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    [classCounts]
  );

  const totalClassOcc = distArr.reduce((s, c) => s + c.count, 0);
  const max = Math.max(1, ...distArr.map(c => c.count));
  const labelerArr = Object.entries(labelers).map(([name, l]) => ({ name, ...l }));

  return (
    <main className="page-main page-main--wide">
      <header className="page-head">
        <h1 className="page-title">Statistics</h1>
        <div className="page-sub">Dataset progress, contributors, and label distribution.</div>
      </header>

      <div className="stats">
        <div className="kpi-grid">
          <div className="kpi">
            <div className="kpi-label">Dataset</div>
            <div className="kpi-value">{total}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Labeled</div>
            <div className="kpi-value">{labeled}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Coverage</div>
            <div className="kpi-value">{pct.toFixed(1)}<span className="of">%</span></div>
          </div>
        </div>

        <div className="stats-grid">
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">Label distribution</div>
              <span className="panel-sub">{totalClassOcc} occ.</span>
            </div>
            <div className="dist">
              {distArr.length === 0 && (
                <div className="tbl-empty" style={{ gridColumn: "1 / -1" }}>No annotations yet.</div>
              )}
              {distArr.map((c) => {
                const w = (c.count / max) * 100;
                const pctVal = totalClassOcc ? (c.count / totalClassOcc * 100) : 0;
                return (
                  <div className="dist-row" key={c.name}>
                    <div className="dist-name">{c.name}</div>
                    <div className="dist-track">
                      <div className="dist-bar" style={{ width: `${Math.max(w, 1)}%` }} />
                    </div>
                    <div className="dist-meta">
                      <span className="dist-count">{c.count}</span>
                      <span className="dist-pct">{pctVal.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="panel-title">Contributors</div>
              <button className="link-btn" onClick={onRefresh}>
                <Icon name="refresh" /> Refresh
              </button>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Contributor</th>
                  <th>Chunk</th>
                  <th>Progress</th>
                  <th style={{ textAlign: "right" }}>Done</th>
                </tr>
              </thead>
              <tbody>
                {labelerArr.length === 0 && (
                  <tr><td colSpan={4} className="tbl-empty">No contributors yet.</td></tr>
                )}
                {labelerArr.map(({ name, chunks = [], total_done }) => {
                  const lastChunk = chunks[chunks.length - 1] ?? {};
                  return (
                    <tr key={name}>
                      <td><span className="contributor-name">{name}</span></td>
                      <td>
                        <div className="chunk-list">
                          {chunks.map(c => (
                            <span key={c.start} className="range">[{c.start} → {c.end}]</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="tbl-progress">
                          <div className="tbl-progress-track">
                            <div className="tbl-progress-fill" style={{ width: `${lastChunk.pct ?? 0}%` }} />
                          </div>
                          <span className="tbl-progress-pct">{lastChunk.pct ?? 0}%</span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className="num">{total_done}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────
   LOGIN
   ───────────────────────────────────────────────────────────── */
function LoginScreen({ onLogin }) {
  const [pseudo, setPseudo] = useState("");
  return (
    <div className="login">
      <form
        className="login-form"
        onSubmit={e => { e.preventDefault(); if (pseudo.trim()) onLogin(pseudo.trim()); }}
      >
        <h1 className="login-title">Labelr</h1>
        <p className="login-sub">Enter your name to start or resume.</p>
        <input
          className="login-input"
          placeholder="Name"
          value={pseudo}
          onChange={e => setPseudo(e.target.value)}
          autoFocus
        />
        <button className="login-submit" type="submit" disabled={!pseudo.trim()}>
          Start
        </button>
        <p className="login-hint">Your name is used to track your progress and resume where you left off.</p>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   DONE
   ───────────────────────────────────────────────────────────── */
function DoneScreen({ onRetry }) {
  return (
    <div className="login">
      <div className="login-form" style={{ textAlign: "center" }}>
        <h1 className="login-title">All done</h1>
        <p className="login-sub">All items in the dataset have been labeled.</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ICONS
   ───────────────────────────────────────────────────────────── */
function Icon({ name }) {
  const props = { size: 14, strokeWidth: 1.7, className: "ico" };
  switch (name) {
    case "tag":     return <Tag {...props} />;
    case "chart":   return <ChartArea {...props} />;
    case "refresh": return <RefreshCw size={12} strokeWidth={1.7} />;
    default: return null;
  }
}
