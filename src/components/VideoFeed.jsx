// ══════════════════════════════════════════════════════════
// components/VideoFeed.jsx
// ══════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef } from "react";

const VideoFeed = ({ videoUrl, onPlay, onPause }) => {
  const [playing, setPlaying] = useState(false);
  const [error, setError]     = useState(false);
  const vidRef = useRef(null);

  // Smart Detection: If it's an external link (like a WebRTC server), it needs an iframe
  const isStreamUrl = videoUrl && videoUrl.startsWith('http');

  // Reload the video whenever the source URL changes (for local files)
  useEffect(() => {
    if (!isStreamUrl && vidRef.current) {
      setError(false);
      setPlaying(false);
      vidRef.current.load();
      // Attempt to auto-play the new video
      vidRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [videoUrl, isStreamUrl]);

  const handleOverlayClick = () => {
    const vid = vidRef.current;
    if (!vid) return;
    vid.muted = true;
    const p = vid.play();
    if (p !== undefined) {
      p.then(() => setPlaying(true)).catch(err => console.error("Play failed:", err));
    } else {
      setPlaying(true);
    }
  };

  if (error) {
    return (
      <div className="video-ph">
        <div className="video-ph-icon">⚠️</div>
        <div className="video-ph-text" style={{ textAlign: "center", padding: "0 24px", lineHeight: 1.7 }}>
          Could not load video: <br />
          <span style={{ fontSize: 10, opacity: 0.5 }}>
            Ensure <strong style={{ color: "white" }}>{videoUrl}</strong> is accessible and running.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", background: "#000", lineHeight: 0, height: "100%", width: "100%" }}>
      
      {isStreamUrl ? (
        // Render an iframe for streaming servers (like WebRTC / MediaMTX)
        <iframe
          src={videoUrl}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          allow="autoplay; fullscreen"
          title="Live Stream Feed"
          onError={() => setError(true)}
        />
      ) : (
        // Render standard video tag for local .mp4 placeholder files
        <video
          ref={vidRef}
          muted loop playsInline autoPlay
          src={videoUrl}
          onError={() => setError(true)}
          onPlay={() => { setPlaying(true); onPlay?.(); }}
          onPause={() => { setPlaying(false); onPause?.(); }}
          style={{ width: "100%", height: "100%", aspectRatio: "16/9", display: "block", objectFit: "cover" }}
        />
      )}

      {/* Only show the manual play overlay for local video files that failed to auto-play */}
      {!isStreamUrl && !playing && !error && (
        <div onClick={handleOverlayClick} style={{
          position: "absolute", inset: 0,
          background: "rgba(10,22,40,0.6)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          cursor: "pointer", gap: 14,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "rgba(255,255,255,0.12)",
            border: "2.5px solid rgba(255,255,255,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, color: "white", paddingLeft: 4,
          }}>▶</div>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 600, fontFamily: "'Sora',sans-serif" }}>
            Click to play
          </span>
        </div>
      )}

      {/* Keep the REC overlay active for all streams */}
      {(!isStreamUrl ? playing : true) && !error && (
        <div className="video-lbl" style={{ position: "absolute", top: 12, left: 12, pointerEvents: "none" }}>
          <div className="rec-dot" /> REC · {videoUrl}
        </div>
      )}
    </div>
  );
};

export default VideoFeed;