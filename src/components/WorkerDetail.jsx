// ══════════════════════════════════════════════════════════
// components/WorkerDetail.jsx
// ══════════════════════════════════════════════════════════
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

// ── Local helper function to replace the missing import ──
function buildTimeline(frames) {
  if (!frames || !frames.length) return [];
  const bySecond = {};
  frames.forEach(f => {
    if (!bySecond[f.timestamp])
      // ADDED: Initialize "On Leave" so timeline draws properly
      bySecond[f.timestamp] = { Working: 0, Idle: 0, Distracted: 0, Away: 0, "On Leave": 0 };
    if (bySecond[f.timestamp][f.state] !== undefined) {
      bySecond[f.timestamp][f.state]++;
    }
  });
  return Object.entries(bySecond).slice(0, 120).map(([ts, c]) => ({
    time: ts, ...c
  }));
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="ctt">
      <div className="ctt-label">{label}</div>
      {payload.map((p, i) => (
        <div className="ctt-row" key={i}>
          <span><span className="ctt-dot" style={{ background: p.fill || p.stroke }} />{p.name}</span>
          <strong>{p.value}%</strong>
        </div>
      ))}
    </div>
  );
};

const WorkerDetail = ({ worker, csvData, onClose, onEditProfile }) => {
  if (!worker) return null;

  const timelineData = csvData?.byWorker 
    ? buildTimeline(csvData.byWorker[worker.id] || [])
    : [];

  return (
    <div className="panel" style={{ animation: "fadeUp 0.3s ease" }}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-icon pi-blue">👤</div>
          {worker.name} — Detail
          <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400 }}>
            (Seat: {worker.id})
          </span>
        </div>
        <button onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-400)", fontSize: 16 }}>✕</button>
      </div>
      <div className="panel-body">

        {/* ── CENTRALIZED PROFILE EDITING TRIGGER ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 12, borderBottom: "1px solid var(--gray-100)" }}>
          <div style={{ fontSize: 13, color: "var(--gray-600)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16 }}>📧</span> {worker.email || "No email assigned"}
          </div>
          <button 
            onClick={onEditProfile} 
            style={{ background: "rgba(37,99,235,0.1)", border: "none", cursor: "pointer", color: "var(--blue-500)", fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 16, transition: "background 0.2s" }} 
            onMouseEnter={e => e.currentTarget.style.background = "rgba(37,99,235,0.2)"} 
            onMouseLeave={e => e.currentTarget.style.background = "rgba(37,99,235,0.1)"}
          >
            ✎ Edit Profile
          </button>
        </div>

        {/* ── ADDED: "On Leave" mapping array ── */}
        {[
          { label: "Working",    val: worker.working,      color: "#2563eb" },
          { label: "Idle",       val: worker.idle,         color: "#f59e0b" },
          { label: "Distracted", val: worker.distracted,   color: "#ef4444" },
          { label: "Away",       val: worker.away,         color: "#6b7280" },
          { label: "On Leave",   val: worker.onLeave || 0, color: "#9333ea" }, // Safely fall back to 0 if no leave taken
        ].map(s => (
          <div key={s.label}>
            <div className="detail-row">
              <div className="detail-label">
                <div className="detail-dot" style={{ background: s.color }} />
                {s.label}
              </div>
              <div className="detail-val" style={{ color: s.color }}>{s.val}%</div>
            </div>
            <div className="prog-bar">
              <div className="prog-fill" style={{ width: `${s.val}%`, background: s.color }} />
            </div>
          </div>
        ))}

        {timelineData.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-600)", margin: "6px 0 10px" }}>
              State timeline (frames per second · first 120s)
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 9 }} interval={19} />
                <YAxis tick={{ fontSize: 9 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="Working" stroke="#2563eb" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="Idle" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="Distracted" stroke="#ef4444" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="Away" stroke="#6b7280" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="On Leave" stroke="#9333ea" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
};

export default WorkerDetail;