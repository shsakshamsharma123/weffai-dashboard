// ══════════════════════════════════════════════════════════
// dataUtils.js  —  CSV parsing, frame computation, sync helpers
// ══════════════════════════════════════════════════════════
import { WORKING_STATES, IDLE_STATES, DISTRACTED_STATES, AWAY_STATES } from "./config";

export function classifyState(raw) {
  if (WORKING_STATES.has(raw))    return "Working";
  if (IDLE_STATES.has(raw))       return "Idle";
  if (DISTRACTED_STATES.has(raw)) return "Distracted";
  if (AWAY_STATES.has(raw))       return "Away";
  return "Working";
}

// Helper to safely extract a readable name from any CSV worker ID
export function formatWorkerName(wid) {
  if (!wid) return "Unknown Worker";
  const numMatch = String(wid).match(/\d+/);
  // If it finds a number, call it "Worker 1". Otherwise, use the raw ID.
  return numMatch ? `Worker ${numMatch[0]}` : `Worker ${wid}`;
}

// ── Re-export isDuringBreak dependencies ──────────────────
export function toMins(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function tsMins(ts) {
  if (!ts) return null;
  const parts = ts.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

export function isDuringBreak(ts, breakRanges) {
  const t = tsMins(ts);
  if (t === null) return false;
  return breakRanges.some(([s, e]) => s !== null && e !== null && t >= s && t <= e);
}

export function getBreakRanges(breaks) {
  const ranges = [];
  ["lunchTime", "teaTime", "miscTime"].forEach(k => {
    const s = toMins(breaks[k]?.start);
    const e = toMins(breaks[k]?.end);
    if (s !== null && e !== null) ranges.push([s, e]);
  });
  return ranges;
}

// ── CSV Parser ────────────────────────────────────────────
export function parseCSV(text) {
  const lines  = text.trim().split("\n");
  const header = lines[0].split(",").map(h => h.trim());
  const rows   = lines.slice(1).map(line => {
    const vals = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, vals[i]?.trim()]));
  });
  const byWorker = {};
  for (const row of rows) {
    const wid = row.worker_id || "Unknown"; // Failsafe if column is empty
    if (!byWorker[wid]) byWorker[wid] = [];
    byWorker[wid].push({
      frame:     parseInt(row.frame_index) || 0,
      timestamp: row.timestamp || "00:00:00",
      rawState:  row.state || "AWAY",
      state:     classifyState(row.state),
    });
  }
  return { rows, byWorker };
}

// ── Build summary from full CSV (with break exclusion) ────
export function buildSummaryFromCSV(byWorker, breakRanges = []) {
  return Object.entries(byWorker).map(([wid, frames]) => {
    const activeFrames = breakRanges.length > 0
      ? frames.filter(f => !isDuringBreak(f.timestamp, breakRanges))
      : frames;
    const total  = activeFrames.length || 1;
    const counts = { Working: 0, Idle: 0, Distracted: 0, Away: 0 };
    activeFrames.forEach(f => { if (counts[f.state] !== undefined) counts[f.state]++; });
    return {
      id:             wid,
      name:           formatWorkerName(wid), // Updated!
      working:        Math.round(counts.Working    / total * 100),
      idle:           Math.round(counts.Idle       / total * 100),
      distracted:     Math.round(counts.Distracted / total * 100),
      away:           Math.round(counts.Away       / total * 100),
      totalFrames:    activeFrames.length,
      excludedFrames: frames.length - activeFrames.length,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// ── Per-second timeline for one worker ───────────────────
export function buildTimeline(frames) {
  if (!frames || !frames.length) return [];
  const bySecond = {};
  frames.forEach(f => {
    if (!bySecond[f.timestamp])
      bySecond[f.timestamp] = { Working: 0, Idle: 0, Distracted: 0, Away: 0 };
    bySecond[f.timestamp][f.state]++;
  });
  return Object.entries(bySecond).slice(0, 120).map(([ts, c]) => ({ time: ts, ...c }));
}

// ── Real-time sync helpers ────────────────────────────────

// First frame index in CSV (video offset)
export function getFirstFrame(byWorker) {
  let min = Infinity;
  Object.values(byWorker).forEach(frames => {
    if (frames.length && frames[0].frame < min) min = frames[0].frame;
  });
  return min === Infinity ? 0 : min;
}

// Cumulative % per worker up to currentFrame
export function computeLiveWorkers(byWorker, currentFrame, breakRanges = []) {
  return Object.entries(byWorker).map(([wid, frames]) => {
    const upTo = frames.filter(f =>
      f.frame <= currentFrame &&
      !isDuringBreak(f.timestamp, breakRanges)
    );
    const total  = upTo.length || 1;
    const counts = { Working: 0, Idle: 0, Distracted: 0, Away: 0 };
    upTo.forEach(f => { if (counts[f.state] !== undefined) counts[f.state]++; });
    const lastFrame = frames.filter(f => f.frame <= currentFrame).slice(-1)[0];
    return {
      id:          wid,
      name:        formatWorkerName(wid), // Updated!
      working:     Math.round(counts.Working    / total * 100),
      idle:        Math.round(counts.Idle       / total * 100),
      distracted:  Math.round(counts.Distracted / total * 100),
      away:        Math.round(counts.Away       / total * 100),
      totalFrames: upTo.length,
      liveState:   lastFrame ? lastFrame.state    : "Away",
      liveRaw:     lastFrame ? lastFrame.rawState : "AWAY",
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// Auto-detect FPS from CSV frame data
export function detectFps(byWorker) {
  const allFrames = Object.values(byWorker).flat();
  if (allFrames.length < 60) return 30;
  const secCounts = {};
  allFrames.forEach(f => { secCounts[f.timestamp] = (secCounts[f.timestamp] || 0) + 1; });
  const vals      = Object.values(secCounts);
  const avgPerSec = vals.reduce((a, b) => a + b, 0) / vals.length;
  const estFps    = Math.round(avgPerSec / 6); // 6 workers per frame
  return (estFps >= 15 && estFps <= 60) ? estFps : 30;
}