import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

// ==========================================
// 1. EZVIZ CLOUD CONFIGURATION
// ==========================================
const APP_KEY = "526595c516eb4797bac8322c0e90244e";
const APP_SECRET = "8f8cacf15b834811905363919005380c";

// Map your workstation strings to actual EZVIZ device serials
const CAMERA_MAPPING = {
  "Workstation-1": "BE4119693",
  "Workstation-2": "YOUR_SECOND_CAMERA_SERIAL" // Replace when you add a second camera
};

const VideoFeed = ({ videoUrl, onStatusChange }) => {
  const videoRef = useRef(null);
  const [retryCount, setRetryCount] = useState(0);

  // We extract the workstation ID from the old videoUrl prop so you 
  // don't have to rewrite your HomeTab.jsx logic!
  const workstationId = (videoUrl || "").includes("workstation2") ? "Workstation-2" : "Workstation-1";
  const deviceSerial = CAMERA_MAPPING[workstationId];

  useEffect(() => {
    let hls = null;
    let refreshInterval = null;

    const initializeStream = async () => {
      try {
        if (onStatusChange) onStatusChange("syncing");

        // 1. Fetch Secure Token from EZVIZ
        const tokenRes = await fetch("https://open.ezvizlife.com/api/lapp/token/get", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ appKey: APP_KEY, appSecret: APP_SECRET })
        });
        
        const tokenData = await tokenRes.json();
        if (tokenData.code !== "200") throw new Error(tokenData.msg || "Token fetch failed");
        
        const token = tokenData.data.accessToken;

        // 2. Fetch HLS Live Stream Address
        const urlRes = await fetch("https://open.ezvizlife.com/api/lapp/live/address/get", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            accessToken: token,
            deviceSerial: deviceSerial,
            channelNo: "1",
            protocol: "2", // Request HLS Protocol
            quality: "1"   // HD Quality
          })
        });

        const urlData = await urlRes.json();
        if (urlData.code !== "200") throw new Error(urlData.msg || "Stream URL fetch failed");
        
        const hlsStreamUrl = urlData.data.url;

        // 3. Attach stream to video player
        if (Hls.isSupported()) {
          if (hls) hls.destroy(); // Clean up old instance if reconnecting

        hls = new Hls({
            // LOW LATENCY MODE
            lowLatencyMode: true,              // Enable LL-HLS
            liveSyncDurationCount: 1,          // Stay only 1 chunk behind
            liveMaxLatencyDurationCount: 2,    // Max 2 chunks behind
            
            // AGGRESSIVE LOADING
            maxBufferLength: 2,                // Only buffer 2 seconds
            maxMaxBufferLength: 4,             // Hard ceiling 4 seconds
            backBufferLength: 0,               // No back buffer
            
            // FASTER STARTUP
            manifestLoadingTimeOut: 5000,      // 5 second timeout
            levelLoadingTimeOut: 5000,
            
            // RETRY AGGRESSIVELY
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 500,
            
            // DISABLE FEATURES THAT ADD LATENCY
            enableWorker: false,
            enableSoftwareAES: false,
          });

          hls.loadSource(hlsStreamUrl);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current.play().catch(e => console.log("Autoplay blocked by browser policy"));
            if (onStatusChange) onStatusChange("playing");
            setRetryCount(0); // Reset retries on success
          });

          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              console.warn("HLS Fatal Error, attempting to recover...", data);
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
              } else {
                // If it completely dies, wait 5s and re-fetch everything
                setTimeout(() => setRetryCount(prev => prev + 1), 5000);
              }
            }
          });

        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Fallback for Safari (native HLS support)
          videoRef.current.src = hlsStreamUrl;
          videoRef.current.addEventListener('loadedmetadata', () => {
            videoRef.current.play();
            if (onStatusChange) onStatusChange("playing");
          });
        }

      } catch (err) {
        console.error("Cloud Stream Error:", err);
        if (onStatusChange) onStatusChange("error");
        
        // Retry loop if API fails
        setTimeout(() => setRetryCount(prev => prev + 1), 10000); 
      }
    };

    initializeStream();

    // EZVIZ tokens expire. Automatically refresh the stream every 80 minutes (4800s)
    refreshInterval = setInterval(() => {
      console.log("Refreshing Cloud Token...");
      initializeStream();
    }, 4800 * 1000); 

    // Cleanup when component unmounts or switches cameras
    return () => {
      if (hls) hls.destroy();
      if (refreshInterval) clearInterval(refreshInterval);
    };

  }, [workstationId, deviceSerial, retryCount]); 

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      <video 
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        muted 
        autoPlay 
        playsInline
      />
    </div>
  );
};

export default VideoFeed;