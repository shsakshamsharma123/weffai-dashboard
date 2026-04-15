import { useState } from "react";

const ADMIN_EMAIL = "saksham@datacouch.io";
const ADMIN_NAME = "Saksham"; // Maps to {{1}}

// ══════════════════════════════════════════════════════════
// HELPER: Convert Raw Frames to Human-Readable Time
// ══════════════════════════════════════════════════════════
const formatFramesWithTime = (frames) => {
  // ⚠️ CRITICAL: Adjust this number to match your Python CV script.
  // If your script processes 1 frame every second, leave it at 1.
  // If it processes 5 frames a second, change it to 5.
  const fps = 1; 
  
  if (!frames || isNaN(frames)) return "0 (0 min)";

  const totalSeconds = Math.floor(frames / fps);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${frames} (approx ${hours} hr ${minutes} min)`;
  }
  return `${frames} (${minutes} min)`;
};

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
const EmailPanel = ({ workers, selectedCam }) => {
  const [emailTargets, setEmailTargets] = useState([]);
  const [emailStatus, setEmailStatus]   = useState("Passive Working");

  const handleSendEmail = async () => {
    if (emailTargets.length === 0) return;
    setEmailStatus("sending");

    const targets = workers.filter(w => emailTargets.includes(w.id));
    
    // Define the base URL once here:
    const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    try {
      await Promise.all(targets.map(async (worker) => {
        
        // 1. FIRE EMAIL API
        const emailPromise = fetch(`${API_BASE}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: worker.email,
            subject: `Efficiency Alert: ${worker.name}`,
            body: `Hello ${worker.name},\n\nWorking: ${worker.working}%\nPassive Working: ${worker.idle}%\nDistracted: ${worker.distracted}%\nAway: ${worker.away}%`
          })
        });

        // 2. FIRE WHATSAPP TEMPLATE API
        const whatsappPromise = fetch(`${API_BASE}/api/send-whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: "916239037112", 
            adminName: ADMIN_NAME,
            workerName: worker.name,
            working: worker.working,
            idle: worker.idle,
            distracted: worker.distracted,
            away: worker.away,
            totalFrames: formatFramesWithTime(worker.totalFrames), 
            camera: selectedCam                         
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

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <div className="panel-icon pi-green">✉️</div>Send Multi-Channel Alert
        </div>
      </div>
      <div className="panel-body">
        <div className="email-info" style={{ paddingBottom: '16px' }}>
          <strong>Recipient(s)</strong>
          <div style={{ maxHeight: '140px', overflowY: 'auto', background: 'white', border: '1px solid var(--gray-200)', borderRadius: '8px', padding: '8px', marginTop: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px', fontSize: '12px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={emailTargets.length === workers.length && workers.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setEmailTargets(workers.map(w => w.id));
                  else setEmailTargets([]);
                }}
              />
              <strong>Select All Workers ({workers.length})</strong>
            </label>
            <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid var(--gray-100)' }} />
            {workers.map(w => (
              <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <input 
                  type="checkbox" 
                  checked={emailTargets.includes(w.id)}
                  onChange={(e) => {
                    if (e.target.checked) setEmailTargets(prev => [...prev, w.id]);
                    else setEmailTargets(prev => prev.filter(id => id !== w.id));
                  }}
                />
                {w.name} <span style={{color: 'var(--gray-400)'}}>({w.email})</span>
              </label>
            ))}
          </div>
        </div>
        <div className="email-info">
          <strong>Sender</strong>{ADMIN_EMAIL}
        </div>
        <div className="email-info">
          <strong>Channels</strong>Email & WhatsApp (Template: daily_efficiency_alert)
        </div>
        
        {emailStatus === "success" ? (
          <div className="email-sent" style={{ color: 'var(--green-600)', fontWeight: 'bold' }}>✓ Email & WhatsApp alerts sent!</div>
        ) : (
          <button 
            className="btn-send" 
            onClick={handleSendEmail}
            style={{ 
              width: '100%', 
              padding: '10px', 
              background: emailTargets.length > 0 ? '#25D366' : '#ccc', 
              color: 'white', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
            disabled={emailStatus === "sending" || emailTargets.length === 0}
          >
            {emailStatus === "sending" ? "Processing..." : `Send Alerts (${emailTargets.length})`}
          </button>
        )}
      </div>
    </div>
  );
};

export default EmailPanel;