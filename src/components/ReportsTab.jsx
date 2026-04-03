// ══════════════════════════════════════════════════════════
// components/ReportsTab.jsx  —  High-Level Aggregated Reports
// ══════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// ── FIREBASE SETUP ────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDeT0MJp7Raf0qoJoiS0pKpoi1KM9kM13w",
  authDomain: "weffai-dashboard.firebaseapp.com",
  projectId: "weffai-dashboard",
  storageBucket: "weffai-dashboard.firebasestorage.app",
  messagingSenderId: "257923111216",
  appId: "1:257923111216:web:20ef45984330b1ed4910f5",
  measurementId: "G-BB5XRVGXG3"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── HELPERS ───────────────────────────────────────────────
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

// ── MAIN COMPONENT ────────────────────────────────────────
const ReportsTab = ({ workerProfiles }) => {
  const todayDate = new Date().toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState({ start: todayDate, end: todayDate });
  const [rangeType, setRangeType] = useState("single");
  const [reportData, setReportData] = useState([]);
  const [dataStatus, setDataStatus] = useState("loading");
  const [statusMsg, setStatusMsg] = useState("Preparing summary report...");
  const [selectedWorkstation, setSelectedWorkstation] = useState("All");
  const [emailStatus, setEmailStatus] = useState("idle");

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

  const loadReportData = useCallback(async () => {
    setDataStatus("loading");
    const dates = getDatesInRange(dateRange.start, dateRange.end);
    setStatusMsg(`Aggregating report data for ${dates.length > 1 ? `${dates.length} days` : dates[0]}...`);
    
    let aggregated = {};
    let foundAny = false;

    for (const date of dates) {
      try {
        const snap = await getDoc(doc(db, "daily_stats", date));
        if (snap.exists()) {
          foundAny = true;
          const workers = snap.data().workers || {};
          
          Object.entries(workers).forEach(([wid, stats]) => {
            // Apply the central worker profile workstation, fallback to DB historic
            const centralWs = workerProfiles && workerProfiles[wid] ? workerProfiles[wid].workstation : null;
            const finalWs = centralWs || stats.workstation || "Workstation-1";

            if (!aggregated[wid]) {
              aggregated[wid] = { working: [], idle: [], distracted: [], away: [], workstation: finalWs };
            }
            
            if (stats.raw_counts) {
               const total = stats.totalFrames || 1;
               aggregated[wid].working.push(Math.round(((stats.raw_counts.Working || 0) / total) * 100));
               aggregated[wid].idle.push(Math.round(((stats.raw_counts.Idle || 0) / total) * 100));
               aggregated[wid].distracted.push(Math.round(((stats.raw_counts.Distracted || 0) / total) * 100));
               aggregated[wid].away.push(Math.round(((stats.raw_counts.Away || 0) / total) * 100));
            } else {
               aggregated[wid].working.push(stats.working || 0);
               aggregated[wid].idle.push(stats.idle || 0);
               aggregated[wid].distracted.push(stats.distracted || 0);
               aggregated[wid].away.push(stats.away || 0);
            }
          });
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (foundAny) {
      const summary = Object.entries(aggregated).map(([wid, data]) => {
        const avg = arr => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
        const efficiency = avg(data.working);
        const profile = workerProfiles ? workerProfiles[wid] : null;

        return {
          id: wid,
          name: profile?.name || `Worker ${wid.replace(/\D/g,'')}`,
          workstation: data.workstation,
          avgWorking: efficiency,
          avgIdle: avg(data.idle),
          avgDistracted: avg(data.distracted),
          avgAway: avg(data.away),
          status: efficiency > 75 ? "Excellent" : efficiency > 50 ? "Stable" : "Critical"
        };
      }).sort((a, b) => b.avgWorking - a.avgWorking); // Sorted highest performer to lowest
      
      setReportData(summary);
      setDataStatus("loaded");
      setStatusMsg(`✓ Report generated for ${dates.length} days.`);
    } else {
      setDataStatus("error");
      setStatusMsg("⚠ No data available for this range.");
      setReportData([]);
    }
  }, [dateRange, workerProfiles]);

  useEffect(() => { loadReportData(); }, [loadReportData]);

  // Apply Workstation Filter
  const filteredData = useMemo(() => {
    if (selectedWorkstation === "All") return reportData;
    return reportData.filter(r => r.workstation === selectedWorkstation);
  }, [reportData, selectedWorkstation]);

  const handleSendAdminReport = async () => {
    if (filteredData.length === 0) return;
    setEmailStatus("sending");
    
    const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    const groupedData = {};
    filteredData.forEach(worker => {
      if (!groupedData[worker.workstation]) groupedData[worker.workstation] = [];
      groupedData[worker.workstation].push(worker);
    });
    
    let reportText = `Overall Efficiency Report\nPeriod: ${dateRange.start} to ${dateRange.end}\n\n`;
    
    Object.keys(groupedData).sort().forEach(ws => {
      reportText += `========== ${ws.toUpperCase()} ==========\n`;
      groupedData[ws].forEach((w, index) => {
        reportText += `${index + 1}. ${w.name} (ID: ${w.id})\n   Efficiency: ${w.avgWorking}% | Idle: ${w.avgIdle}% | Distracted: ${w.avgDistracted}% | Away: ${w.avgAway}%\n`;
      });
      reportText += `\n`;
    });
    
    try {
      await fetch(`${API_BASE}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          to: "saksham@datacouch.io", 
          subject: `Efficiency Report: ${dateRange.start} to ${dateRange.end}`, 
          body: reportText 
        })
      });
      setEmailStatus("success");
      setTimeout(() => setEmailStatus("idle"), 3000);
    } catch (err) {
      console.error("Transmission Error:", err);
      setEmailStatus("idle");
      alert("Failed to send admin report.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", animation: "fadeUp 0.4s ease" }}>
      
      {/* ── Report Filter Bar ── */}
      <div className="panel" style={{ overflow: "visible", position: "relative", zIndex: 10 }}>
        <div className="panel-body" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "16px", padding: "16px 20px" }}>
          
          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "center" }}>
            
            {/* Date Range Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Report Period</label>
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
                onChange={(e) => setSelectedWorkstation(e.target.value)} 
                style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--gray-200)", background: "var(--gray-50)", fontSize: "13px", fontWeight: 600, color: "var(--blue-900)", outline: "none", cursor: "pointer", minWidth: "160px" }}
              >
                {availableWorkstations.map(ws => <option key={ws} value={ws}>{ws}</option>)}
              </select>
            </div>
            
          </div>
          
          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <button 
              onClick={() => window.print()} 
              style={{ padding: "8px 16px", background: "white", border: "1px solid var(--gray-200)", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: "var(--gray-700)", transition: "all 0.2s" }} 
              onMouseEnter={e => e.currentTarget.style.background = "var(--gray-50)"} 
              onMouseLeave={e => e.currentTarget.style.background = "white"}
            >
              <span>🖨️</span> Print PDF
            </button>
            
            {emailStatus === "success" ? (
              <div style={{ padding: "8px 16px", background: "rgba(16,185,129,0.1)", color: "var(--green-600)", borderRadius: "8px", fontSize: 13, fontWeight: 700, border: "1px solid rgba(16,185,129,0.3)" }}>✓ Report Sent to Admin!</div>
            ) : (
              <button 
                onClick={handleSendAdminReport} 
                disabled={emailStatus === "sending" || filteredData.length === 0} 
                style={{ padding: "8px 20px", background: filteredData.length > 0 ? "var(--blue-500)" : "var(--gray-200)", color: filteredData.length > 0 ? "white" : "var(--gray-400)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: filteredData.length > 0 ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: "8px", boxShadow: filteredData.length > 0 ? "0 4px 12px rgba(37,99,235,0.2)" : "none", transition: "all 0.2s" }} 
                onMouseEnter={e => { if (filteredData.length > 0) e.currentTarget.style.transform = "translateY(-1px)" }} 
                onMouseLeave={e => e.currentTarget.style.transform = "none"}
              >
                <span>✉️</span> {emailStatus === "sending" ? "Generating..." : "Email Admin Report"}
              </button>
            )}
          </div>
          
        </div>
      </div>

      {/* ── Status Banner ── */}
      <div className={`load-banner ${dataStatus === "loaded" ? "success" : dataStatus === "error" ? "error" : "info"}`} style={{ margin: 0 }}>
        <span>{dataStatus === "loaded" ? "✅" : dataStatus === "error" ? "⚠️" : "⏳"}</span>
        <span style={{ flex: 1 }}>{statusMsg} — <strong style={{color: 'inherit'}}>{filteredData.length} workers shown</strong></span>
      </div>

      {/* ── Summary Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
        {filteredData.map((worker, index) => {
          const isGood = worker.status === "Excellent" || worker.status === "Stable";
          const themeColor = isGood ? "var(--success)" : "var(--danger)";
          const themeBg = isGood ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)";
          
          return (
            <div key={worker.id} className="panel" style={{ borderLeft: `5px solid ${themeColor}`, animationDelay: `${index * 0.05}s` }}>
              <div className="panel-body" style={{ padding: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                       <span style={{ fontSize: 18, filter: index < 3 ? 'none' : 'grayscale(1)' }}>
                         {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "👤"}
                       </span>
                       <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--blue-900)" }}>{worker.name}</div>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--gray-400)", fontWeight: 600, marginTop: 4, marginLeft: 28 }}>
                      {worker.workstation} • ID: {worker.id}
                    </div>
                  </div>
                  <div style={{ height: 'fit-content', padding: "4px 12px", borderRadius: "20px", fontSize: "10px", fontWeight: 800, background: themeBg, color: themeColor, border: `1px solid ${themeColor}44`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {worker.status}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", alignItems: 'flex-end' }}>
                    <span style={{ color: "var(--gray-600)", fontWeight: 600 }}>Avg Efficiency</span>
                    <span style={{ fontWeight: 800, color: themeColor, fontSize: 18 }}>{worker.avgWorking}%</span>
                  </div>
                  <div style={{ height: "8px", background: "var(--gray-100)", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${worker.avgWorking}%`, height: "100%", background: themeColor, transition: 'width 1s ease-out' }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginTop: "10px" }}>
                    <div style={{ textAlign: "center", padding: "10px 4px", background: "var(--gray-50)", borderRadius: "10px", border: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: "9px", color: "var(--gray-400)", fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Idle</div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--warn)" }}>{worker.avgIdle}%</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "10px 4px", background: "var(--gray-50)", borderRadius: "10px", border: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: "9px", color: "var(--gray-400)", fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Distracted</div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--danger)" }}>{worker.avgDistracted}%</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "10px 4px", background: "var(--gray-50)", borderRadius: "10px", border: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: "9px", color: "var(--gray-400)", fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Away</div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--away)" }}>{worker.avgAway}%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        
        {filteredData.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '60px', textAlign: 'center', background: 'white', borderRadius: '16px', border: '2px dashed var(--gray-200)' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
            <div style={{ color: 'var(--gray-400)', fontWeight: 600 }}>No performance data found for these filters.</div>
          </div>
        )}
      </div>

    </div>
  );
};

export default ReportsTab;