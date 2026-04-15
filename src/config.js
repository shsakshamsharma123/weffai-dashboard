// ══════════════════════════════════════════════════════════
// config.js  —  All app-wide constants & mappings
// ══════════════════════════════════════════════════════════

export const ADMIN_EMAIL  = "admin@company.com";
export const SUMMARY_URL  = "/worker_summary.json";
export const PERFRAME_URL = "/worker_stats_perframe.csv";
export const VIDEO_FILENAME = "video.mp4";

// Worker email directory (mock — replace with real DB)
export const WORKER_EMAILS = {
  "W001": "worker.one@company.com",
  "W002": "worker.two@company.com",
  "W003": "worker.three@company.com",
  "W004": "worker.four@company.com",
  "W005": "worker.five@company.com",
  "W006": "worker.six@company.com",
};

// Raw model state → dashboard category
// ADDED "PASSIVE WORKING" to IDLE_STATES so the UI catches the new AI payload
export const WORKING_STATES    = new Set(["WORKING", "THINKING"]);
export const IDLE_STATES       = new Set(["IDLE", "PASSIVE WORKING"]); 
export const DISTRACTED_STATES = new Set(["DISTRACTED", "PHONE PROXIMITY"]);
export const AWAY_STATES       = new Set(["AWAY"]);
export const ON_LEAVE_STATES   = new Set(["ON LEAVE", "BREAK"]); // Added new waiver/break states

export function classifyState(raw) {
  if (WORKING_STATES.has(raw))    return "Working";
  if (IDLE_STATES.has(raw))       return "Idle"; // Still returns "Idle" category to preserve DB compatibility
  if (DISTRACTED_STATES.has(raw)) return "Distracted";
  if (AWAY_STATES.has(raw))       return "Away";
  if (ON_LEAVE_STATES.has(raw))   return "On Leave"; // Map to new UI category
  return "Working"; // INITIALIZING → Working
}

// State → badge color config
export const STATE_BADGE = {
  "Working":    { bg:"#dcfce7", color:"#15803d", dot:"#16a34a", label:"WORKING" },
  
  // Notice we keep the key "Idle" for database compatibility, but change the UI label to PASSIVE WORK
  "Idle":       { bg:"#fef9c3", color:"#854d0e", dot:"#ca8a04", label:"PASSIVE WORK" },
  
  "Distracted": { bg:"#fee2e2", color:"#b91c1c", dot:"#dc2626", label:"DISTRACTED" },
  "Away":       { bg:"#f1f5f9", color:"#475569", dot:"#64748b", label:"AWAY" },
  
  // Added a distinct Purple theme for authorized leaves/waivers
  "On Leave":   { bg:"#f3e8ff", color:"#6b21a8", dot:"#9333ea", label:"ON LEAVE" } 
};