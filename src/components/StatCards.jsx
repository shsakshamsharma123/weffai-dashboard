// ══════════════════════════════════════════════════════════
// components/StatCards.jsx
// ══════════════════════════════════════════════════════════
import React from "react";

const StatCards = ({ workers = [] }) => {
  const active = workers.filter(w => w.totalFrames > 0);
  const avg = key => active.length
    ? Math.round(active.reduce((s, w) => s + w[key], 0) / active.length) + "%"
    : "—";

  // Dynamically calculate how many workers are actually present (Not AWAY)
  const presentCount = workers.filter(w => {
    if (w.liveState) return w.liveState !== "Away"; // Live Sync View
    return w.away < 100;                            // Final Stats View (present part of the day)
  }).length;

  const cards = [
    { label: "Avg Working",    value: avg("working"),    sub: "of monitored time", cls: "sc-blue"  },
    { label: "Workers",        value: presentCount,      sub: "currently present", cls: "sc-teal"  },
    { label: "Avg Passive Work", value: avg("idle"),       sub: "unproductive time", cls: "sc-amber" },
    { label: "Avg Distracted", value: avg("distracted"), sub: "phone / off-task",  cls: "sc-red"   },
  ];
  
  return (
    <div className="stat-cards">
      {cards.map((c, i) => (
        <div className={`stat-card ${c.cls}`} key={i} style={{ animationDelay: `${i * 0.07}s` }}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value">{c.value}</div>
          <div className="stat-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
};
export default StatCards;