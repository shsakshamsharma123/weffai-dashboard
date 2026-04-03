// ══════════════════════════════════════════════════════════
// styles/GlobalStyles.jsx  —  All app CSS
// ══════════════════════════════════════════════════════════
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Sora',sans-serif; background:#f0f4f8; }
    :root {
      --blue-900:#0a1628; --blue-800:#0d2045; --blue-700:#0f3460;
      --blue-600:#1a4a8a; --blue-500:#2563eb; --blue-400:#3b82f6;
      --blue-300:#93c5fd; --blue-100:#dbeafe; --blue-50:#eff6ff;
      --accent:#0ea5e9; --success:#10b981; --warn:#f59e0b;
      --danger:#ef4444; --away:#6b7280;
      --white:#ffffff; --gray-50:#f8fafc; --gray-100:#f1f5f9;
      --gray-200:#e2e8f0; --gray-400:#94a3b8; --gray-600:#475569; --gray-800:#1e293b;
    }
    @keyframes fadeUp   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
    @keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0.35} }
    @keyframes pulseDot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.75)} }
    @keyframes statePulse { 0%,100%{opacity:1} 50%{opacity:0.6} }

    /* ─ LOGIN ─ */
    .login-page { min-height:100vh; display:grid; grid-template-columns:1fr 480px; overflow:hidden; }
    .login-gif-panel { position:relative; overflow:hidden; background:linear-gradient(135deg,#0a1628,#0f3460,#0ea5e9); }
    .login-gif-panel img { width:100%; height:100%; object-fit:cover; }
    .login-gif-overlay { position:absolute; inset:0; background:linear-gradient(135deg,rgba(10,22,40,0.72)0%,rgba(15,52,96,0.5)50%,rgba(2,132,199,0.28)100%); display:flex; flex-direction:column; justify-content:flex-end; padding:48px; }
    .login-brand { font-size:12px; font-weight:600; letter-spacing:0.22em; text-transform:uppercase; color:var(--blue-300); margin-bottom:12px; }
    .login-tagline { font-size:34px; font-weight:700; color:#fff; line-height:1.2; max-width:400px; }
    .login-tagline span { color:var(--accent); }
    .login-sub { margin-top:14px; font-size:14px; color:rgba(255,255,255,0.6); max-width:340px; line-height:1.65; }
    .login-form-panel { background:var(--white); display:flex; flex-direction:column; justify-content:center; padding:56px 48px; box-shadow:-8px 0 32px rgba(10,22,40,0.12); }
    .login-logo { display:flex; align-items:center; gap:10px; margin-bottom:40px; }
    .login-logo-icon { width:40px; height:40px; border-radius:10px; background:linear-gradient(135deg,var(--blue-700),var(--accent)); display:flex; align-items:center; justify-content:center; color:white; font-size:18px; font-weight:700; }
    .login-logo-text { font-size:18px; font-weight:700; color:var(--blue-900); }
    .login-logo-text span { color:var(--accent); }
    .form-heading { font-size:28px; font-weight:700; color:var(--blue-900); }
    .form-sub { font-size:14px; color:var(--gray-400); margin-top:6px; margin-bottom:36px; }
    .form-group { margin-bottom:20px; }
    .form-label { display:block; font-size:13px; font-weight:600; color:var(--gray-600); margin-bottom:8px; }
    .form-input { width:100%; padding:13px 16px; border:1.5px solid var(--gray-200); border-radius:10px; font-family:'Sora',sans-serif; font-size:14px; color:var(--gray-800); background:var(--gray-50); outline:none; transition:all 0.2s; }
    .form-input:focus { border-color:var(--blue-500); background:white; box-shadow:0 0 0 3px rgba(37,99,235,0.1); }
    .form-forgot { text-align:right; margin-top:-12px; margin-bottom:20px; }
    .btn-login { width:100%; padding:14px; background:linear-gradient(135deg,var(--blue-700),var(--blue-500)); color:white; border:none; border-radius:10px; font-family:'Sora',sans-serif; font-size:15px; font-weight:600; cursor:pointer; transition:all 0.2s; }
    .btn-login:hover { transform:translateY(-1px); box-shadow:0 8px 24px rgba(37,99,235,0.35); }
    .btn-login:disabled { opacity:0.7; cursor:not-allowed; transform:none; }
    .login-error { background:#fef2f2; border:1px solid #fecaca; color:var(--danger); padding:12px 16px; border-radius:8px; font-size:13px; margin-bottom:16px; }
    .login-footer { margin-top:32px; text-align:center; font-size:12px; color:var(--gray-400); }

    /* ─ SHELL ─ */
    .app-shell { display:flex; min-height:100vh; background:var(--gray-100); }

    /* ─ SIDEBAR ─ */
    .sidebar { width:260px; flex-shrink:0; background:var(--blue-900); display:flex; flex-direction:column; position:fixed; top:0; left:0; bottom:0; z-index:100; overflow-y:auto; }
    .sidebar-header { padding:24px 20px; border-bottom:1px solid rgba(255,255,255,0.07); display:flex; align-items:center; gap:12px; }
    .sidebar-logo-icon { width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,var(--blue-600),var(--accent)); display:flex; align-items:center; justify-content:center; color:white; font-size:16px; font-weight:700; flex-shrink:0; }
    .sidebar-title { font-size:15px; font-weight:700; color:white; }
    .sidebar-subtitle { font-size:11px; color:var(--blue-300); margin-top:2px; }
    .sidebar-section-label { font-size:10px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:rgba(255,255,255,0.3); padding:18px 20px 8px; }
    .break-list { padding:0 12px; }
    .break-item { display:flex; align-items:center; justify-content:space-between; padding:9px 8px; border-radius:8px; margin-bottom:5px; transition:background 0.15s; flex-wrap:wrap; gap:5px; }
    .break-item:hover { background:rgba(255,255,255,0.05); }
    .break-label { font-size:12px; color:rgba(255,255,255,0.7); font-weight:500; display:flex; align-items:center; gap:7px; min-width:90px; }
    .break-dot { width:5px; height:5px; border-radius:50%; background:var(--accent); flex-shrink:0; }
    .break-time-group { display:flex; align-items:center; gap:4px; }
    .break-time-sep { font-size:10px; color:rgba(255,255,255,0.3); }
    .break-input { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); border-radius:6px; padding:4px 5px; font-family:'JetBrains Mono',monospace; font-size:11px; color:white; text-align:center; outline:none; transition:all 0.2s; }
    .break-input.date-picker { width: 100%; padding: 8px; font-size: 12px; text-align: left; }
    .break-input:focus { border-color:var(--accent); background:rgba(14,165,233,0.15); }
    .sidebar-footer { padding:16px; border-top:1px solid rgba(255,255,255,0.07); margin-top:auto; }
    .btn-logout { width:100%; padding:10px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25); color:#fca5a5; border-radius:8px; font-family:'Sora',sans-serif; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s; }
    .btn-logout:hover { background:rgba(239,68,68,0.25); color:white; }

    /* Worker Checkbox List in Sidebar */
    .sidebar-worker-check { display:flex; align-items:center; gap:8px; padding:6px 12px; color:rgba(255,255,255,0.7); font-size:12px; cursor:pointer; transition:color 0.2s; }
    .sidebar-worker-check:hover { color:white; background:rgba(255,255,255,0.05); border-radius:6px; }
    .sidebar-worker-check input { cursor:pointer; accent-color: var(--accent); }

    /* ─ MAIN ─ */
    .main-content { margin-left:260px; flex:1; display:flex; flex-direction:column; min-height:100vh; }
    .topbar { background:white; padding:14px 28px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--gray-200); position:sticky; top:0; z-index:50; box-shadow:0 1px 8px rgba(10,22,40,0.06); }
    .topbar-title { font-size:19px; font-weight:700; color:var(--blue-900); }
    .topbar-title span { color:var(--blue-500); }
    .topbar-right { display:flex; align-items:center; gap:14px; }
    .topbar-date { font-size:11px; color:var(--gray-400); font-family:'JetBrains Mono',monospace; }
    .topbar-avatar { width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg,var(--blue-700),var(--accent)); display:flex; align-items:center; justify-content:center; color:white; font-size:13px; font-weight:700; }
    .data-badge { display:flex; align-items:center; gap:6px; padding:5px 12px; border-radius:20px; font-size:11px; font-weight:600; }
    .data-badge.loaded  { background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); color:var(--success); }
    .data-badge.loading { background:rgba(37,99,235,0.1);  border:1px solid rgba(37,99,235,0.2);  color:var(--blue-500); }
    .data-badge.error   { background:rgba(239,68,68,0.1);  border:1px solid rgba(239,68,68,0.2);  color:var(--danger); }
    .bdot { width:7px; height:7px; border-radius:50%; }
    .bdot.g { background:var(--success); animation:pulseDot 2s infinite; }
    .bdot.b { background:var(--blue-500); }
    .bdot.r { background:var(--danger); }

    /* ─ BODY ─ */
    .dash-body { padding:22px 28px; flex:1; }
    .load-banner { display:flex; align-items:center; gap:10px; padding:11px 16px; border-radius:10px; font-size:12px; font-weight:500; margin-bottom:18px; }
    .load-banner.info    { background:var(--blue-50); color:var(--blue-700); border:1px solid var(--blue-100); }
    .load-banner.success { background:rgba(16,185,129,0.07); color:#065f46; border:1px solid rgba(16,185,129,0.2); }
    .load-banner.error   { background:#fef2f2; color:var(--danger); border:1px solid #fecaca; }
    .reload-btn { margin-left:auto; background:none; border:none; cursor:pointer; font-size:12px; font-weight:600; color:inherit; }

    /* ─ STAT CARDS ─ */
    .stat-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:22px; }
    .stat-card { background:white; border-radius:14px; padding:20px 22px; border:1px solid var(--gray-200); box-shadow:0 2px 8px rgba(10,22,40,0.04); position:relative; overflow:hidden; transition:transform 0.2s,box-shadow 0.2s; animation:fadeUp 0.4s ease both; }
    .stat-card:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(10,22,40,0.09); }
    .stat-card::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; }
    .sc-blue::before  { background:var(--blue-500); }
    .sc-teal::before  { background:var(--accent); }
    .sc-amber::before { background:var(--warn); }
    .sc-red::before   { background:var(--danger); }
    .stat-label { font-size:10px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:var(--gray-400); margin-bottom:10px; }
    .stat-value { font-size:26px; font-weight:700; color:var(--blue-900); font-family:'JetBrains Mono',monospace; }
    .stat-sub { font-size:11px; color:var(--gray-400); margin-top:4px; }

    /* ─ GRID ─ */
    .dash-grid { display:grid; grid-template-columns:1fr 370px; gap:20px; }
    .dash-left  { display:flex; flex-direction:column; gap:20px; }
    .dash-right { display:flex; flex-direction:column; gap:20px; }

    /* ─ PANEL ─ */
    .panel { background:white; border-radius:14px; border:1px solid var(--gray-200); box-shadow:0 2px 8px rgba(10,22,40,0.04); overflow:hidden; animation:fadeUp 0.4s ease both; }
    .panel-header { padding:14px 18px; border-bottom:1px solid var(--gray-100); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
    .panel-title { font-size:13px; font-weight:700; color:var(--blue-900); display:flex; align-items:center; gap:8px; }
    .panel-icon { width:26px; height:26px; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:13px; }
    .pi-blue  { background:var(--blue-100); }
    .pi-teal  { background:rgba(14,165,233,0.12); }
    .pi-green { background:rgba(16,185,129,0.12); }
    .panel-body { padding:18px; }

    /* ─ CHART FILTERS ─ */
    .chart-filters { display:flex; gap:6px; flex-wrap:wrap; }
    .filter-btn { padding:4px 11px; border-radius:20px; font-size:11px; font-weight:600; cursor:pointer; border:1.5px solid var(--gray-200); color:var(--gray-600); background:white; transition:all 0.2s; }
    .f-all  { background:var(--blue-900)!important; color:white!important; border-color:var(--blue-900)!important; }
    .f-work { background:var(--blue-500)!important; color:white!important; border-color:var(--blue-500)!important; }
    .f-idle { background:var(--warn)!important;     color:white!important; border-color:var(--warn)!important; }
    .f-dist { background:var(--danger)!important;   color:white!important; border-color:var(--danger)!important; }
    .f-away { background:var(--away)!important;     color:white!important; border-color:var(--away)!important; }

    /* ─ WORKER DETAIL ─ */
    .detail-row { display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--gray-100); }
    .detail-row:last-of-type { border-bottom:none; }
    .detail-label { font-size:13px; color:var(--gray-600); font-weight:500; display:flex; align-items:center; gap:8px; }
    .detail-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
    .detail-val { font-size:15px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .prog-bar  { height:5px; border-radius:3px; background:var(--gray-100); margin-top:3px; margin-bottom:10px; }
    .prog-fill { height:100%; border-radius:3px; }

    /* ─ CAMERA ─ */
    .cam-tabs { display:flex; gap:8px; }
    .cam-tab { padding:5px 13px; border-radius:20px; font-size:11px; font-weight:600; cursor:pointer; border:1.5px solid var(--gray-200); color:var(--gray-600); background:white; transition:all 0.2s; }
    .cam-tab.cam-active { background:var(--blue-700); color:white; border-color:var(--blue-700); }
    .video-wrap { position:relative; background:#000; }
    .video-feed { width:100%; aspect-ratio:16/9; display:block; object-fit:cover; }
    .video-ph { aspect-ratio:16/9; background:var(--blue-900); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:rgba(255,255,255,0.3); }
    .video-ph-icon { font-size:34px; }
    .video-ph-text { font-size:12px; font-weight:500; }
    .video-lbl { position:absolute; top:10px; left:10px; background:rgba(10,22,40,0.8); backdrop-filter:blur(6px); padding:3px 9px; border-radius:5px; font-size:10px; font-weight:600; color:white; font-family:'JetBrains Mono',monospace; display:flex; align-items:center; gap:5px; }
    .rec-dot { width:6px; height:6px; border-radius:50%; background:var(--danger); animation:blink 1s infinite; }

    /* ─ EMAIL ─ */
    .email-info { background:var(--blue-50); border:1px solid var(--blue-100); border-radius:9px; padding:11px 14px; font-size:12px; color:var(--blue-700); margin-bottom:10px; }
    .email-info strong { display:block; font-size:10px; color:var(--gray-400); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:3px; }
    .btn-send { width:100%; padding:11px; background:linear-gradient(135deg,var(--blue-700),var(--blue-500)); color:white; border:none; border-radius:9px; font-family:'Sora',sans-serif; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s; }
    .btn-send:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(37,99,235,0.3); }
    .btn-send:disabled { opacity:0.8; cursor:wait; transform:none; background:var(--blue-600); box-shadow:none; }
    .email-sent { background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); color:var(--success); padding:11px; border-radius:9px; font-size:13px; font-weight:600; text-align:center; animation:fadeUp 0.3s ease; }

    /* ─ CHART TOOLTIP ─ */
    .ctt { background:var(--blue-900); border-radius:10px; padding:11px 15px; color:white; font-size:12px; box-shadow:0 8px 24px rgba(10,22,40,0.3); }
    .ctt-label { font-weight:700; margin-bottom:6px; color:var(--blue-300); font-size:11px; }
    .ctt-row { display:flex; justify-content:space-between; gap:14px; margin-top:3px; }
    .ctt-dot { width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:4px; }

    /* ─ LIVE SYNC ─ */
    .live-sync-bar { display:flex; align-items:center; gap:12px; padding:10px 18px; background:linear-gradient(90deg,rgba(37,99,235,0.06),rgba(14,165,233,0.04)); border-bottom:1px solid var(--gray-100); }
    .sync-time { font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:600; color:var(--blue-700); }
    .sync-progress { flex:1; height:4px; background:var(--gray-200); border-radius:2px; overflow:hidden; }
    .sync-progress-fill { height:100%; background:linear-gradient(90deg,var(--blue-500),var(--accent)); border-radius:2px; transition:width 0.9s linear; }
    .sync-label { font-size:11px; color:var(--gray-400); font-weight:500; }
    .live-state-active { animation:statePulse 2s infinite; }

    @media(max-width:1200px){ .dash-grid{grid-template-columns:1fr} .stat-cards{grid-template-columns:repeat(2,1fr)} }
    @media(max-width:768px){ .login-page{grid-template-columns:1fr} .login-gif-panel{display:none} .main-content{margin-left:0} .sidebar{display:none} }
  `}</style>
);

export default GlobalStyles;