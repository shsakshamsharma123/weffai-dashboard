// ══════════════════════════════════════════════════════════
// components/WaiverPanel.jsx  —  Individual Leave/Waiver System
// ══════════════════════════════════════════════════════════
import React, { useState, useMemo, useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";

// ── FIREBASE SETUP ────────────────────────────────────────
import { db } from "../firebaseSetup";

const WaiverPanel = ({ workerProfiles }) => {
  // Form State
  const [selectedWorker, setSelectedWorker] = useState("");
  const [leaveType, setLeaveType] = useState("half_day"); 
  
  // Dynamic Inputs based on Dropdown
  const [halfDayTime, setHalfDayTime] = useState("14:00"); // Default 2 PM
  const [customHours, setCustomHours] = useState(0);
  const [customMins, setCustomMins] = useState(0);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: "", text: "" });
  const [now, setNow] = useState(Date.now());

  // Keep 'now' updated every minute so the "Time Remaining" UI stays accurate
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Convert workerProfiles object to a sorted array
  const workersList = useMemo(() => {
    if (!workerProfiles) return [];
    return Object.entries(workerProfiles)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [workerProfiles]);

  // Filter workers who have an active waiver
  const activeWaivers = useMemo(() => {
    return workersList.filter(w => w.active_waiver_until && w.active_waiver_until > now);
  }, [workersList, now]);

  // 1. Handle Granting a Waiver
  const handleGrantWaiver = async (e) => {
    e.preventDefault();
    if (!selectedWorker) {
      setStatusMsg({ type: "error", text: "Please select a worker." });
      return;
    }

    setIsSubmitting(true);
    setStatusMsg({ type: "info", text: "Applying leave status to database..." });

    try {
      let untilTimestamp = null;
      const currentDate = new Date();

      if (leaveType === "full_day") {
        // Ends at 6:00 PM today by default
        currentDate.setHours(18, 0, 0, 0);
        untilTimestamp = currentDate.getTime();
      } 
      else if (leaveType === "half_day") {
        // Ends at the exact time chosen by Admin
        const [h, m] = halfDayTime.split(':');
        currentDate.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
        untilTimestamp = currentDate.getTime();
      } 
      else if (leaveType === "custom") {
        // Adds X hours and Y mins to the exact current time
        const durationMs = (customHours * 3600000) + (customMins * 60000);
        if (durationMs === 0) {
            setStatusMsg({ type: "error", text: "Custom duration must be greater than 0." });
            setIsSubmitting(false);
            return;
        }
        untilTimestamp = Date.now() + durationMs;
      }

      // Failsafe: check if selected preset time is already in the past
      if (untilTimestamp <= Date.now()) {
        setStatusMsg({ type: "error", text: "The selected leave end time is in the past for today." });
        setIsSubmitting(false);
        return;
      }

      // Update the specific worker's document in Firestore
      await updateDoc(doc(db, "worker_profiles", selectedWorker), {
        active_waiver_until: untilTimestamp
      });

      setStatusMsg({ type: "success", text: "Leave granted! AI engine will mark this worker as ON LEAVE." });

      // Reset Form to defaults
      setSelectedWorker("");
      setCustomHours(0);
      setCustomMins(0);
      setTimeout(() => setStatusMsg({ type: "", text: "" }), 4000);

    } catch (error) {
      console.error("Error granting waiver:", error);
      setStatusMsg({ type: "error", text: "Failed to apply leave. Check database permissions." });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2. Handle Early Revoke
  const handleRevokeLeave = async (workerId, workerName) => {
    if (!window.confirm(`Are you sure you want to end the leave for ${workerName} early? Tracking will resume immediately.`)) return;
    setStatusMsg({ type: "info", text: `Revoking leave for ${workerName}...` });

    try {
      await updateDoc(doc(db, "worker_profiles", workerId), {
        active_waiver_until: null
      });
      setStatusMsg({ type: "success", text: `Leave revoked. Tracking resumed for ${workerName}.` });
      setTimeout(() => setStatusMsg({ type: "", text: "" }), 4000);
    } catch (error) {
      console.error("Error revoking waiver:", error);
      setStatusMsg({ type: "error", text: "Failed to revoke leave." });
    }
  };

  // UI Helpers
  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1.5px solid var(--gray-200)", fontSize: "13px", outline: "none", fontFamily: "'Sora', sans-serif" };
  const labelStyle = { display: "block", fontSize: "11px", fontWeight: 700, color: "var(--gray-600)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" };

  const formatTimeRemaining = (untilMs) => {
    const diffMs = untilMs - now;
    if (diffMs <= 0) return "Expired";
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hrs > 0) return `${hrs}h ${mins}m left`;
    return `${mins}m left`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", animation: "fadeUp 0.4s ease" }}>
      
      {/* ── Status Banner ── */}
      {statusMsg.text && (
        <div className={`load-banner ${statusMsg.type === 'error' ? 'error' : statusMsg.type === 'info' ? 'info' : 'success'}`} style={{ margin: 0 }}>
          <span>{statusMsg.type === "success" ? "✅" : statusMsg.type === "info" ? "🔄" : "⚠️"}</span>
          <span style={{ flex: 1 }}>{statusMsg.text}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 380px) 1fr", gap: "24px", alignItems: "start" }}>
        
        {/* ── Grant Waiver Form Panel ── */}
        <div className="panel" style={{ position: "sticky", top: "80px" }}>
          <div className="panel-header">
            <div className="panel-title">
              <div className="panel-icon pi-teal">⏳</div>
              Assign Leave Status
            </div>
          </div>
          <div className="panel-body">
            <p style={{ fontSize: 12, color: "var(--gray-500)", marginBottom: 20, lineHeight: 1.5 }}>
              Authorize time off. If a worker arrives early, use the <strong>Revoke</strong> button in the roster to immediately resume AI tracking.
            </p>
            
            <form onSubmit={handleGrantWaiver} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              
              <div>
                <label style={labelStyle}>Select Worker</label>
                <select 
                  value={selectedWorker} 
                  onChange={(e) => setSelectedWorker(e.target.value)}
                  style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                >
                  <option value="" disabled>-- Choose a team member --</option>
                  {workersList.map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.id}) - {w.workstation}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Leave Type</label>
                <select 
                  value={leaveType} 
                  onChange={(e) => setLeaveType(e.target.value)}
                  style={{ ...inputStyle, background: "white", cursor: "pointer" }}
                >
                  <option value="half_day">Half Day (Choose exact time)</option>
                  <option value="full_day">Full Day (Ends 6:00 PM today)</option>
                  <option value="custom">Custom Duration</option>
                </select>
              </div>

              {/* Dynamic Inputs based on Leave Type */}
              {leaveType === "half_day" && (
                <div style={{ animation: "fadeUp 0.2s ease" }}>
                  <label style={labelStyle}>Half-Day Ends At</label>
                  <input 
                    type="time" 
                    value={halfDayTime} 
                    onChange={(e) => setHalfDayTime(e.target.value)} 
                    style={inputStyle} 
                  />
                  <div style={{ fontSize: 10, color: "var(--gray-400)", marginTop: 4 }}>Worker will be marked "ON LEAVE" until this exact time.</div>
                </div>
              )}

              {leaveType === "custom" && (
                <div style={{ display: "flex", gap: "12px", animation: "fadeUp 0.2s ease" }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Hours</label>
                    <input 
                      type="number" min="0" max="24"
                      value={customHours} 
                      onChange={(e) => setCustomHours(parseInt(e.target.value) || 0)} 
                      style={inputStyle} 
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Minutes</label>
                    <input 
                      type="number" min="0" max="59"
                      value={customMins} 
                      onChange={(e) => setCustomMins(parseInt(e.target.value) || 0)} 
                      style={inputStyle} 
                    />
                  </div>
                </div>
              )}

              <button 
                type="submit" 
                disabled={isSubmitting}
                style={{ 
                  marginTop: "8px", padding: "12px", 
                  background: isSubmitting ? "var(--gray-400)" : "var(--blue-500)", 
                  color: "white", border: "none", borderRadius: "8px", 
                  fontWeight: 700, cursor: isSubmitting ? "not-allowed" : "pointer", 
                  transition: "all 0.2s" 
                }}
              >
                {isSubmitting ? "Processing..." : "Apply Leave Status"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Active Waivers Directory ── */}
        <div className="panel">
          <div className="panel-header" style={{ padding: "16px 20px" }}>
            <div className="panel-title">
              <div className="panel-icon pi-amber">🛡️</div>
              Active Leave Roster
            </div>
            <div style={{ fontSize: 11, color: "var(--gray-500)", fontWeight: 600 }}>
              {activeWaivers.length} {activeWaivers.length === 1 ? "Active" : "Active"}
            </div>
          </div>
          
          <div className="panel-body" style={{ padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "var(--gray-50)" }}>
                  <th style={{ padding: "12px 20px", fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", borderBottom: "2px solid var(--gray-200)" }}>Worker</th>
                  <th style={{ padding: "12px 20px", fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", borderBottom: "2px solid var(--gray-200)" }}>Valid Until</th>
                  <th style={{ padding: "12px 20px", fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", borderBottom: "2px solid var(--gray-200)", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeWaivers.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: "40px", textAlign: "center", color: "var(--gray-400)", fontSize: 13, fontWeight: 500 }}>
                      <span style={{ fontSize: 24, display: "block", marginBottom: 8 }}>✅</span>
                      No workers are currently on authorized leave.
                    </td>
                  </tr>
                ) : (
                  activeWaivers.map((worker) => (
                    <tr key={worker.id} style={{ borderBottom: "1px solid var(--gray-100)", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ fontWeight: 700, color: "var(--blue-900)", fontSize: 14 }}>{worker.name}</div>
                        <div style={{ fontSize: 12, color: "var(--gray-400)", fontWeight: 500, marginTop: 4 }}>ID: {worker.id} • {worker.workstation}</div>
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ fontWeight: 700, color: "var(--gray-700)", fontSize: 13 }}>
                            {new Date(worker.active_waiver_until).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--amber-600)", background: "rgba(245,158,11,0.1)", padding: "2px 8px", borderRadius: 4, width: "fit-content" }}>
                            {formatTimeRemaining(worker.active_waiver_until)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "16px 20px", textAlign: "right" }}>
                        <button 
                          onClick={() => handleRevokeLeave(worker.id, worker.name)}
                          style={{ 
                            background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "none", 
                            padding: "6px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, 
                            cursor: "pointer", transition: "background 0.2s" 
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.2)"}
                          onMouseLeave={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                        >
                          Revoke Leave
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

export default WaiverPanel;