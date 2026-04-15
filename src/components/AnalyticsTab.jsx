// ══════════════════════════════════════════════════════════
// components/AnalyticsTab.jsx  —  Deep Analytics & Alerts
// ══════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { doc, getDoc } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── FIREBASE SETUP ────────────────────────────────────────
import { db } from "../firebaseSetup";

// ── HELPERS ───────────────────────────────────────────────
const formatWorkerName = (wid) => {
  if (!wid) return "Unknown Worker";
  const numMatch = String(wid).match(/\d+/);
  return numMatch ? `Worker ${numMatch[0]}` : `Worker ${wid}`;
};

const formatFramesWithTime = (frames) => {
  const fps = 1; // Sync with Python AI Engine FPS
  if (!frames || isNaN(frames)) return "0 min";
  const totalSeconds = Math.floor(frames / fps);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const getDatesInRange = (startDate, endDate) => {
  const dates = []; 
  let curr = new Date(startDate); 
  const end = new Date(endDate);
  while (curr <= end) { 
    dates.push(curr.toISOString().split('T')[0]); 
    curr.setDate(curr.getDate() + 1); 
  }
  return dates;
};

// ── SUB-COMPONENTS ────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--blue-900)", borderRadius: "10px", padding: "11px 15px", color: "white", fontSize: "12px", boxShadow: "0 8px 24px rgba(10,22,40,0.3)" }}>
      <div style={{ fontWeight: 700, marginBottom: "6px", color: "var(--blue-300)", fontSize: "11px" }}>{label}</div>
      {payload.map((p, i) => (
        <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", marginTop: "3px" }} key={i}>
          <span style={{ display: "flex", alignItems: "center" }}><span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", marginRight: 6, background: p.fill || p.stroke }} />{p.name}</span>
          <strong>{p.value}%</strong>
        </div>
      ))}
    </div>
  );
};

