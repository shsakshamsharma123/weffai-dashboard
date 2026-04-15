// ══════════════════════════════════════════════════════════
// components/HomeTab.jsx  —  Live Command Center
// ══════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── EXTERNAL IMPORTS ──────────────────────────────────────
import { db } from "../firebaseSetup"; 
import VideoFeed from "./VideoFeed";
import StatCards from "./StatCards";

// ── CONFIG & UTILITIES ────────────────────────────────────
const DEFAULT_BREAKS = {
  onTime: { single: "09:00" },
  offTime: { single: "18:00" },
  lunchTime: { start: "13:00", end: "14:00" },
  teaTime: { start: "16:00", end: "16:15" },
  miscTime: { start: "11:00", end: "11:15" }
};

const STATE_BADGE = {
  "Working":    { bg:"#dcfce7", color:"#15803d", dot:"#16a34a", label:"WORKING"    },
  "Idle":       { bg:"#fef9c3", color:"#854d0e", dot:"#ca8a04", label:"PASSIVE WORK" },
  "Distracted": { bg:"#fee2e2", color:"#991b1b", dot:"#dc2626", label:"DISTRACTED" },
  "Away":       { bg:"#f3f4f6", color:"#374151", dot:"#6b7280", label:"AWAY"       },
  "Break":      { bg:"#e0e7ff", color:"#1d4ed8", dot:"#3b82f6", label:"ON BREAK"   },
  "On Leave":   { bg:"#f3e8ff", color:"#6b21a8", dot:"#9333ea", label:"ON LEAVE"   }, // ADDED WAIVER STATE
};

