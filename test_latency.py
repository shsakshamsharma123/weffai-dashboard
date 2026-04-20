import requests
import time
import re
from datetime import datetime

# ==========================================
# EZVIZ CLOUD CONFIGURATION
# ==========================================
APP_KEY = "526595c516eb4797bac8322c0e90244e"
APP_SECRET = "8f8cacf15b834811905363919005380c"
DEVICE_SERIAL = "BE4119693"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def run_diagnostics():
    print("="*60)
    print("🔍 EZVIZ CLOUD LATENCY & STREAM DIAGNOSTICS")
    print("="*60)

    # 1. Fetch Secure Token
    log("1️⃣ Authenticating with EZVIZ Cloud...")
    start_time = time.time()
    
    token_res = requests.post("https://open.ezvizlife.com/api/lapp/token/get", data={
        "appKey": APP_KEY,
        "appSecret": APP_SECRET
    }).json()

    if token_res.get("code") != "200":
        log(f"❌ Authentication Failed: {token_res.get('msg')}")
        return

    token = token_res["data"]["accessToken"]
    log(f"✅ Authenticated in {round((time.time() - start_time)*1000)}ms")

    # 2. Check all available protocols
    log("\n2️⃣ Probing available stream protocols...")
    protocols = {
        "1": "RTMP (Ultra-Low Latency, ~1-3s)",
        "2": "HLS (High Latency, ~15-45s)",
        "3": "FLV (Low Latency, ~2-5s)",
        "4": "WebRTC (Real-Time, <1s)"
    }

    hls_url = None

    for p_id, p_name in protocols.items():
        res = requests.post("https://open.ezvizlife.com/api/lapp/live/address/get", data={
            "accessToken": token,
            "deviceSerial": DEVICE_SERIAL,
            "channelNo": "1",
            "protocol": p_id,
            "quality": "1"
        }).json()

        if res.get("code") == "200":
            url = res["data"]["url"]
            log(f"   🟢 {p_name} is AVAILABLE.")
            print(f"      📋 URL: {url}")
            if p_id == "2":
                hls_url = url
        else:
            log(f"   🔴 {p_name} is BLOCKED/UNAVAILABLE in this region.")

    # 3. Analyze the HLS Manifest (The source of the 30-40s lag)
    if not hls_url:
        log("\n❌ HLS URL not found. Cannot analyze chunk latency.")
        return

    log("\n3️⃣ Analyzing HLS (.m3u8) Stream Chunk Sizes...")
    log(f"   Fetching manifest: {hls_url[:60]}...")
    
    try:
        m3u8_res = requests.get(hls_url, timeout=10)
        m3u8_text = m3u8_res.text
        
        # Look for the #EXTINF tags (these tell us exactly how long each video chunk is)
        chunks = re.findall(r'#EXTINF:([0-9\.]+),', m3u8_text)
        
        if not chunks:
            log("   ⚠️ Manifest returned, but no video chunks found yet (Stream might be spinning up).")
            return

        chunk_floats = [float(c) for c in chunks]
        avg_chunk_size = sum(chunk_floats) / len(chunk_floats)
        total_buffered_time = sum(chunk_floats)
        
        print("-" * 40)
        log(f"   📦 Total Chunks in Playlist : {len(chunks)}")
        log(f"   ⏱️ Average Chunk Duration  : {round(avg_chunk_size, 2)} seconds")
        log(f"   🗄️ Total Buffered Video    : {round(total_buffered_time, 2)} seconds")
        print("-" * 40)
        
        log("\n💡 LATENCY DIAGNOSIS:")
        log(f"   Because EZVIZ generates chunks of ~{round(avg_chunk_size, 1)} seconds,")
        log(f"   and web browsers (hls.js) require at least 3 chunks to start playing smoothly,")
        log(f"   your inherent minimum lag is mathematically forced to be: ~{round(avg_chunk_size * 3)} to {round(total_buffered_time)} seconds.")
        
    except Exception as e:
        log(f"❌ Failed to download/parse HLS manifest: {e}")

    print("\n="*60)

if __name__ == "__main__":
    run_diagnostics()