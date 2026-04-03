// ══════════════════════════════════════════════════════════
// components/AddWorker.jsx  —  Central Team Management
// ══════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection } from "firebase/firestore";

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

const AddWorker = () => {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [workerId, setWorkerId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [workstation, setWorkstation] = useState("Workstation-1");
  
  const [isEditing, setIsEditing] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: "", text: "" });

  // 1. Fetch Workers & Auto-Migrate from LocalStorage if empty
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "worker_profiles"), async (snapshot) => {
      
      // AUTO-MIGRATION LOGIC: If Firestore is empty, sync from localStorage/defaults
      if (snapshot.empty) {
        setStatusMsg({ type: "info", text: "Migrating existing workers to cloud..." });
        
        let initialProfiles = {
          "W001": { name: "Worker 1", email: "worker.one@company.com", workstation: "Workstation-1" },
          "W002": { name: "Worker 2", email: "worker.two@company.com", workstation: "Workstation-1" },
          "W003": { name: "Worker 3", email: "worker.three@company.com", workstation: "Workstation-1" },
          "W004": { name: "Worker 4", email: "worker.four@company.com", workstation: "Workstation-1" },
          "W005": { name: "Worker 5", email: "worker.five@company.com", workstation: "Workstation-1" },
          "W006": { name: "Worker 6", email: "worker.six@company.com", workstation: "Workstation-1" },
        };

        try {
          const localSaved = localStorage.getItem("weffai_worker_profiles");
          if (localSaved) {
            const parsed = JSON.parse(localSaved);
            initialProfiles = { ...initialProfiles, ...parsed }; // Merge local over defaults
          }
        } catch (e) { console.warn("Could not parse local storage profiles"); }

        // Save them all to Firestore instantly
        for (const [id, data] of Object.entries(initialProfiles)) {
          await setDoc(doc(db, "worker_profiles", id), {
             name: data.name || `Worker ${id.replace(/\D/g, '')}`,
             email: data.email || `${id.toLowerCase()}@company.com`,
             workstation: data.workstation || "Workstation-1",
             updatedAt: new Date().toISOString()
          });
        }
        setStatusMsg({ type: "success", text: "Workers successfully migrated!" });
        setTimeout(() => setStatusMsg({ type: "", text: "" }), 3000);
      } 
      // NORMAL RENDER LOGIC
      else {
        const workerList = [];
        snapshot.forEach((doc) => {
          workerList.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort by ID naturally (e.g., W001, W002)
        workerList.sort((a, b) => a.id.localeCompare(b.id));
        setWorkers(workerList);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching workers:", error);
      setStatusMsg({ type: "error", text: "Failed to connect to database." });
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. Handle Form Submit (Add or Update)
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workerId || !name || !email || !workstation) {
      setStatusMsg({ type: "error", text: "All fields are required." });
      setTimeout(() => setStatusMsg({ type: "", text: "" }), 3000);
      return;
    }

    const cleanId = workerId.toUpperCase().trim();

    try {
      await setDoc(doc(db, "worker_profiles", cleanId), {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        workstation: workstation.trim(),
        updatedAt: new Date().toISOString()
      });

      setStatusMsg({ type: "success", text: isEditing ? `Worker ${cleanId} updated!` : `Worker ${cleanId} added successfully!` });
      resetForm();
      setTimeout(() => setStatusMsg({ type: "", text: "" }), 3000);
    } catch (error) {
      console.error("Error saving worker:", error);
      setStatusMsg({ type: "error", text: "Failed to save worker profile." });
    }
  };

  // 3. Handle Edit Button Click
  const handleEdit = (worker) => {
    setWorkerId(worker.id);
    setName(worker.name);
    setEmail(worker.email);
    setWorkstation(worker.workstation || "Workstation-1");
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 4. Handle Delete Worker
  const handleDelete = async (id, workerName) => {
    if (window.confirm(`Are you sure you want to delete ${workerName} (${id})?\n\nThis will not delete their historical analytics, but they will no longer appear in the active team list.`)) {
      try {
        await deleteDoc(doc(db, "worker_profiles", id));
        setStatusMsg({ type: "success", text: `Worker ${id} deleted.` });
        setTimeout(() => setStatusMsg({ type: "", text: "" }), 3000);
        if (isEditing && workerId === id) resetForm();
      } catch (error) {
        console.error("Error deleting worker:", error);
        setStatusMsg({ type: "error", text: "Failed to delete worker." });
      }
    }
  };

  const resetForm = () => {
    setWorkerId("");
    setName("");
    setEmail("");
    setWorkstation("Workstation-1");
    setIsEditing(false);
  };

  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1.5px solid var(--gray-200)", fontSize: "13px", outline: "none", fontFamily: "'Sora', sans-serif" };
  const labelStyle = { display: "block", fontSize: "11px", fontWeight: 700, color: "var(--gray-600)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" };

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
        
        {/* ── Add / Edit Form Panel ── */}
        <div className="panel" style={{ position: "sticky", top: "80px" }}>
          <div className="panel-header">
            <div className="panel-title">
              <div className="panel-icon pi-blue">{isEditing ? "✏️" : "➕"}</div>
              {isEditing ? "Edit Worker Profile" : "Add New Worker"}
            </div>
          </div>
          <div className="panel-body">
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              
              <div>
                <label style={labelStyle}>Worker ID (e.g. W001)</label>
                <input 
                  type="text" 
                  value={workerId} 
                  onChange={(e) => setWorkerId(e.target.value)} 
                  disabled={isEditing}
                  placeholder="W001" 
                  style={{ ...inputStyle, background: isEditing ? "var(--gray-50)" : "white", cursor: isEditing ? "not-allowed" : "text" }} 
                />
                {isEditing && <div style={{ fontSize: 10, color: "var(--gray-400)", marginTop: 4 }}>Worker ID cannot be changed.</div>}
              </div>

              <div>
                <label style={labelStyle}>Full Name</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="Jane Doe" 
                  style={inputStyle} 
                />
              </div>

              <div>
                <label style={labelStyle}>Email Address (For Alerts)</label>
                <input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  placeholder="jane.doe@company.com" 
                  style={inputStyle} 
                />
              </div>

              <div>
                <label style={labelStyle}>Assigned Workstation</label>
                <input 
                  type="text" 
                  value={workstation} 
                  onChange={(e) => setWorkstation(e.target.value)} 
                  placeholder="Workstation-1" 
                  style={inputStyle} 
                />
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button type="submit" style={{ flex: 1, padding: "12px", background: "var(--blue-500)", color: "white", border: "none", borderRadius: "8px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
                  {isEditing ? "Update Worker" : "Add Worker"}
                </button>
                {isEditing && (
                  <button type="button" onClick={resetForm} style={{ padding: "12px 16px", background: "var(--gray-100)", color: "var(--gray-600)", border: "none", borderRadius: "8px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* ── Worker Directory Table ── */}
        <div className="panel">
          <div className="panel-header" style={{ padding: "16px 20px" }}>
            <div className="panel-title">
              <div className="panel-icon pi-teal">👥</div>
              Team Directory
            </div>
            <div style={{ fontSize: 11, color: "var(--gray-500)", fontWeight: 600 }}>
              {workers.length} {workers.length === 1 ? "Worker" : "Workers"} Total
            </div>
          </div>
          
          <div className="panel-body" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--gray-400)", fontSize: 13, fontWeight: 500 }}>
                Loading team data...
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "var(--gray-50)" }}>
                    <th style={{ padding: "12px 20px", fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", borderBottom: "2px solid var(--gray-200)" }}>Worker</th>
                    <th style={{ padding: "12px 20px", fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", borderBottom: "2px solid var(--gray-200)" }}>Workstation</th>
                    <th style={{ padding: "12px 20px", fontSize: "11px", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", borderBottom: "2px solid var(--gray-200)", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: "40px", textAlign: "center", color: "var(--gray-400)", fontSize: 13, fontWeight: 500 }}>
                        No workers found. Add your first worker using the form.
                      </td>
                    </tr>
                  ) : (
                    workers.map((worker) => (
                      <tr key={worker.id} style={{ borderBottom: "1px solid var(--gray-100)", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "16px 20px" }}>
                          <div style={{ fontWeight: 700, color: "var(--blue-900)", fontSize: 14 }}>{worker.name}</div>
                          <div style={{ fontSize: 12, color: "var(--gray-400)", fontWeight: 500, marginTop: 4 }}>ID: {worker.id} • {worker.email}</div>
                        </td>
                        <td style={{ padding: "16px 20px" }}>
                          <div style={{ background: "var(--gray-100)", padding: "4px 8px", borderRadius: "6px", display: "inline-block", fontSize: 11, fontWeight: 600, color: "var(--gray-600)" }}>
                            {worker.workstation || "Workstation-1"}
                          </div>
                        </td>
                        <td style={{ padding: "16px 20px", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button 
                              onClick={() => handleEdit(worker)}
                              style={{ background: "rgba(37,99,235,0.1)", color: "var(--blue-600)", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: "pointer", transition: "background 0.2s" }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(37,99,235,0.2)"}
                              onMouseLeave={e => e.currentTarget.style.background = "rgba(37,99,235,0.1)"}
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => handleDelete(worker.id, worker.name)}
                              style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: "pointer", transition: "background 0.2s" }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.2)"}
                              onMouseLeave={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default AddWorker;