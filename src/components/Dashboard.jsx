import React, { useState, useEffect } from "react";
import { doc, setDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseSetup"; 

// Component Imports
import Sidebar from "./Sidebar";
import HomeTab from "./HomeTab";
import AnalyticsTab from "./AnalyticsTab";
import ReportsTab from "./ReportsTab";
import AddWorker from "./AddWorker"; 
import WaiverPanel from "./WaiverPanel"; // Imported the new WaiverPanel

const AddAdminModal = React.memo(({ onSave, onCancel }) => {
  const [email, setEmail] = useState("");

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(10,22,40,0.6)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", padding: 24, borderRadius: 16, width: "100%", maxWidth: 340, boxShadow: "0 20px 40px rgba(0,0,0,0.2)", animation: "fadeUp 0.3s ease" }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, color: "var(--blue-900)", display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 20 }}>🔐</span> Add New Admin</h3>
        <p style={{ fontSize: 12, color: "var(--gray-500)", marginBottom: 16, lineHeight: 1.4 }}>
          Authorize a colleague's email address. They will be able to create an account and access this dashboard.
        </p>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--gray-600)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Admin Email Address</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="newadmin@company.com" style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid var(--gray-200)", fontSize: 13, outline: "none", fontFamily: "'Sora', sans-serif" }} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => onSave(email)} style={{ flex: 1, padding: "10px 0", background: "var(--blue-500)", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "background 0.2s" }}>Authorize Admin</button>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", background: "var(--gray-100)", color: "var(--gray-700)", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "background 0.2s" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
});

const Dashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [now, setNow] = useState("");
  
  // Centralized Worker Profiles State
  const [workerProfiles, setWorkerProfiles] = useState({});

  useEffect(() => {
    const updateTime = () => setNow(new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }));
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Worker Profiles from Firestore in real-time to pass to all tabs
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "worker_profiles"), (snapshot) => {
      const profiles = {};
      snapshot.forEach((doc) => {
        profiles[doc.id] = doc.data();
      });
      setWorkerProfiles(profiles);
    }, (error) => console.error("Error fetching worker profiles for Dashboard:", error));
    
    return () => unsubscribe();
  }, []);

  const handleAddAdmin = async (email) => {
    if (!email || !email.includes("@")) return alert("Please enter a valid email.");
    try {
      await setDoc(doc(db, "allowed_admins", email.toLowerCase().trim()), { 
        addedAt: new Date().toISOString(), 
        addedBy: user?.email || "admin" 
      });
      alert(`✅ ${email} has been authorized. They can now create an account or log in.`);
      setShowAdminModal(false);
    } catch (error) { 
      console.error(error); 
      alert("Failed to authorize admin. Check Firebase permissions."); 
    }
  };

  const getTabTitle = () => {
    switch (activeTab) {
      case "dashboard": return <><span style={{ color: "var(--blue-500)" }}>Live</span> Command Center</>;
      case "analytics": return <>Efficiency <span style={{ color: "var(--blue-500)" }}>Analytics</span></>;
      case "reports":   return <>Aggregated <span style={{ color: "var(--blue-500)" }}>Reports</span></>;
      case "team":      return <>Team <span style={{ color: "var(--blue-500)" }}>Management</span></>;
      case "waivers":   return <>Leave & <span style={{ color: "var(--amber-500)" }}>Waivers</span></>; // Added title for waivers
      default: return <>Dashboard</>;
    }
  };

  return (
    <div className="app-shell">
      {showAdminModal && <AddAdminModal onSave={handleAddAdmin} onCancel={() => setShowAdminModal(false)} />}
      
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        user={user} 
        onLogout={onLogout} 
        onAddAdmin={() => setShowAdminModal(true)} 
        isCollapsed={isSidebarCollapsed} 
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
      />
      
      <div className="main-content" style={{ marginLeft: isSidebarCollapsed ? "80px" : "260px", transition: "margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div className="topbar-title">{getTabTitle()}</div>
          </div>
          <div className="topbar-right">
            <div className="topbar-date">{now}</div>
            <div className="topbar-avatar" title={user?.email || "Admin"}>{user?.email ? user.email.charAt(0).toUpperCase() : "A"}</div>
            <img src="/automat_logo.png" alt="Logo" style={{ height: 30, marginLeft: 8, objectFit: "contain" }} onError={e => e.target.style.display = "none"} />
          </div>
        </div>
        
        <div className="dash-body">
          {/* Component Routing */}
          {activeTab === "dashboard" && <HomeTab workerProfiles={workerProfiles} />}
          {activeTab === "analytics" && <AnalyticsTab workerProfiles={workerProfiles} />}
          {activeTab === "reports" && <ReportsTab workerProfiles={workerProfiles} />}
          {activeTab === "team" && <AddWorker />}
          {activeTab === "waivers" && <WaiverPanel workerProfiles={workerProfiles} />} {/* Added WaiverPanel route */}
        </div>

      </div>
    </div>
  );
};

export default Dashboard;