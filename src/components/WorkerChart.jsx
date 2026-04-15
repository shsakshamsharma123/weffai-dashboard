// ══════════════════════════════════════════════════════════
// components/WorkerChart.jsx — Enhanced Chart + Detail Panel
// ══════════════════════════════════════════════════════════
import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";

// ── Constants ───────────────────────────────────────────────
const STATE_COLORS = {
  Working:    { solid: "#2563eb", light: "#3b82f6", bg: "rgba(37,99,235,0.08)",    label: "Working"    },
  Idle:       { solid: "#d97706", light: "#f59e0b", bg: "rgba(217,119,6,0.08)",    label: "Idle"       },
  Distracted: { solid: "#dc2626", light: "#ef4444", bg: "rgba(220,38,38,0.08)",    label: "Distracted" },
  Away:       { solid: "#475569", light: "#64748b", bg: "rgba(71,85,105,0.08)",    label: "Away"       },
  "On Leave": { solid: "#9333ea", light: "#c084fc", bg: "rgba(147,51,234,0.08)",   label: "On Leave"   }, // Added new state
};

const FILTERS = [
  { key: "all",        label: "All States" },
  { key: "working",    label: "Working"    },
  { key: "idle",       label: "Passive Work"},
  { key: "distracted", label: "Distracted" },
  { key: "away",       label: "Away"       },
  { key: "onLeave",    label: "On Leave"   }, // Added new filter
];

const SORTS = [
  { key: "name",      label: "Name A–Z"     },
  { key: "working",   label: "Working %"    },
  { key: "distracted",label: "Distracted %"  },
];

// ── Helpers ─────────────────────────────────────────────────
const fmtTime = secs =>
  new Date(secs * 1000).toISOString().substr(14, 5);

function buildTimeline(frames) {
  if (!frames?.length) return [];
  const bySecond = {};
  frames.forEach(f => {
    if (!bySecond[f.timestamp])
      bySecond[f.timestamp] = { Working: 0, Idle: 0, Distracted: 0, Away: 0, "On Leave": 0 };
    if (bySecond[f.timestamp][f.state] !== undefined)
      bySecond[f.timestamp][f.state]++;
  });
  return Object.entries(bySecond)
    .slice(0, 120)
    .map(([ts, c]) => ({ time: ts, ...c }));
}