const WorkerDetailModal = ({ worker, onClose }) => {
  if (!worker) return null;

  const chartData = [
    { name: worker.name, Working: worker.working, Idle: worker.idle, Distracted: worker.distracted, Away: worker.away }
  ];

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(10,22,40,0.6)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 600, boxShadow: "0 20px 40px rgba(0,0,0,0.2)", animation: "fadeUp 0.3s ease", display: "flex", flexDirection: "column", maxHeight: "90vh", overflowY: "auto" }}>
        
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--gray-100)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "white", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--blue-50)", color: "var(--blue-500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, color: "var(--blue-900)" }}>{worker.name}</h3>
              <div style={{ fontSize: 12, color: "var(--gray-500)", fontWeight: 500 }}>{worker.workstation} • Seat: {worker.id} • {worker.email}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "var(--gray-100)", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", color: "var(--gray-600)", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "var(--gray-200)"} onMouseLeave={e => e.currentTarget.style.background = "var(--gray-100)"}>✕</button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Efficiency Score */}
          <div style={{ display: "flex", gap: 20, marginBottom: 24 }}>
            {[
              { label: "Working", val: worker.working, color: "#2563eb", bg: "rgba(37,99,235,0.1)" },
              { label: "Passive Working", val: worker.idle, color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
              { label: "Distracted", val: worker.distracted, color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
              { label: "Away", val: worker.away, color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: s.bg, padding: "16px", borderRadius: 12, textAlign: "center", border: `1px solid ${s.color}33` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.val}%</div>
              </div>
            ))}
          </div>

          <h4 style={{ margin: "0 0 16px 0", fontSize: 14, color: "var(--gray-600)" }}>Visual Distribution</h4>
          <div style={{ height: 200, background: "var(--gray-50)", borderRadius: 12, padding: 16, border: "1px solid var(--gray-200)" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{fill: 'transparent'}} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                <Bar dataKey="Working" stackId="a" fill="#2563eb" radius={[4,0,0,4]} barSize={40} />
                <Bar dataKey="Passive Working" stackId="a" fill="#f59e0b" barSize={40} />
                <Bar dataKey="Distracted" stackId="a" fill="#ef4444" barSize={40} />
                <Bar dataKey="Away" stackId="a" fill="#6b7280" radius={[0,4,4,0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div style={{ marginTop: 24, padding: "16px", background: "var(--blue-50)", borderRadius: "12px", border: "1px solid rgba(37,99,235,0.2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue-600)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Monitored Time</div>
              <div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 4 }}>Scheduled breaks & authorized leaves are excluded.</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--blue-900)" }}>{formatFramesWithTime(worker.totalFrames)}</div>
              <div style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 600 }}>({worker.totalFrames.toLocaleString()} frames)</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ── MAIN COMPONENT ────────────────────────────────────────
const AnalyticsTab = ({ workerProfiles }) => {
  const todayDate = new Date().toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState({ start: todayDate, end: todayDate });
  const [rangeType, setRangeType] = useState("single");
  
  const [allWorkers, setAllWorkers] = useState([]); 
  const [selectedWorkstation, setSelectedWorkstation] = useState("All");
  const [selectedWorkerIds, setSelectedWorkerIds] = useState([]);
  
  const [dataStatus, setDataStatus] = useState("loading");
  const [statusMsg, setStatusMsg] = useState("Fetching historical data...");
  const [selectedWorkerDetail, setSelectedWorkerDetail] = useState(null);
  
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [isWorkerDropdownOpen, setIsWorkerDropdownOpen] = useState(false);
  const [emailStatus, setEmailStatus] = useState("Passive Working");

  // Extract unique workstations dynamically
  const availableWorkstations = useMemo(() => {
    const wss = Object.values(workerProfiles || {}).map(w => w.workstation || "Workstation-1");
    const unique = new Set(["All", ...wss]);
    return Array.from(unique).sort();
  }, [workerProfiles]);

  const handleRangePresetChange = (type) => {
    setRangeType(type);
    const today = new Date();
    let start = new Date();

    if (type === "weekly") start.setDate(today.getDate() - 6);
    else if (type === "biweekly") start.setDate(today.getDate() - 13);
    else if (type === "monthly") start.setDate(today.getDate() - 29);

    if (type !== "custom") {
      setDateRange({ start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] });
    }
  };

  const loadData = useCallback(async () => {
    setDataStatus("loading");
    const dates = getDatesInRange(dateRange.start, dateRange.end);
    setStatusMsg(`Aggregating data for ${dates.length > 1 ? `${dates.length} days` : dates[0]}...`);

    let aggregatedCounts = {};
    let anyDataFound = false;

    for (const date of dates) {
      try {
        const docSnap = await getDoc(doc(db, "daily_stats", date));
        if (docSnap.exists()) {
          anyDataFound = true;
          const dbData = docSnap.data();
          const workersObj = dbData.workers || {};
          
          for (const [wid, stats] of Object.entries(workersObj)) {
            // Apply the central worker profile workstation, fallback to DB historic
            const centralWs = workerProfiles && workerProfiles[wid] ? workerProfiles[wid].workstation : null;
            const finalWs = centralWs || stats.workstation || "Workstation-1";

            if (!aggregatedCounts[wid]) {
              aggregatedCounts[wid] = { Working: 0, Idle: 0, Distracted: 0, Away: 0, totalFrames: 0, workstation: finalWs };
            }
            if (stats.raw_counts) {
              aggregatedCounts[wid].Working += (stats.raw_counts.Working || 0);
              aggregatedCounts[wid].Idle += (stats.raw_counts.Idle || 0);
              aggregatedCounts[wid].Distracted += (stats.raw_counts.Distracted || 0);
              aggregatedCounts[wid].Away += (stats.raw_counts.Away || 0);
              aggregatedCounts[wid].totalFrames += (stats.totalFrames || 0);
            } else {
              const t = stats.totalFrames || 0;
              aggregatedCounts[wid].Working += Math.round(((stats.working || 0) / 100) * t);
              aggregatedCounts[wid].Idle += Math.round(((stats.idle || 0) / 100) * t);
              aggregatedCounts[wid].Distracted += Math.round(((stats.distracted || 0) / 100) * t);
              aggregatedCounts[wid].Away += Math.round(((stats.away || 0) / 100) * t);
              aggregatedCounts[wid].totalFrames += t;
            }
          }
        }
      } catch (err) {
        console.warn(`Could not fetch data for ${date}`, err);
      }
    }

    if (anyDataFound) {
      const mapped = Object.entries(aggregatedCounts).map(([wid, counts]) => {
        const total = counts.totalFrames || 1;
        const profile = workerProfiles ? workerProfiles[wid] : null;
        return {
          id: wid,
          name: profile?.name || formatWorkerName(wid),
          email: profile?.email || `${wid.toLowerCase()}@company.com`,
          workstation: counts.workstation,
          working: Math.round((counts.Working / total) * 100),
          idle: Math.round((counts.Idle / total) * 100),
          distracted: Math.round((counts.Distracted / total) * 100),
          away: Math.round((counts.Away / total) * 100),
          totalFrames: counts.totalFrames
        };
      }).sort((a, b) => a.id.localeCompare(b.id));

      setAllWorkers(mapped);
      
      // Retain selected workers if they still exist in the new dataset
      if (selectedWorkerIds.length > 0 && selectedWorkerIds[0] !== 'NONE') {
         const validIds = mapped.map(w => w.id);
         setSelectedWorkerIds(prev => prev.filter(id => validIds.includes(id)));
      }
      setDataStatus("loaded");
      setStatusMsg(`✓ Historical data loaded for ${mapped.length} workers.`);
    } else {
      setDataStatus("error"); 
      setStatusMsg(`⚠ No data found for the selected date range.`); 
      setAllWorkers([]); 
    }
  }, [dateRange, workerProfiles, selectedWorkerIds]);

  useEffect(() => { loadData(); }, [loadData]);

  // Derived State: Filter by Workstation First
  const filteredByWorkstation = useMemo(() => {
    if (selectedWorkstation === "All") return allWorkers;
    return allWorkers.filter(w => w.workstation === selectedWorkstation);
  }, [allWorkers, selectedWorkstation]);

  // Derived State: Filter by selected Dropdown checkmarks
  const filteredWorkers = useMemo(() => {
    if (selectedWorkerIds.length === 0) return filteredByWorkstation;
    if (selectedWorkerIds.includes('NONE')) return [];
    return filteredByWorkstation.filter(w => selectedWorkerIds.includes(w.id));
  }, [filteredByWorkstation, selectedWorkerIds]);

  // Derived State: Apply Sorting to the final filtered list
  const sortedWorkers = useMemo(() => {
    let sortable = [...filteredWorkers];
    sortable.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];
      if (typeof aVal === 'string') {
         return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sortable;
  }, [filteredWorkers, sortConfig]);

  const requestSort = (key) => {
    let direction = 'desc'; 
    if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    if (key === 'name' && sortConfig.key !== key) direction = 'asc'; 
    setSortConfig({ key, direction });
  };

  const handleSendAlerts = async () => {
    if (filteredWorkers.length === 0) return;
    setEmailStatus("sending");

    const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    try {
      await Promise.all(filteredWorkers.map(async (worker) => {
        const emailPromise = fetch(`${API_BASE}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: worker.email,
            subject: `Efficiency Analytics Alert: ${worker.name}`,
            body: `Hello ${worker.name},\n\nHere is your efficiency report for the selected period:\n\nMonitored Time: ${formatFramesWithTime(worker.totalFrames)}\nWorking: ${worker.working}%\nPassive Working: ${worker.idle}%\nDistracted: ${worker.distracted}%\nAway: ${worker.away}%`
          })
        });

        const whatsappPromise = fetch(`${API_BASE}/api/send-whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: "916239037112", 
            adminName: "Admin",                      
            workerName: worker.name,
            working: worker.working,                    
            idle: worker.idle,                          
            distracted: worker.distracted,              
            away: worker.away,                          
            totalFrames: `${worker.totalFrames} (${formatFramesWithTime(worker.totalFrames)})`, 
            camera: "Analytics Database"                         
          })
        });

        return Promise.all([emailPromise, whatsappPromise]);
      }));

      setEmailStatus("success");
      setTimeout(() => setEmailStatus("Passive Working"), 3000);
    } catch (err) {
      console.error("Transmission Error:", err);
      setEmailStatus("Passive Working");
      alert("Failed to send multi-channel alerts. Check backend console.");
    }
  };

  const thStyle = { padding: "14px 18px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "var(--gray-600)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "2px solid var(--gray-200)", cursor: "pointer", background: "#f8fafc", userSelect: "none" };
  const tdStyle = { padding: "16px 18px", fontSize: "14px", borderBottom: "1px solid var(--gray-100)", color: "var(--gray-700)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      
      {/* ── Status Banner ── */}
      <div className={`load-banner ${dataStatus === "loaded" ? "success" : dataStatus === "error" ? "error" : "info"}`} style={{ marginBottom: 0 }}>
        <span>{dataStatus === "loaded" ? "✅" : dataStatus === "error" ? "⚠️" : "⏳"}</span>
        <span style={{ flex: 1 }}>{statusMsg}</span>
      </div>

      {/* ── Top Filters & Action Bar ── */}
      <div className="panel" style={{ overflow: "visible", position: "relative", zIndex: 20 }}>
        <div className="panel-body" style={{ padding: "16px 20px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "center", justifyContent: "space-between" }}>
          
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center" }}>
            
            {/* Date Range Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date Range</label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <select 
                  style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--gray-200)", background: "var(--gray-50)", fontSize: 13, fontWeight: 600, color: "var(--blue-900)", outline: "none", cursor: "pointer" }}
                  value={rangeType} onChange={(e) => handleRangePresetChange(e.target.value)}
                >
                  <option value="single">Single Date</option>
                  <option value="weekly">Last 7 Days</option>
                  <option value="biweekly">Last 14 Days</option>
                  <option value="monthly">Last 30 Days</option>
                  <option value="custom">Custom Range</option>
                </select>

                {(rangeType === "custom" || rangeType === "single") && (
                  <input type="date" style={{ padding: "7px 12px", borderRadius: "8px", border: "1px solid var(--gray-200)", background: "white", fontSize: 13, fontWeight: 500, outline: "none", cursor: "pointer" }} value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value, end: rangeType === "single" ? e.target.value : dateRange.end })} />
                )}
                
                {rangeType === "custom" && (
                  <>
                    <span style={{ fontSize: 13, color: "var(--gray-400)", fontWeight: 600 }}>to</span>
                    <input type="date" style={{ padding: "7px 12px", borderRadius: "8px", border: "1px solid var(--gray-200)", background: "white", fontSize: 13, fontWeight: 500, outline: "none", cursor: "pointer" }} value={dateRange.end} min={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} />
                  </>
                )}
              </div>
            </div>

            <div style={{ width: "1px", height: "36px", background: "var(--gray-200)", margin: "0 4px" }} />

            {/* Workstation Filter */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Workstation</label>
              <select 
                value={selectedWorkstation} 
                onChange={(e) => { setSelectedWorkstation(e.target.value); setSelectedWorkerIds([]); }}
                style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--gray-200)", fontSize: "13px", fontWeight: 600, color: "var(--blue-900)", background: "var(--gray-50)", outline: "none", cursor: "pointer", minWidth: "160px" }}
              >
                {availableWorkstations.map(ws => <option key={ws} value={ws}>{ws}</option>)}
              </select>
            </div>

            <div style={{ width: "1px", height: "36px", background: "var(--gray-200)", margin: "0 4px" }} />

            {/* Worker Selection Dropdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Specific Workers</label>
              <button 
                onClick={() => setIsWorkerDropdownOpen(!isWorkerDropdownOpen)}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--gray-200)", background: "var(--gray-50)", fontSize: 13, fontWeight: 600, color: "var(--blue-900)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minWidth: "180px", justifyContent: "space-between" }}
              >
                <span>{selectedWorkerIds.length === 0 ? "All in View" : `${selectedWorkerIds.length} Selected`}</span>
                <span style={{ fontSize: 10, color: "var(--gray-400)" }}>{isWorkerDropdownOpen ? "▲" : "▼"}</span>
              </button>

              {isWorkerDropdownOpen && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setIsWorkerDropdownOpen(false)} />
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: "240px", background: "white", border: "1px solid var(--gray-200)", borderRadius: "10px", zIndex: 50, maxHeight: "250px", overflowY: "auto", boxShadow: "0 10px 25px rgba(0,0,0,0.12)", padding: "8px 0", borderTop: "1px solid var(--gray-100)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--gray-100)", fontWeight: 700, color: "var(--blue-900)", background: "var(--gray-50)" }}>
                      <input type="checkbox" style={{ accentColor: "var(--blue-500)", width: 16, height: 16, cursor: "pointer" }} checked={selectedWorkerIds.length === 0} onChange={() => {
                        if (selectedWorkerIds.length === 0) setSelectedWorkerIds(['NONE']);
                        else setSelectedWorkerIds([]);
                      }} />
                      Select All Displayed
                    </label>
                    {filteredByWorkstation.length === 0 && (
                      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--gray-400)", fontStyle: "italic" }}>No workers found for this workstation.</div>
                    )}
                    {filteredByWorkstation.map(w => (
                      <label key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", cursor: "pointer", fontSize: 13, color: "var(--gray-700)", transition: "background 0.2s" }} onClick={e => e.stopPropagation()} onMouseEnter={e => e.currentTarget.style.background = "var(--blue-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <input type="checkbox" style={{ accentColor: "var(--blue-500)", width: 16, height: 16, cursor: "pointer" }} checked={selectedWorkerIds.length === 0 || selectedWorkerIds.includes(w.id)} onChange={(e) => {
                          if (selectedWorkerIds.length === 0) {
                            setSelectedWorkerIds(filteredByWorkstation.map(aw => aw.id).filter(id => id !== w.id));
                          } else {
                            if (e.target.checked) {
                              const next = [...selectedWorkerIds, w.id].filter(id => id !== 'NONE');
                              if (next.length === filteredByWorkstation.length) setSelectedWorkerIds([]);
                              else setSelectedWorkerIds(next);
                            } else {
                              const next = selectedWorkerIds.filter(id => id !== w.id);
                              setSelectedWorkerIds(next.length === 0 ? ['NONE'] : next);
                            }
                          }
                        }} />
                        {w.name}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

          </div>

          {/* Alert Button */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--green-600)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Take Action</span>
            {emailStatus === "success" ? (
              <div style={{ padding: "8px 16px", background: "rgba(16,185,129,0.1)", color: "var(--green-600)", borderRadius: "8px", fontSize: 13, fontWeight: 700, border: "1px solid rgba(16,185,129,0.3)" }}>✓ Alerts Sent Successfully!</div>
            ) : (
              <button 
                onClick={handleSendAlerts}
                disabled={emailStatus === "sending" || filteredWorkers.length === 0}
                style={{ 
                  padding: "8px 20px", 
                  background: filteredWorkers.length > 0 ? "linear-gradient(135deg, #10b981, #059669)" : "var(--gray-200)", 
                  color: filteredWorkers.length > 0 ? "white" : "var(--gray-400)", 
                  border: "none", 
                  borderRadius: "8px", 
                  fontSize: 13, 
                  fontWeight: 700, 
                  cursor: filteredWorkers.length > 0 ? "pointer" : "not-allowed", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: 8,
                  boxShadow: filteredWorkers.length > 0 ? "0 4px 12px rgba(16,185,129,0.2)" : "none",
                  transition: "all 0.2s"
                }}
              >
                <span>✉️</span> {emailStatus === "sending" ? "Processing..." : `Send Alert to Selected (${filteredWorkers.length})`}
              </button>
            )}
          </div>

        </div>
      </div>

      {/* ── Data Table ── */}
      <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div className="panel-header" style={{ padding: "16px 20px" }}>
          <div className="panel-title">
            <div className="panel-icon pi-blue">📋</div>
            Efficiency Analytics Data
            <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400, marginLeft: 8 }}>— Click any row to view charts</span>
          </div>
        </div>
        <div className="panel-body" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: "20%" }} onClick={() => requestSort('name')}>
                  Worker Name <span style={{ opacity: sortConfig.key === 'name' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'name' && sortConfig.direction === 'desc' ? '▼' : '▲'}</span>
                </th>
                <th style={{ ...thStyle, width: "15%" }} onClick={() => requestSort('totalFrames')}>
                  Monitored Time <span style={{ opacity: sortConfig.key === 'totalFrames' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'totalFrames' && sortConfig.direction === 'desc' ? '▼' : '▲'}</span>
                </th>
                <th style={{ ...thStyle, width: "15%" }} onClick={() => requestSort('workstation')}>
                  Workstation <span style={{ opacity: sortConfig.key === 'workstation' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'workstation' && sortConfig.direction === 'desc' ? '▼' : '▲'}</span>
                </th>
                <th style={{ ...thStyle, width: "12%" }} onClick={() => requestSort('working')}>
                  Working <span style={{ opacity: sortConfig.key === 'working' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'working' && sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                </th>
                <th style={{ ...thStyle, width: "12%" }} onClick={() => requestSort('Passive Working')}>
                  Passive Working <span style={{ opacity: sortConfig.key === 'idle' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'idle' && sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                </th>
                <th style={{ ...thStyle, width: "12%" }} onClick={() => requestSort('distracted')}>
                  Distracted <span style={{ opacity: sortConfig.key === 'distracted' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'distracted' && sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                </th>
                <th style={{ ...thStyle, width: "12%" }} onClick={() => requestSort('away')}>
                  Away <span style={{ opacity: sortConfig.key === 'away' ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>{sortConfig.key === 'away' && sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedWorkers.map(w => (
                <tr 
                  key={w.id} 
                  onClick={() => setSelectedWorkerDetail(w)}
                  style={{ transition: "background 0.2s", cursor: "pointer" }} 
                  onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"} 
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ ...tdStyle, fontWeight: 700, color: "var(--blue-900)" }}>
                    {w.name} <div style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 500, marginTop: 2 }}>{w.email}</div>
                  </td>
                  <td style={{ ...tdStyle }}>
                    <div style={{ fontWeight: 700, color: "var(--blue-600)", background: "rgba(37,99,235,0.08)", padding: "4px 8px", borderRadius: "6px", display: "inline-block", fontSize: 12 }}>
                      {formatFramesWithTime(w.totalFrames)}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--gray-600)" }}>
                    <div style={{ background: "var(--gray-100)", padding: "4px 8px", borderRadius: "6px", display: "inline-block", fontSize: 11, fontWeight: 600 }}>{w.workstation}</div>
                  </td>
                  <td style={{ ...tdStyle }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#15803d" }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a" }}/>{w.working}%</div>
                  </td>
                  <td style={{ ...tdStyle }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#b45309" }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#d97706" }}/>{w.idle}%</div>
                  </td>
                  <td style={{ ...tdStyle }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#b91c1c" }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#dc2626" }}/>{w.distracted}%</div>
                  </td>
                  <td style={{ ...tdStyle }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#475569" }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: "#64748b" }}/>{w.away}%</div>
                  </td>
                </tr>
              ))}
              {sortedWorkers.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", fontSize: 14, color: "var(--gray-400)", fontWeight: 500 }}>
                    {selectedWorkstation !== "All" ? `No performance data found for ${selectedWorkstation}.` : "No worker data found for the selected filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Slide-Out Detail Modal ── */}
      {selectedWorkerDetail && (
        <WorkerDetailModal worker={selectedWorkerDetail} onClose={() => setSelectedWorkerDetail(null)} />
      )}

    </div>
  );
};

export default AnalyticsTab;