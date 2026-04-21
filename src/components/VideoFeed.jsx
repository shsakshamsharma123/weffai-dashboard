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
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState(Date.now());

  // We extract the workstation ID from the old videoUrl prop so you 
  // don't have to rewrite your HomeTab.jsx logic!
  const workstationId = (videoUrl || "").includes("workstation2") ? "Workstation-2" : "Workstation-1";
  const deviceSerial = CAMERA_MAPPING[workstationId];

  useEffect(() => {
    let hls = null;
    let refreshInterval = null;
    let freezeCheckInterval = null;
    let isComponentMounted = true;

    const initializeStream = async () => {
      try {
        if (onStatusChange) onStatusChange("syncing");
        setIsManualRefreshing(true);

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
          if (hls) {
            hls.destroy(); // Clean up old instance if reconnecting
          }

          hls = new Hls({
            // ==========================================
            // AGGRESSIVE PATIENCE SETTINGS FOR EZVIZ INDIA
            // ==========================================
            
            // Keep more chunks to survive EZVIZ server delays
            liveSyncDurationCount: 5,          // Keep 5 chunks behind live (was 1)
            liveMaxLatencyDurationCount: 15,   // Allow up to 15 chunks behind (was 2)
            maxLiveSyncPlaybackRate: 1.0,      // Don't speed up (reduces glitches)
            
            // LARGE BUFFERS - Critical for EZVIZ India
            maxBufferLength: 60,               // 60 seconds buffer (was 4)
            maxMaxBufferLength: 120,           // 120 seconds hard ceiling (was 8)
            backBufferLength: 0,               // Don't keep any past video in memory
            
            // ==========================================
            // EXTREME RETRY SETTINGS
            // ==========================================
            
            // Manifest retry settings
            manifestLoadingTimeOut: 30000,      // 30 seconds timeout (was 10)
            manifestLoadingMaxRetry: 20,        // Retry 20 times (was default 3)
            manifestLoadingRetryDelay: 2000,    // Wait 2 seconds between retries
            
            // Quality level retry settings
            levelLoadingTimeOut: 30000,         // 30 seconds timeout
            levelLoadingMaxRetry: 20,           // Retry 20 times
            levelLoadingRetryDelay: 2000,       // Wait 2 seconds
            
            // Fragment retry settings
            fragLoadingTimeOut: 30000,          // 30 seconds for fragments
            fragLoadingMaxRetry: 20,            // Retry 20 times for fragments
            fragLoadingRetryDelay: 1000,        // Wait 1 second
            
            // ==========================================
            // STABILITY OVER SPEED
            // ==========================================
            
            lowLatencyMode: false,              // Disable LL-HLS (EZVIZ India doesn't support well)
            enableWorker: true,                 // Use web worker for better performance
            autoStartLoad: true,
            startPosition: -1,                  // Start from live edge
            
            // Debug (set to true if you need to debug)
            debug: false,
          });

          // ==========================================
          // EVENT HANDLERS
          // ==========================================
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log("✅ HLS Manifest parsed successfully");
            videoRef.current.play().catch(e => console.log("Autoplay blocked:", e));
            if (onStatusChange && isComponentMounted) onStatusChange("playing");
            setErrorCount(0);
            setIsManualRefreshing(false);
            setLastFrameTime(Date.now());
          });

          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            // Fragment successfully loaded
            setLastFrameTime(Date.now());
          });

          hls.on(Hls.Events.ERROR, (event, data) => {
            console.warn("⚠️ HLS Error:", data.type, data.details);
            
            if (data.fatal) {
              setErrorCount(prev => prev + 1);
              
              switch(data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log("🔄 Network error, attempting recovery...");
                  // DON'T DESTROY - Just retry loading
                  setTimeout(() => {
                    if (hls && isComponentMounted) {
                      hls.startLoad();
                    }
                  }, 2000);
                  break;
                  
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log("🔄 Media error, attempting recovery...");
                  if (hls && isComponentMounted) {
                    hls.recoverMediaError();
                  }
                  break;
                  
                case Hls.ErrorTypes.MUX_ERROR:
                  console.log("🔄 Mux error, retrying...");
                  setTimeout(() => {
                    if (hls && isComponentMounted) {
                      hls.startLoad();
                    }
                  }, 2000);
                  break;
                  
                default:
                  // If error count is high, trigger full refresh
                  if (errorCount > 10) {
                    console.log("🔄 Too many errors, triggering full refresh...");
                    if (isComponentMounted) {
                      setRetryCount(prev => prev + 1);
                    }
                  } else {
                    // Otherwise just restart loading
                    setTimeout(() => {
                      if (hls && isComponentMounted) {
                        hls.startLoad();
                      }
                    }, 2000);
                  }
                  break;
              }
            }
          });

          // Load the stream
          hls.loadSource(hlsStreamUrl);
          hls.attachMedia(videoRef.current);

        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Fallback for Safari (native HLS support)
          videoRef.current.src = hlsStreamUrl;
          videoRef.current.addEventListener('loadedmetadata', () => {
            videoRef.current.play();
            if (onStatusChange && isComponentMounted) onStatusChange("playing");
            setIsManualRefreshing(false);
            setErrorCount(0);
            setLastFrameTime(Date.now());
          });
        }

      } catch (err) {
        console.error("❌ Cloud Stream Error:", err);
        if (onStatusChange && isComponentMounted) onStatusChange("error");
        setIsManualRefreshing(false);
        
        // Retry loop if API fails
        setTimeout(() => {
          if (isComponentMounted) {
            setRetryCount(prev => prev + 1);
          }
        }, 5000); 
      }
    };

    // ==========================================
    // FREEZE DETECTION - Auto-recovery
    // ==========================================
    const checkForFreeze = () => {
        if (!videoRef.current || !isComponentMounted) return;
        
        const video = videoRef.current;
        const now = Date.now();
        const timeSinceLastFrame = now - lastFrameTime;
        
        // If video is supposed to be playing but no frames for 10 seconds
        if (!video.paused && timeSinceLastFrame > 10000) {
          console.warn(`⚠️ Video frozen for ${Math.round(timeSinceLastFrame/1000)}s - AUTO-REFRESHING...`);
          
          // TRIGGER FULL REFRESH (same as double-click)
          if (isComponentMounted) {
            setRetryCount(prev => prev + 1);
          }
          
          setLastFrameTime(now); // Prevent repeated triggers
        }
        
        // If video is paused but should be playing (browser glitch)
        if (video.paused && !video.ended && video.readyState >= 2) {
          console.log("▶️ Video paused unexpectedly, resuming...");
          video.play().catch(e => console.log("Resume failed:", e));
        }

      
      // If video is paused but should be playing (browser glitch)
      if (video.paused && !video.ended && video.readyState >= 2) {
        console.log("▶️ Video paused unexpectedly, resuming...");
        video.play().catch(e => console.log("Resume failed:", e));
      }
    };

    // ==========================================
    // MANUAL REFRESH ON USER INTERACTION
    // ==========================================
    const handleManualRefresh = () => {
      if (!isManualRefreshing) {
        console.log("🔄 Manual refresh triggered");
        setRetryCount(prev => prev + 1);
      }
    };

    // Add click handler to video for manual refresh
    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.addEventListener('dblclick', handleManualRefresh);
    }

    // Initialize stream
    initializeStream();

    // ==========================================
    // INTERVALS
    // ==========================================
    
    // Freeze check every 5 seconds
    freezeCheckInterval = setInterval(checkForFreeze, 5000);
    
    // Token refresh every 60 minutes (was 80)
    refreshInterval = setInterval(() => {
      console.log("🔄 Scheduled token refresh...");
      if (isComponentMounted) {
        setRetryCount(prev => prev + 1);
      }
    }, 60 * 60 * 1000); // 60 minutes

    // ==========================================
    // CLEANUP
    // ==========================================
    return () => {
      isComponentMounted = false;
      
      if (hls) {
        hls.destroy();
      }
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (freezeCheckInterval) {
        clearInterval(freezeCheckInterval);
      }
      if (videoElement) {
        videoElement.removeEventListener('dblclick', handleManualRefresh);
      }
    };

  }, [workstationId, deviceSerial, retryCount]); 

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      {/* Loading/Error Overlay */}
      {isManualRefreshing && (
        <div style={{ 
          position: 'absolute', 
          inset: 0, 
          zIndex: 10, 
          background: 'rgba(15,23,42,0.85)', 
          backdropFilter: 'blur(4px)',
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: 'white',
          animation: 'fadeUp 0.3s ease'
        }}>
          <div style={{ 
            width: 36, 
            height: 36, 
            border: '3px solid rgba(255,255,255,0.1)', 
            borderTopColor: '#3b82f6', 
            borderRadius: '50%', 
            animation: 'spin 1s linear infinite', 
            marginBottom: 12 
          }} />
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>
            🔄 CONNECTING TO EZVIZ CLOUD...
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
            {errorCount > 0 ? `Retry attempt ${errorCount}/20` : 'Establishing secure connection...'}
          </div>
          {errorCount > 5 && (
            <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 12, maxWidth: '80%', textAlign: 'center' }}>
              ⚠️ EZVIZ India servers are responding slowly. Please wait...
            </div>
          )}
        </div>
      )}
      
      {/* Video Element */}
      <video 
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        muted 
        autoPlay 
        playsInline
      />
      
      {/* Hidden retry counter for debugging */}
      {errorCount > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          fontSize: 9,
          color: 'rgba(255,255,255,0.3)',
          background: 'rgba(0,0,0,0.3)',
          padding: '2px 6px',
          borderRadius: 4,
          pointerEvents: 'none'
        }}>
          {errorCount} retries
        </div>
      )}
      
      {/* Double-click hint */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        fontSize: 9,
        color: 'rgba(255,255,255,0.2)',
        pointerEvents: 'none'
      }}>
        Double-click to refresh
      </div>
    </div>
  );
};

export default VideoFeed;