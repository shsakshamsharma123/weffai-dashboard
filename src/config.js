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
export const WORKING_STATES    = new Set(["WORKING", "THINKING"]);
export const IDLE_STATES       = new Set(["IDLE"]);
export const DISTRACTED_STATES = new Set(["DISTRACTED", "PHONE PROXIMITY"]);
export const AWAY_STATES       = new Set(["AWAY"]);

export function classifyState(raw) {
  if (WORKING_STATES.has(raw))    return "Working";
  if (IDLE_STATES.has(raw))       return "Idle";
  if (DISTRACTED_STATES.has(raw)) return "Distracted";
  if (AWAY_STATES.has(raw))       return "Away";
  return "Working"; // INITIALIZING → Working
}

// State → badge color config
export const STATE_BADGE = {
  "Working":    { bg:"#dcfce7", color:"#15803d", dot:"#16a34a", label:"WORKING"    },
  "Idle":       { bg:"#fef9c3", color:"#854d0e", dot:"#ca8a04", label:"IDLE"       },
  "Distracted": { bg:"#fee2e2", color:"#991b1b", dot:"#dc2626", label:"DISTRACTED" },
  "Away":       { bg:"#f3f4f6", color:"#374151", dot:"#6b7280", label:"AWAY"       },
};

// Default break schedule
export const DEFAULT_BREAKS = {
  onTime:    { single: "09:00" },
  offTime:   { single: "18:00" },
  lunchTime: { start: "13:00", end: "14:00" },
  teaTime:   { start: "16:00", end: "16:15" },
  miscTime:  { start: "11:00", end: "11:15" },
};