function tsMins(ts) {
  if (!ts) return null;
  const parts = ts.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function toMins(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isDuringBreak(ts, breakRanges) {
  const t = tsMins(ts);
  if (t === null) return false;
  return breakRanges.some(([s, e]) => s !== null && e !== null && t >= s && t <= e);
}

// Helper to check if current time is outside the main shift
function isOutsideWorkingHours(ts, onTimeStr, offTimeStr) {
  const t = tsMins(ts);
  const start = toMins(onTimeStr);
  const end = toMins(offTimeStr);
  if (t === null || start === null || end === null) return false;
  return t < start || t >= end;
}

function getBreakRanges(breaks) {
  const ranges = [];
  ["lunchTime", "teaTime", "miscTime"].forEach(k => {
    const s = toMins(breaks[k]?.start);
    const e = toMins(breaks[k]?.end);
    if (s !== null && e !== null) ranges.push([s, e]);
  });
  return ranges;
}

// ── INTERNAL SUB-COMPONENTS ───────────────────────────────

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

const LiveWorkerChart = ({ workers, selectedWorker, onWorkerSelect }) => {
  const [filter, setFilter] = useState("all");
  const displayData = selectedWorker ? [workers.find(w => w.id === selectedWorker.id) || selectedWorker] : workers;

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-icon pi-blue">📊</div> Live Efficiency Meter {selectedWorker && <span style={{ fontSize: 11, color: "var(--blue-500)", fontWeight: 400, marginLeft: 8 }}> — {selectedWorker.name}</span>}
        </div>
        <div className="chart-filters">
          {[{ key: "all", label: "All", cls: "f-all" }, { key: "working", label: "Working", cls: "f-work" }, { key: "idle", label: "Passive Work", cls: "f-idle" }, { key: "distracted", label: "Distracted", cls: "f-dist" }, { key: "away", label: "Away", cls: "f-away" }].map(f => (
            <button key={f.key} className={`filter-btn ${filter === f.key ? f.cls : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 12 }}>
          {selectedWorker ? `Showing ${selectedWorker.name} · click bar again to deselect` : "📡 Live data for active workstation"}
        </div>
        <ResponsiveContainer width="100%" height={265}>
          <BarChart data={displayData} onClick={d => { if (d?.activeLabel) onWorkerSelect(workers.find(w => w.name === d.activeLabel) || null); }} style={{ cursor: "pointer" }} barCategoryGap="35%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} unit="%" domain={[0, 100]} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {(filter === "all" || filter === "working") && <Bar dataKey="working" name="Working" fill="#2563eb" radius={[4,4,0,0]} />}
            {(filter === "all" || filter === "idle") && <Bar dataKey="idle" name="Passive Work" fill="#f59e0b" radius={[4,4,0,0]} />}
            {(filter === "all" || filter === "distracted") && <Bar dataKey="distracted" name="Distracted" fill="#ef4444" radius={[4,4,0,0]} />}
            {(filter === "all" || filter === "away") && <Bar dataKey="away" name="Away" fill="#6b7280" radius={[4,4,0,0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const LiveWorkerDetail = ({ worker, onClose }) => {
  if (!worker) return null;
  return (
    <div className="panel" style={{ marginTop: 20, animation: "fadeUp 0.3s ease" }}>
      <div className="panel-header">
        <div className="panel-title"><div className="panel-icon pi-blue">👤</div>{worker.name} — Detail <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400, marginLeft: 8 }}>(Seat: {worker.id})</span></div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gray-400)", fontSize: 16 }}>✕</button>
      </div>
      <div className="panel-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 12, borderBottom: "1px solid var(--gray-100)" }}>
          <div style={{ fontSize: 13, color: "var(--gray-600)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 16 }}>📧</span> {worker.email}</div>
        </div>
        {[{ label: "Working", val: worker.working, color: "#2563eb" }, { label: "Passive Work", val: worker.idle, color: "#f59e0b" }, { label: "Distracted", val: worker.distracted, color: "#ef4444" }, { label: "Away", val: worker.away, color: "#6b7280" }].map(s => (
          <div key={s.label}>
            <div className="detail-row"><div className="detail-label"><div className="detail-dot" style={{ background: s.color }} />{s.label}</div><div className="detail-val" style={{ color: s.color }}>{s.val}%</div></div>
            <div className="prog-bar"><div className="prog-fill" style={{ width: `${s.val}%`, background: s.color }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── MAIN HOMETAB COMPONENT ────────────────────────────────
const HomeTab = ({ workerProfiles }) => {
  // Load schedule from localStorage to persist across tab switches
  const [breaks, setBreaks] = useState(() => {
    try {
      const savedBreaks = localStorage.getItem("weffai_schedule_breaks");
      return savedBreaks ? JSON.parse(savedBreaks) : DEFAULT_BREAKS;
    } catch (e) {
      return DEFAULT_BREAKS;
    }
  });
  
  const [dataStatus, setDataStatus] = useState("loading");
  const [statusMsg, setStatusMsg] = useState("Connecting to Live AI Stream...");
  const [selectedCam, setSelectedCam] = useState("Workstation-1");
  const [liveStreamUrl, setLiveStreamUrl] = useState("http://localhost:8889/workstation1/");
  const [selectedWorker, setSelectedWorker] = useState(null);

  // Raw live data from Firestore for the selected camera
  const [liveData, setLiveData] = useState({});
  const [lastTimestamp, setLastTimestamp] = useState("");
  const lastActiveStats = useRef({}); // Caches the KPIs right before a break starts

  const breakRanges = useMemo(() => getBreakRanges(breaks), [breaks]);

  // Extract unique workstations from the assigned profiles
  const availableWorkstations = useMemo(() => {
    const wss = Object.values(workerProfiles || {}).map(w => w.workstation || "Workstation-1");
    const unique = new Set(["Workstation-1", "Workstation-2", ...wss]);
    return Array.from(unique).sort();
  }, [workerProfiles]);

  // Fallback to first available workstation if current is deleted/missing
  useEffect(() => {
    if (!availableWorkstations.includes(selectedCam) && availableWorkstations.length > 0) {
      setSelectedCam(availableWorkstations[0]);
    }
  }, [availableWorkstations, selectedCam]);

  // Update Live Stream URL automatically based on selected Workstation (Requires trailing slash!)
  useEffect(() => {
    setLiveStreamUrl(selectedCam === "Workstation-1" ? "http://localhost:8889/workstation1/" : "http://localhost:8889/workstation2/");
  }, [selectedCam]);

  // Listen to Firestore for Live Data on the SELECTED Workstation
  useEffect(() => {
    setDataStatus("loading");
    setLiveData({});
    setStatusMsg(`Connecting to ${selectedCam}...`);

    const unsubscribe = onSnapshot(doc(db, "live_workstations", selectedCam), (docSnap) => {
      if (docSnap.exists()) {
        const fbData = docSnap.data();
        setLiveData(fbData.workers || {});
        setLastTimestamp(fbData.timestamp || new Date().toTimeString().split(' ')[0]);
        setDataStatus("loaded");
      } else {
        setLiveData({});
        setLastTimestamp(new Date().toTimeString().split(' ')[0]);
        setDataStatus("loaded");
      }
    }, (err) => {
      setDataStatus("error");
      setStatusMsg("⚠ Disconnected from Live Stream");
    });

    return () => unsubscribe();
  }, [selectedCam]);

  // MERGE: Profiles mapped to selected workstation + Live Data + Waivers
  const activeWorkersWithProfiles = useMemo(() => {
    const isBreakNow = isDuringBreak(lastTimestamp, breakRanges);
    const isOffHours = isOutsideWorkingHours(lastTimestamp, breaks.onTime?.single, breaks.offTime?.single);
    const isSystemPaused = isBreakNow || isOffHours;
    const nowMs = Date.now(); // Current time for individual waiver checks

    const expectedWorkers = Object.entries(workerProfiles || {})
      .filter(([id, profile]) => (profile.workstation || "Workstation-1") === selectedCam);

    return expectedWorkers.map(([id, profile]) => {
      const wInfoRaw = liveData[id] || {};
      const isOnWaiver = profile.active_waiver_until && profile.active_waiver_until > nowMs;
      
      // ── AUTO-FREEZE LOGIC ── 
      // Deep clone the stats to ensure references don't leak updates
      if (!isSystemPaused && !isOnWaiver && Object.keys(wInfoRaw).length > 0) {
        lastActiveStats.current[id] = { ...wInfoRaw };
      } else if ((isSystemPaused || isOnWaiver) && !lastActiveStats.current[id] && Object.keys(wInfoRaw).length > 0) {
        // Fallback: If page loaded during a break/leave, freeze the first frame of data we get
        lastActiveStats.current[id] = { ...wInfoRaw };
      }

      // Use the completely frozen stats during a pause/leave so KPIs immediately stop updating
      const wInfo = (isSystemPaused || isOnWaiver) && lastActiveStats.current[id] ? lastActiveStats.current[id] : wInfoRaw;
      
      let mappedState = "Away";
      
      // 1. Individual Waiver overrides system schedules
      if (isOnWaiver) {
        mappedState = "On Leave";
      } 
      // 2. System-wide Off Hours
      else if (isOffHours) {
        mappedState = "Away"; // Treat off-hours as everyone being Away
      } 
      // 3. System-wide Break
      else if (isBreakNow) {
        mappedState = "Break";
      } 
      // 4. Normal AI Status
      else if (wInfo.liveRaw) {
        if (wInfo.liveRaw === "WORKING" || wInfo.liveRaw === "THINKING") mappedState = "Working";
        else if (wInfo.liveRaw === "IDLE" || wInfo.liveRaw === "PASSIVE WORKING") mappedState = "Idle";
        else if (wInfo.liveRaw === "DISTRACTED" || wInfo.liveRaw === "PHONE PROXIMITY") mappedState = "Distracted";
      }

      const hasData = Object.keys(wInfo).length > 0;

      return {
        id,
        name: profile.name || `Worker ${id}`,
        email: profile.email || `${id.toLowerCase()}@company.com`,
        liveState: mappedState,
        working: wInfo.working || 0,
        idle: wInfo.idle || 0,
        distracted: wInfo.distracted || 0,
        away: hasData ? (wInfo.away || 0) : ((isSystemPaused || isOnWaiver) ? 0 : 100), 
        totalFrames: wInfo.totalFrames || 0
      };
    }).sort((a, b) => a.id.localeCompare(b.id));

  }, [workerProfiles, selectedCam, liveData, lastTimestamp, breakRanges, breaks]);

  // Update Status Banner Text
  useEffect(() => {
    if (dataStatus === "loaded") {
      const isBreakNow = isDuringBreak(lastTimestamp, breakRanges);
      const isOffHours = isOutsideWorkingHours(lastTimestamp, breaks.onTime?.single, breaks.offTime?.single);

      if (isOffHours) {
        setStatusMsg(`🌙 Live Stream Paused — Outside Working Hours (${lastTimestamp})`);
      } else if (isBreakNow) {
        setStatusMsg(`⏸ Live Stream Paused — Scheduled Break Time (${lastTimestamp})`);
      } else {
        setStatusMsg(`🟢 Live Stream Active — AI Synced @ ${lastTimestamp}`);
      }
    }
  }, [dataStatus, lastTimestamp, breakRanges, breaks]);

  const handleBreakChange = (key, field, val) => {
    setBreaks(prev => {
      const updatedBreaks = { ...prev, [key]: { ...prev[key], [field]: val } };
      // Save to local storage instantly so it survives tab switching
      localStorage.setItem("weffai_schedule_breaks", JSON.stringify(updatedBreaks));
      return updatedBreaks;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", animation: "fadeUp 0.4s ease" }}>
      
      <div className={`load-banner ${dataStatus === "loaded" ? "success" : dataStatus === "error" ? "error" : "info"}`} style={{ marginBottom: 0 }}>
        <span>{dataStatus === "loaded" ? "✅" : dataStatus === "error" ? "⚠️" : "⏳"}</span>
        <span style={{ flex: 1 }}>{statusMsg}</span>
      </div>

      <div className="panel">
        <div className="panel-header" style={{ padding: "10px 18px", borderBottom: "none" }}>
          <div className="panel-title" style={{ fontSize: 12 }}>
            <div className="panel-icon pi-teal" style={{ width: 22, height: 22, fontSize: 16 }}>⏱</div> 
            Today's Schedule Controls
          </div>
        </div>
        <div className="panel-body" style={{ padding: "0 18px 16px", display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center" }}>
          {[
            { key: "onTime", label: "On Time", type: "single", icon: "🟢" },
            { key: "offTime", label: "Off Time", type: "single", icon: "🔴" },
            { key: "lunchTime", label: "Lunch", type: "range", icon: "🍽️" },
            { key: "teaTime", label: "Tea", type: "range", icon: "☕" },
            { key: "miscTime", label: "Misc Break", type: "range", icon: "⏱️" },
          ].map(b => (
            <div key={b.key} style={{ display: "flex", alignItems: "center", gap: "10px", background: "var(--gray-50)", padding: "10px 16px", borderRadius: "10px", border: "1px solid var(--gray-200)", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: 13, fontWeight: 700, color: "var(--gray-600)" }}>
                <span>{b.icon}</span> {b.label}
              </span>
              {b.type === "single" ? (
                <input type="time" style={{ border: "none", background: "transparent", fontSize: 14, fontWeight: 700, color: "var(--blue-900)", outline: "none", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }} value={breaks[b.key].single} onChange={e => handleBreakChange(b.key, "single", e.target.value)} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input type="time" style={{ border: "none", background: "transparent", fontSize: 14, fontWeight: 700, color: "var(--blue-900)", outline: "none", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }} value={breaks[b.key].start} onChange={e => handleBreakChange(b.key, "start", e.target.value)} />
                  <span style={{ fontSize: 13, color: "var(--gray-400)", fontWeight: 700 }}>-</span>
                  <input type="time" style={{ border: "none", background: "transparent", fontSize: 14, fontWeight: 700, color: "var(--blue-900)", outline: "none", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }} value={breaks[b.key].end} onChange={e => handleBreakChange(b.key, "end", e.target.value)} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <StatCards workers={activeWorkersWithProfiles} />

      <div className="dash-grid">
        <div className="dash-left">
          <div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: "350px" }}>
            <div className="panel-header">
              <div className="panel-title"><div className="panel-icon pi-blue">🟢</div> Real-Time Worker States</div>
              <div style={{fontSize: 11, color: "var(--gray-400)", fontFamily: "'JetBrains Mono',monospace"}}>Updating in real-time...</div>
            </div>
            <div className="panel-body" style={{ flex: 1, padding: "20px" }}>
              {activeWorkersWithProfiles.length > 0 ? (
                <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:"14px"}}>
                  {activeWorkersWithProfiles.map(w => {
                    const cfg = STATE_BADGE[w.liveState] || STATE_BADGE["Away"];
                    return (
                      <div key={w.id} style={{ background: cfg.bg, borderRadius: 12, padding: "14px", border: `1px solid ${cfg.dot}33`, transition: "transform 0.1s, box-shadow 0.2s", boxShadow: "0 2px 4px rgba(0,0,0,0.02)", cursor: "pointer" }} onClick={() => setSelectedWorker(selectedWorker?.id === w.id ? null : w)} onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"} onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}>
                        <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8}}>
                          <div style={{fontSize: 13, fontWeight: 700, color: cfg.color, marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1}}>
                            {w.name} <span style={{fontWeight: 400, opacity: 0.7}}>({w.id})</span>
                          </div>
                        </div>
                        <div style={{display: "flex", alignItems: "center", gap: 8}}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: cfg.dot, animation: w.liveState === "Working" ? "statePulse 1.5s infinite" : "none" }}/>
                          <span style={{fontSize: 11, fontWeight: 700, color: cfg.color, letterSpacing: "0.05em"}}>{cfg.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ minHeight: "200px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--gray-400)", fontSize: 14, fontWeight: 500, textAlign: "center" }}>
                  <span style={{ fontSize: 32, marginBottom: 12 }}>🤷‍♂️</span>
                  No workers assigned to {selectedCam}.<br/>
                  <span style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>Add workers via the Team Management tab.</span>
                </div>
              )}
            </div>
          </div>
          
          {activeWorkersWithProfiles.length > 0 && (
            <LiveWorkerChart workers={activeWorkersWithProfiles} selectedWorker={selectedWorker} onWorkerSelect={(w) => setSelectedWorker(selectedWorker?.id === w?.id ? null : w)} />
          )}
          
          {selectedWorker && <LiveWorkerDetail worker={activeWorkersWithProfiles.find(w => w.id === selectedWorker.id) || selectedWorker} onClose={() => setSelectedWorker(null)} />}
        </div>

        <div className="dash-right">
          <div className="panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="panel-header" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10, borderBottom: "1px solid var(--gray-100)" }}>
              <div className="panel-title"><div className="panel-icon pi-teal">📹</div> Office Cameras</div>
              
              <div className="cam-tabs" style={{ display: "flex", overflowX: "auto", width: "100%", gap: 4, paddingBottom: 4 }}>
                {availableWorkstations.map(c => (
                  <button key={c} className={`cam-tab ${selectedCam === c ? "cam-active" : ""}`} onClick={() => { setSelectedCam(c); setSelectedWorker(null); }} style={{ whiteSpace: "nowrap" }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            
            {/* The video container is now strictly locked to 16:9 aspect ratio */}
            <div className="video-wrap" style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#000" }}>
              <VideoFeed videoUrl={liveStreamUrl} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomeTab;