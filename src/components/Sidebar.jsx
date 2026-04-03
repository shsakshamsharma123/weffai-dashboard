// ══════════════════════════════════════════════════════════
// components/Sidebar.jsx — Navigation & Layout Control
// ══════════════════════════════════════════════════════════
import React from "react";

const NAV_ITEMS = [
  { 
    id: "dashboard", 
    label: "Dashboard", 
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    )
  },
  { 
    id: "analytics", 
    label: "Analytics", 
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2"/>
        <path d="M7 16V8"/>
        <path d="M12 16v-4"/>
        <path d="M17 16v-2"/>
      </svg>
    )
  },
  { 
    id: "reports", 
    label: "Reports", 
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" x2="8" y1="13" y2="13"/>
        <line x1="16" x2="8" y1="17" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    )
  },
  { 
    id: "team", 
    label: "Team Management", 
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    )
  }
];

const Sidebar = ({ 
  activeTab, 
  onTabChange, 
  user, 
  onLogout, 
  onAddAdmin,
  isCollapsed,
  onToggleCollapse
}) => {

  return (
    <aside 
      className="sidebar"
      style={{
        width: isCollapsed ? "80px" : "260px",
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--blue-900)",
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100
      }}
    >
      {/* ── Header & Collapse Toggle ── */}
      <div style={{ 
        padding: isCollapsed ? "24px 0" : "24px 20px", 
        borderBottom: "1px solid rgba(255,255,255,0.07)", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: isCollapsed ? "center" : "space-between",
        minHeight: "85px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className="sidebar-logo-icon" style={{ flexShrink: 0 }}>W</div>
          
          <div style={{ 
            opacity: isCollapsed ? 0 : 1, 
            width: isCollapsed ? 0 : "auto",
            transition: "opacity 0.2s, width 0.2s",
            whiteSpace: "nowrap"
          }}>
            <div className="sidebar-title">WeffAI</div>
            <div className="sidebar-subtitle">Admin Dashboard</div>
          </div>
        </div>
      </div>

      {/* Collapse Toggle Button (Below Header) */}
      <button 
        onClick={onToggleCollapse}
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "none",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          color: "var(--gray-400)",
          padding: "10px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          transition: "background 0.2s, color 0.2s",
          outline: "none"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.color = "var(--gray-400)";
        }}
        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      >
        <svg 
          width="18" height="18" viewBox="0 0 24 24" fill="none" 
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ 
            transform: isCollapsed ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s ease"
          }}
        >
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>

      {/* ── Main Navigation Tabs ── */}
      <div style={{ flex: 1, padding: "20px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={isCollapsed ? item.label : ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                padding: isCollapsed ? "12px" : "12px 16px",
                background: isActive ? "rgba(37,99,235,0.15)" : "transparent",
                border: "1px solid",
                borderColor: isActive ? "rgba(37,99,235,0.3)" : "transparent",
                color: isActive ? "var(--blue-400)" : "rgba(255,255,255,0.6)",
                borderRadius: "10px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                justifyContent: isCollapsed ? "center" : "flex-start",
                outline: "none"
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.9)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "rgba(255,255,255,0.6)";
                }
              }}
            >
              <div style={{ flexShrink: 0 }}>
                {item.icon}
              </div>
              <span style={{ 
                fontSize: "13px", 
                fontWeight: isActive ? 600 : 500,
                opacity: isCollapsed ? 0 : 1,
                width: isCollapsed ? 0 : "auto",
                overflow: "hidden",
                transition: "opacity 0.2s",
                whiteSpace: "nowrap"
              }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Account & Actions Footer ── */}
      <div style={{ padding: isCollapsed ? "16px 8px" : "16px 20px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        
        {/* Authorize Admin Button */}
        <button 
          onClick={onAddAdmin} 
          title={isCollapsed ? "Add Admin" : ""}
          style={{ 
            background: "rgba(255,255,255,0.05)", 
            border: "none", 
            color: "rgba(255,255,255,0.8)", 
            padding: isCollapsed ? "10px" : "10px 12px", 
            borderRadius: "8px", 
            cursor: "pointer", 
            width: "100%", 
            display: "flex", 
            gap: "10px", 
            alignItems: "center",
            justifyContent: isCollapsed ? "center" : "flex-start",
            transition: "all 0.2s",
            marginBottom: "16px",
            outline: "none"
          }} 
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "#fff";
          }} 
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            e.currentTarget.style.color = "rgba(255,255,255,0.8)";
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
          <span style={{ 
            fontSize: "12px",
            fontWeight: 500,
            opacity: isCollapsed ? 0 : 1,
            width: isCollapsed ? 0 : "auto",
            overflow: "hidden",
            transition: "opacity 0.2s",
            whiteSpace: "nowrap"
          }}>
            Add Admin
          </span>
        </button>

        {/* User Email (Hidden when collapsed) */}
        {!isCollapsed && (
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginBottom: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {user?.email || "admin@company.com"}
          </div>
        )}

        {/* Logout Button */}
        <button 
          className="btn-logout" 
          onClick={onLogout}
          title={isCollapsed ? "Sign Out" : ""}
          style={{
            padding: isCollapsed ? "10px" : "10px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span style={{ 
            opacity: isCollapsed ? 0 : 1,
            width: isCollapsed ? 0 : "auto",
            overflow: "hidden",
            transition: "opacity 0.2s",
            whiteSpace: "nowrap"
          }}>
            Sign Out
          </span>
        </button>

      </div>
    </aside>
  );
};

export default Sidebar;