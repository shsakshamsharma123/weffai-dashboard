#!/bin/bash

echo "🚀 Booting WeffAI Architecture..."

# 1. Register the kill switch FIRST so it catches Ctrl+C immediately
trap "echo '🛑 Shutting down all services...'; kill \$MTX_PID \$PYTHON_PID 2>/dev/null" EXIT

# 2. Extract secure camera credentials from .env
# Using grep to safely grab the values without executing the file
C_USER=$(grep "^CAMERA_USER=" .env | cut -d '=' -f2 | tr -d '\r')
C_PASS=$(grep "^CAMERA_PASS=" .env | cut -d '=' -f2 | tr -d '\r')
C_IP=$(grep "^CAMERA_IP=" .env | cut -d '=' -f2 | tr -d '\r')

# 3. Start MediaMTX WebRTC Bridge (Logs routed to mediamtx.log)
echo "🟢 Starting MediaMTX WebRTC Bridge..."
export MTX_PATHS_WORKSTATION1_SOURCE="rtsp://${C_USER}:${C_PASS}@${C_IP}:554/streaming/channels/101/"
./mediamtx_v1.17.0_darwin_amd64/mediamtx < /dev/null > mediamtx.log 2>&1 &
MTX_PID=$!

sleep 2

# 4. Start the Python AI Pipeline (Logs routed to ai_engine.log)
echo "🟢 Starting Python AI Engine..."
python3 testing_logic_01.py < /dev/null > ai_engine.log 2>&1 &
PYTHON_PID=$!

sleep 2

# 5. Start the React Dashboard & Node Server (Foreground)
echo "🟢 Starting React Frontend & Node Server..."
npm start