#!/bin/bash

#echo "🚀 Booting WeffAI Architecture..."

# 1. Register the kill switch FIRST so it catches Ctrl+C immediately
#trap "echo '🛑 Shutting down all services...'; kill \$MTX_PID \$PYTHON_PID 2>/dev/null" EXIT

# 2. Extract secure camera credentials from .env
# Using grep to safely grab the values without executing the file
#C_USER=$(grep "^CAMERA_USER=" .env | cut -d '=' -f2 | tr -d '\r')
#C_PASS=$(grep "^CAMERA_PASS=" .env | cut -d '=' -f2 | tr -d '\r')
#C_IP=$(grep "^CAMERA_IP=" .env | cut -d '=' -f2 | tr -d '\r')

# 3. Start MediaMTX WebRTC Bridge (Logs routed to mediamtx.log)
#echo "🟢 Starting MediaMTX WebRTC Bridge..."
#export MTX_PATHS_WORKSTATION1_SOURCE="rtsp://${C_USER}:${C_PASS}@${C_IP}:554/streaming/channels/101/"
#./mediamtx_v1.17.0_darwin_amd64/mediamtx < /dev/null > mediamtx.log 2>&1 &
#MTX_PID=$!

#sleep 2

# 4. Start the Python AI Pipeline (Logs routed to ai_engine.log)
#echo "🟢 Starting Python AI Engine..."
#python3 testing_logic_01.py < /dev/null > ai_engine.log 2>&1 &
#PYTHON_PID=$!

#sleep 2

# 5. Start the React Dashboard & Node Server (Foreground)
#echo "🟢 Starting React Frontend & Node Server..."
#npm start

#!/bin/bash

echo "🚀 Booting WeffAI Architecture (Cloud Edition)..."

# 1. Register the kill switch FIRST so it catches Ctrl+C immediately
trap "echo '🛑 Shutting down all services...'; kill \$MTX_PID \$PYTHON_PID 2>/dev/null" EXIT

# Note: We no longer need to parse .env for camera IPs/Passwords
# because the EZVIZ Cloud API handles secure authentication internally.

# 2. Start the Python AI Pipeline & VLC Bridge FIRST
# This creates the local RTSP stream that MediaMTX will hook into.
# (Make sure this matches the exact name of your new python file)
echo "🟢 Starting Python AI Engine & VLC Bridge..."
python3 ezviz_cloud_setup.py < /dev/null > ai_engine.log 2>&1 &
PYTHON_PID=$!

# Give Python and VLC 10 seconds to fully spin up the RTSP server on port 8554
echo "⏳ Waiting for VLC bridge to initialize..."
sleep 15

# 3. Start MediaMTX WebRTC Bridge
# Pointing directly to the local VLC stream instead of a Tailscale IP
echo "🟢 Starting MediaMTX WebRTC Bridge..."
export MTX_PATHS_WORKSTATION1_SOURCE="rtsp://localhost:8554/stream"
./mediamtx_v1.17.0_darwin_amd64/mediamtx < /dev/null > mediamtx.log 2>&1 &
MTX_PID=$!

sleep 2

# 4. Start the React Dashboard & Node Server (Foreground)
echo "🟢 Starting React Frontend & Node Server..."
npm start