// ── Custom Tooltip ───────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 12,
      padding: "12px 16px",
      boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
      minWidth: 160,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: "#0f172a",
        marginBottom: 10, paddingBottom: 8,
        borderBottom: "1px solid #f1f5f9",
        letterSpacing: "0.02em",
      }}>
        {label}
      </div>
      {payload.map((p, i) => {
        const cfg = STATE_COLORS[p.name] || {};
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 20,
            marginBottom: i < payload.length - 1 ? 7 : 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 9, height: 9, borderRadius: "50%",
                background: cfg.solid || p.fill,
                boxShadow: `0 0 0 2px ${cfg.bg || "transparent"}`,
              }} />
              <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>{p.name}</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: cfg.solid || "#1e293b" }}>
              {p.value}%
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ── Custom Legend ────────────────────────────────────────────
const ChartLegend = ({ filter }) => {
  const visible = filter === "all"
    ? Object.keys(STATE_COLORS)
    : [filter === "onLeave" ? "On Leave" : filter.charAt(0).toUpperCase() + filter.slice(1)];

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      {visible.map(key => {
        const cfg = STATE_COLORS[key];
        if (!cfg) return null;
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 10, height: 10, borderRadius: 3,
              background: `linear-gradient(135deg, ${cfg.light}, ${cfg.solid})`,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>{cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
};

// ── Empty State ──────────────────────────────────────────────
const EmptyState = () => (
  <div style={{
    height: 280, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 12,
    color: "#94a3b8",
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: 16,
      background: "#f1f5f9", display: "flex",
      alignItems: "center", justifyContent: "center", fontSize: 26,
    }}>📭</div>
    <div style={{ fontSize: 14, fontWeight: 700, color: "#64748b" }}>No worker data available</div>
    <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", maxWidth: 240, lineHeight: 1.6 }}>
      Load a CSV or switch to Live Stream to see efficiency data here.
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════
// WORKER DETAIL PANEL
// ══════════════════════════════════════════════════════════
const WorkerDetail = ({ worker, csvData, onClose, onEditProfile }) => {
  if (!worker) return null;

  const timelineData = csvData?.byWorker
    ? buildTimeline(csvData.byWorker[worker.id] || [])
    : [];

  const states = [
    { label: "Working",    val: worker.working,    ...STATE_COLORS.Working    },
    { label: "Idle",       val: worker.idle,       ...STATE_COLORS.Idle       },
    { label: "Distracted", val: worker.distracted, ...STATE_COLORS.Distracted },
    { label: "Away",       val: worker.away,       ...STATE_COLORS.Away       },
    { label: "On Leave",   val: worker.onLeave || 0, ...STATE_COLORS["On Leave"] }, // Added new state to panel
  ];

  // Efficiency score: weighted working bonus, distracted penalty
  const efficiencyScore = Math.max(0, Math.min(100,
    worker.working - (worker.distracted * 0.5) - (worker.idle * 0.2)
  ));
  const scoreColor = efficiencyScore >= 70 ? "#16a34a"
    : efficiencyScore >= 45 ? "#d97706"
    : "#dc2626";
  const scoreLabel = efficiencyScore >= 70 ? "High Performer"
    : efficiencyScore >= 45 ? "Moderate"
    : "Needs Attention";

  return (
    <div className="panel" style={{ animation: "fadeUp 0.3s ease", marginTop: 0 }}>

      {/* ── Header ── */}
      <div className="panel-header" style={{ padding: "14px 20px" }}>
        <div className="panel-title" style={{ gap: 10 }}>
          <div className="panel-icon pi-blue" style={{ fontSize: 15 }}>👤</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: "var(--blue-900)" }}>
              {worker.name}
              <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400, marginLeft: 8 }}>
                Seat: {worker.id}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--gray-500)", fontWeight: 500, marginTop: 1 }}>
              {worker.email || "No email assigned"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={onEditProfile}
            style={{
              background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.15)",
              cursor: "pointer", color: "var(--blue-500)", fontSize: 11,
              fontWeight: 700, padding: "5px 12px", borderRadius: 8,
              transition: "all 0.2s", outline: "none",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(37,99,235,0.15)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(37,99,235,0.08)"}
          >
            ✎ Edit Profile
          </button>
          <button
            onClick={onClose}
            style={{
              background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.06)",
              cursor: "pointer", color: "var(--gray-400)", fontSize: 14,
              width: 30, height: 30, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s", outline: "none", fontWeight: 700,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; e.currentTarget.style.color = "#dc2626"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.04)"; e.currentTarget.style.color = "var(--gray-400)"; }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="panel-body" style={{ padding: "16px 20px 20px" }}>

        {/* ── Efficiency Score Badge ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderRadius: 12,
          background: `${scoreColor}10`,
          border: `1px solid ${scoreColor}25`,
          marginBottom: 20,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: scoreColor, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
              Efficiency Score
            </div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{scoreLabel}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
              {efficiencyScore}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>/ 100</div>
          </div>
        </div>

        {/* ── State Progress Bars ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {states.map(s => (
            <div key={s.label}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 6,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 3,
                    background: `linear-gradient(135deg, ${s.light}, ${s.solid})`,
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{s.label}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: s.solid }}>{s.val}%</span>
              </div>
              {/* Track */}
              <div style={{
                height: 8, borderRadius: 99,
                background: "#f1f5f9", overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${s.val}%`,
                  borderRadius: 99,
                  background: `linear-gradient(90deg, ${s.light}, ${s.solid})`,
                  transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: `0 1px 4px ${s.solid}40`,
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* ── Frame Count ── */}
        {worker.totalFrames > 0 && (
          <div style={{
            marginTop: 16, padding: "8px 12px", borderRadius: 8,
            background: "#f8fafc", border: "1px solid #e2e8f0",
            display: "flex", gap: 20, flexWrap: "wrap",
          }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Frames</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{worker.totalFrames.toLocaleString()}</div>
            </div>
            {(worker.excludedFrames > 0) && (
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Break Excluded</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#d97706" }}>{worker.excludedFrames.toLocaleString()}</div>
              </div>
            )}
          </div>
        )}

        {/* ── Timeline Chart ── */}
        {timelineData.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: "#64748b",
              marginBottom: 12, display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{
                background: "rgba(37,99,235,0.1)", color: "#2563eb",
                padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800,
              }}>TIMELINE</span>
              State distribution · first 120s
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={timelineData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#94a3b8" }} interval={19} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="Working"    stroke="#2563eb" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Idle"       stroke="#d97706" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Distracted" stroke="#dc2626" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Away"       stroke="#475569" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="On Leave"   stroke="#9333ea" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════
// MAIN WORKER CHART COMPONENT
// ══════════════════════════════════════════════════════════
const WorkerChart = ({
  workers,
  csvData,
  csvLoaded,
  videoTime,
  videoDuration,
  isVideoPlaying,
  selectedWorker,
  onWorkerSelect,
  viewMode,
  onEditProfile,
}) => {
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState("name");

  // ── Sort then build chart data, keeping id in payload ──
  const displayData = useMemo(() => {
    const source = selectedWorker
      ? [workers.find(w => w.id === selectedWorker.id) || selectedWorker]
      : [...workers].sort((a, b) => {
          if (sortKey === "name") return a.name.localeCompare(b.name);
          return b[sortKey] - a[sortKey]; // descending for numeric sorts
        });

    return source.map(w => {
      // Always include id so bar click can resolve correctly
      const base = { name: w.name, _id: w.id };
      if (filter === "working")    return { ...base, Working: w.working };
      if (filter === "idle")       return { ...base, Idle: w.idle };
      if (filter === "distracted") return { ...base, Distracted: w.distracted };
      if (filter === "away")       return { ...base, Away: w.away };
      if (filter === "onLeave")    return { ...base, "On Leave": w.onLeave || 0 };
      return { ...base, Working: w.working, Idle: w.idle, Distracted: w.distracted, Away: w.away, "On Leave": w.onLeave || 0 };
    });
  }, [workers, filter, sortKey, selectedWorker]);

  // ── Fix: resolve worker by _id from payload ──
  const handleBarClick = (data) => {
    if (!data?.activePayload?.[0]) return;
    const clickedId = data.activePayload[0].payload._id;
    if (!clickedId) return;
    if (selectedWorker?.id === clickedId) {
      onWorkerSelect(null); // deselect on second click
    } else {
      onWorkerSelect(workers.find(w => w.id === clickedId) || null);
    }
  };

  // ── Status hint line ──
  const hintText = useMemo(() => {
    if (viewMode === "live")    return "📡 Updating in real-time from Live AI Stream";
    if (selectedWorker)         return `Showing ${selectedWorker.name} · click the same bar or ✕ to deselect`;
    if (csvLoaded && isVideoPlaying) return "📊 Chart updating as video plays";
    if (csvLoaded)              return "▶ Play the video to see timeline updates";
    return "Click any bar to drill into a worker's detail";
  }, [viewMode, selectedWorker, csvLoaded, isVideoPlaying]);

  const isEmpty = !workers || workers.length === 0;

  return (
    <>
      <style>{`
        @keyframes barGrow {
          from { transform: scaleY(0); transform-origin: bottom; }
          to   { transform: scaleY(1); transform-origin: bottom; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wc-filter-btn {
          border: none; padding: 5px 13px; border-radius: 7px;
          font-size: 11px; font-weight: 700; cursor: pointer;
          transition: all 0.18s; outline: none; white-space: nowrap;
          background: transparent; color: #64748b;
        }
        .wc-filter-btn:hover { background: rgba(0,0,0,0.04); color: #334155; }
        .wc-filter-btn.active-all        { background: #0f172a; color: #fff; }
        .wc-filter-btn.active-working    { background: #2563eb; color: #fff; }
        .wc-filter-btn.active-idle       { background: #d97706; color: #fff; }
        .wc-filter-btn.active-distracted { background: #dc2626; color: #fff; }
        .wc-filter-btn.active-away       { background: #475569; color: #fff; }
        .wc-filter-btn.active-onLeave    { background: #9333ea; color: #fff; }
        .wc-sort-btn {
          border: 1px solid #e2e8f0; padding: 4px 11px; border-radius: 7px;
          font-size: 11px; font-weight: 700; cursor: pointer;
          transition: all 0.18s; outline: none; white-space: nowrap;
          background: #fff; color: #64748b;
        }
        .wc-sort-btn:hover { border-color: #cbd5e1; color: #334155; }
        .wc-sort-btn.active { background: #f1f5f9; border-color: #cbd5e1; color: #1e293b; }
      `}</style>

      <div className="panel" style={{ animation: "fadeUp 0.35s ease" }}>

        {/* ── Panel Header ── */}
        <div className="panel-header" style={{
          padding: "14px 20px", flexWrap: "wrap", gap: 10,
          borderBottom: "1px solid #f1f5f9",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
            <div className="panel-icon pi-blue" style={{ fontSize: 15 }}>📊</div>
            <span className="panel-title" style={{ margin: 0 }}>
              Worker Efficiency Meter
              {selectedWorker && (
                <span style={{ fontSize: 11, color: "var(--blue-500)", fontWeight: 500, marginLeft: 8 }}>
                  — {selectedWorker.name}
                </span>
              )}
            </span>
            {selectedWorker && (
              <button
                onClick={() => onWorkerSelect(null)}
                title="Deselect worker"
                style={{
                  marginLeft: 4, background: "rgba(220,38,38,0.08)",
                  border: "1px solid rgba(220,38,38,0.15)", color: "#dc2626",
                  borderRadius: 6, width: 22, height: 22, fontSize: 11, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", outline: "none", transition: "all 0.2s",
                  flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(220,38,38,0.15)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(220,38,38,0.08)"}
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div style={{
            display: "flex", background: "#f8fafc",
            border: "1px solid #e2e8f0", padding: 3, borderRadius: 10,
            gap: 2, flexWrap: "wrap",
          }}>
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`wc-filter-btn${filter === f.key ? ` active-${f.key}` : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Panel Body ── */}
        <div className="panel-body" style={{ padding: "16px 20px 20px" }}>

          {/* Video Sync Bar — only in static/historical mode */}
          {csvLoaded && videoDuration > 0 && viewMode !== "live" && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", borderRadius: 10, marginBottom: 16,
              background: "rgba(37,99,235,0.05)",
              border: "1px solid rgba(37,99,235,0.12)",
            }}>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
                color: isVideoPlaying ? "#dc2626" : "#94a3b8",
                display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: isVideoPlaying ? "#dc2626" : "#94a3b8",
                  display: "inline-block",
                  animation: isVideoPlaying ? "statePulse 1.2s infinite" : "none",
                }} />
                {isVideoPlaying ? "PLAYING" : "PAUSED"}
              </span>
              <div style={{
                flex: 1, height: 5, background: "#e2e8f0",
                borderRadius: 99, overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (videoTime / videoDuration) * 100)}%`,
                  background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                  borderRadius: 99,
                  transition: "width 0.4s ease",
                }} />
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, color: "#64748b",
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                whiteSpace: "nowrap",
              }}>
                {fmtTime(videoTime)} / {fmtTime(videoDuration)}
              </span>
            </div>
          )}

          {/* Sort controls + Legend row */}
          {!isEmpty && (
            <div style={{
              display: "flex", alignItems: "center",
              justifyContent: "space-between", marginBottom: 16,
              flexWrap: "wrap", gap: 10,
            }}>
              {/* Legend */}
              <ChartLegend filter={filter} />

              {/* Sort — hidden when a single worker is selected */}
              {!selectedWorker && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#94a3b8",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                  }}>Sort:</span>
                  {SORTS.map(s => (
                    <button
                      key={s.key}
                      onClick={() => setSortKey(s.key)}
                      className={`wc-sort-btn${sortKey === s.key ? " active" : ""}`}
                    >
                      {sortKey === s.key ? "✓ " : ""}{s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Hint text */}
          <div style={{
            fontSize: 11, color: "#94a3b8", fontWeight: 500,
            marginBottom: 14, display: "flex", alignItems: "center", gap: 6,
          }}>
            {hintText}
          </div>

          {/* Chart or Empty State */}
          {isEmpty ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={275}>
              <BarChart
                data={displayData}
                onClick={handleBarClick}
                style={{ cursor: "pointer" }}
                margin={{ top: 8, right: 6, left: -22, bottom: 0 }}
                barCategoryGap="32%"
                barGap={6}
              >
                <defs>
                  <linearGradient id="wc-grad-working" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#3b82f6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.9} />
                  </linearGradient>
                  <linearGradient id="wc-grad-idle" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#fbbf24" stopOpacity={1} />
                    <stop offset="100%" stopColor="#d97706" stopOpacity={0.9} />
                  </linearGradient>
                  <linearGradient id="wc-grad-distracted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#f87171" stopOpacity={1} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0.9} />
                  </linearGradient>
                  <linearGradient id="wc-grad-away" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#94a3b8" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#475569" stopOpacity={0.85} />
                  </linearGradient>
                  <linearGradient id="wc-grad-onleave" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#c084fc" stopOpacity={1} />
                    <stop offset="100%" stopColor="#9333ea" stopOpacity={0.9} />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f1f5f9"
                />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fontWeight: 600, fill: "#64748b" }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  unit="%"
                  domain={[0, 100]}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: "rgba(241,245,249,0.7)", radius: 6 }}
                />

                {(filter === "all" || filter === "working") && (
                  <Bar
                    dataKey="Working"
                    fill="url(#wc-grad-working)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                )}
                {(filter === "all" || filter === "idle") && (
                  <Bar
                    dataKey="Idle"
                    fill="url(#wc-grad-idle)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                )}
                {(filter === "all" || filter === "distracted") && (
                  <Bar
                    dataKey="Distracted"
                    fill="url(#wc-grad-distracted)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                )}
                {(filter === "all" || filter === "away") && (
                  <Bar
                    dataKey="Away"
                    fill="url(#wc-grad-away)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                )}
                {(filter === "all" || filter === "onLeave") && (
                  <Bar
                    dataKey="On Leave"
                    fill="url(#wc-grad-onleave)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Worker Detail Panel (below chart, same column) ── */}
      {selectedWorker && (
        <WorkerDetail
          worker={workers.find(w => w.id === selectedWorker.id) || selectedWorker}
          csvData={csvData}
          onClose={() => onWorkerSelect(null)}
          onEditProfile={onEditProfile}
        />
      )}
    </>
  );
};

export default WorkerChart;