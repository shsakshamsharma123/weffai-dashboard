'''
import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO
from shapely.geometry import Polygon, Point
from collections import deque
import math
import time
import threading
import subprocess
import requests
from datetime import datetime
import os
import firebase_admin
from firebase_admin import credentials, firestore

# --- EZVIZ CLOUD IMPORTS ---
from ezviz_openapi_utils import Client, EZVIZOpenAPI

# --- GOOGLE DRIVE IMPORTS ---
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2 import service_account

# ==========================================
# 1. CONFIGURATION
# ==========================================
# --- EZVIZ CLOUD CONFIGURATION ---
APP_KEY = "526595c516eb4797bac8322c0e90244e"
APP_SECRET = "186b67a9741e4034905f4b77e5a7691a"
DEVICE_SERIAL = "BE4119693"

POSE_MODEL_PATH  = "yolo11l-pose.pt" #older model again
PHONE_MODEL_PATH = "best (13).pt"

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
def get_video_filename():
    return os.path.join(SCRIPT_DIR, f"Live_Record_{datetime.now().strftime('%Y-%m-%d')}.mp4")

# --- FIREBASE & RATE LIMITING ---
SERVICE_ACCOUNT_KEY = os.path.join(SCRIPT_DIR, "serviceAccountKey.json")
FIREBASE_SYNC_INTERVAL = 2.0  

GDRIVE_FOLDER_ID = "1ZnckEMbKstvH5FG1pgmKnXoZK6PqcEbx"

print("☁️ Initializing Firebase...")
try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Firebase connected successfully!")
except Exception as e:
    print(f"❌ Firebase init failed: {e}")
    db = None

# ==========================================
# 2. CONSOLIDATED ZONE CONFIG
# ==========================================
CONSOLIDATED_ZONES = {
    "left": {
        "desk_ids": [1, 2, 3],
        "work_poly": np.array([[782, 0], [659, 1079], [1010, 1073], [1127, 6], [782, 1]]),
        "seat_poly": np.array([[382, 2], [339, 457], [341, 624], [336, 814], [355, 900],
                               [392, 1040], [414, 1077], [694, 1072], [819, 0], [383, 1]])
    },
    "right": {
        "desk_ids": [4, 5, 6],
        "work_poly": np.array([[1403, 1072], [1472, 784], [1493, 586], [1510, 419], [1527, 252], [1551, 4], [1212, 8], [1138, 1064], [1134, 1073], [1404, 1072]]),
        "seat_poly": np.array([[1490, 10], [1894, 4], [1894, 5], [1854, 595],
                               [1821, 870], [1771, 1064], [1366, 1068], [1452, 646],
                               [1480, 423], [1489, 15]])
    }
}

DESK_CONFIG = [
    { "id": 1, "min_std": 1.8, "side": "left"  },
    { "id": 2, "min_std": 2.0, "side": "left"  },
    { "id": 3, "min_std": 2.0, "side": "left"  },
    { "id": 4, "min_std": 3.8, "side": "right" },
    { "id": 5, "min_std": 2.0, "side": "right" },
    { "id": 6, "min_std": 1.8, "side": "right" },
]

FRAME_HEIGHT = 1080  

# ==========================================
# 3. GOOGLE DRIVE UPLOAD LOGIC
# ==========================================
def upload_video_to_drive(file_path):
    print(f"☁️ Uploading {file_path} to Google Drive...")
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_KEY, scopes=['https://www.googleapis.com/auth/drive.file']
        )
        service = build('drive', 'v3', credentials=creds)

        file_metadata = {'name': os.path.basename(file_path), 'parents': [GDRIVE_FOLDER_ID]}
        media = MediaFileUpload(file_path, mimetype='video/mp4', resumable=True)
        file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        print(f"✅ Successfully uploaded to Drive. File ID: {file.get('id')}")
        os.remove(file_path)
    except Exception as e:
        print(f"❌ Google Drive upload failed: {e}")

# ==========================================
# 4. EZVIZ CLOUD CAPTURE & VIDEO WRITER
# ==========================================
class EZVIZCloudCapture:
    """
    Robust EZVIZ Cloud capture using FFmpeg Subprocess.
    Forces HLS (Protocol 2) as EZVIZ RTMP/FLV endpoints are dead in this region.
    Replaces local RTSP dependency.
    """
    def __init__(self, width=1920, height=1080, fps=25):
        self.width = width
        self.height = height
        self.fps = fps
        self.frame_size = width * height * 3
        
        self.current_url = None
        self.process = None
        self.ret = False
        self.frame = None
        self.running = True
        self._lock = threading.Lock()
        
        # Stats
        self.reconnect_count = 0
        self.last_successful_frame = time.time()
        
        # Start capture
        self._initialize_stream()
        
        # Start background reader thread
        self.t = threading.Thread(target=self._reader_thread, daemon=True)
        self.t.start()
        
        # Wait for first frame
        print("⏳ Waiting for first frame from EZVIZ Cloud (HLS)...")
        for i in range(45):
            if self.ret:
                print(f"✅ Cloud HLS stream acquired successfully!")
                break
            time.sleep(1.0)
            if i % 5 == 0 and i > 0:
                print(f"   Still buffering HLS chunks... ({i}/45)")
    
    def _get_client_and_token(self):
        """Get fresh client and token"""
        client = Client(app_key=APP_KEY, app_secret=APP_SECRET, region="in")
        api = EZVIZOpenAPI(client)
        base_url = client._access_token.data.area_domain
        token = client.access_token
        return base_url, token
    
    def _get_hls_url(self):
        """Get the HLS stream URL from the cloud (Protocol 2)"""
        try:
            base_url, token = self._get_client_and_token()
        except Exception as e:
            print(f"❌ Failed to get API token: {e}")
            return None
        
        print(f"📡 Requesting HLS stream from EZVIZ API...")
        try:
            params = {
                "accessToken": token,
                "deviceSerial": DEVICE_SERIAL,
                "channelNo": 1,
                "protocol": 2, # 2 = HLS 
                "quality": 1   # 1 = HD
            }
            resp = requests.post(f"{base_url}/api/lapp/live/address/get", data=params, timeout=10)
            result = resp.json()
            if result.get("code") == "200":
                return result["data"]["url"]
            else:
                print(f"   ⚠️ API returned error: {result.get('msg')}")
                return None
        except Exception as e:
            print(f"   ⚠️ Exception getting HLS URL: {e}")
            return None
            
    def _initialize_stream(self):
        """Establish FFmpeg subprocess connection to the URL"""
        if self.process:
            try:
                self.process.kill()
                self.process.wait(timeout=2)
            except:
                pass
            
        self.current_url = self._get_hls_url()
        if not self.current_url:
            print("⚠️ Could not retrieve URL. Retrying in 5s...")
            time.sleep(5)
            return

        print(f"🚀 Starting FFmpeg for HLS stream...")
        command = [
            'ffmpeg',
            '-hide_banner',
            '-loglevel', 'error',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-rw_timeout', '15000000',      
            '-analyzeduration', '1000000',  
            '-probesize', '1000000',        
            '-f', 'hls',                    # Force HLS demuxer
            '-i', self.current_url,
            '-f', 'image2pipe',             
            '-pix_fmt', 'bgr24',            
            '-vcodec', 'rawvideo',
            '-an',                          
            '-vf', f'scale={self.width}:{self.height},fps={self.fps}', # Forced 1920x1080 to keep zones accurate
            '-'
        ]
        
        try:
            self.process = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                bufsize=self.frame_size * 2
            )
            self.reconnect_count += 1
        except FileNotFoundError:
            print("❌ FFmpeg is not installed or not in your PATH!")
            self.running = False
        
    def _reader_thread(self):
        url_refresh_time = time.time()
        URL_REFRESH_INTERVAL = 5400  
        
        while self.running:
            if time.time() - url_refresh_time > URL_REFRESH_INTERVAL:
                print("🔄 Refreshing stream URL (token expiry)...")
                self._initialize_stream()
                url_refresh_time = time.time()
                continue
                
            if self.process and self.process.stdout:
                try:
                    raw_bytes = self.process.stdout.read(self.frame_size)
                    if len(raw_bytes) == self.frame_size:
                        frame_array = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((self.height, self.width, 3))
                        with self._lock:
                            self.ret = True
                            self.frame = frame_array.copy()
                            self.last_successful_frame = time.time()
                    else:
                        with self._lock:
                            self.ret = False
                        time.sleep(2)
                        if self.running:
                            self._initialize_stream()
                except Exception as e:
                    with self._lock:
                        self.ret = False
                    time.sleep(2)
                    if self.running:
                        self._initialize_stream()
            else:
                time.sleep(1)
                    
    def read(self):
        with self._lock:
            return self.ret, (self.frame.copy() if self.frame is not None else None)

    def release(self):
        self.running = False
        if self.process:
            self.process.kill()


class FFmpegVideoWriter:
    def __init__(self, output_path, width=1920, height=1080, fps=25):
        self.output_path = output_path
        self.opened = False
        command = [
            "ffmpeg", "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", f"{width}x{height}", "-pix_fmt", "bgr24", "-r", str(fps),
            "-i", "-", "-vcodec", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "ultrafast", "-crf", "23", output_path
        ]
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.opened = True
        except Exception as e:
            print(f"❌ FFmpeg Writer error: {e}")

    def write(self, frame):
        if self.opened:
            try: self.process.stdin.write(frame.tobytes())
            except BrokenPipeError: self.opened = False

    def release(self):
        if self.opened:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=10)
            except: self.process.kill()

class VideoWriterThread(threading.Thread):
    def __init__(self, cam, writer):
        super().__init__(daemon=True)
        self.cam = cam
        self.writer = writer
        self.running = True
        self.frame_time = 1.0 / 25.0

    def run(self):
        while self.running:
            start_time = time.time()
            ret, frame = self.cam.read()
            if ret and frame is not None: self.writer.write(frame)
            elapsed = time.time() - start_time
            if self.frame_time > elapsed: time.sleep(self.frame_time - elapsed)

# ==========================================
# 5. HELPER FUNCTIONS
# ==========================================
def is_point_in_poly(point, poly_points): return Polygon(poly_points).contains(Point(point))
def point_in_rect(pt, x1, y1, x2, y2): return x1 <= pt[0] <= x2 and y1 <= pt[1] <= y2
def get_iou(box1, box2):
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2
    xi1, yi1 = max(x1_1, x1_2), max(y1_1, y1_2)
    xi2, yi2 = min(x2_1, x2_2), min(y2_1, y2_2)
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    union = ((x2_1-x1_1)*(y2_1-y1_1)) + ((x2_2-x1_2)*(y2_2-y1_2)) - inter
    return inter / union if union > 0 else 0

def calculate_std_dev(history):
    if len(history) < 3: return 0.0, 0.0, 0.0
    xs, ys = [pt[0] for pt in history], [pt[1] for pt in history]
    return float(np.mean(xs)), float(np.mean(ys)), (float(np.std(xs)) + float(np.std(ys))) / 2.0

def assign_desk_id_by_y(side, y_pos):
    segment = FRAME_HEIGHT / 3.0
    if side == "left":
        if y_pos < segment:             return 3
        elif y_pos < segment * 2:       return 2
        else:                           return 1
    else:  
        if y_pos < segment:             return 6
        elif y_pos < segment * 2:       return 5
        else:                           return 4


# ==========================================
# 6. POSE-AWARE ZONE & TIME STATE MACHINE
# ==========================================
class DeskState:
    def __init__(self, desk_cfg, fps, zone_cfg):
        self.desk_cfg = desk_cfg
        self.desk_id  = desk_cfg["id"]
        self.fps      = fps
        self.min_std  = desk_cfg["min_std"]
        self.zone_cfg = zone_cfg          
        self.state    = "AWAY"
        
        self.total_frames = 0
        self.state_counts = { "Working": 0, "Idle": 0, "Distracted": 0, "Away": 0 }

        # Memory Buffers
        self.centroid_hist = deque(maxlen=int(15.0 * fps)) 
        self.l_wrist_hist  = deque(maxlen=int(3.0 * fps))   
        self.r_wrist_hist  = deque(maxlen=int(3.0 * fps))
        
        self.time_since_last_seen = 0.0
        self.out_of_zone_timer    = 0.0
        self.still_timer          = 0.0

    def _reset_state(self):
        self.centroid_hist.clear()
        self.l_wrist_hist.clear()
        self.r_wrist_hist.clear()
        self.out_of_zone_timer = 0.0
        self.still_timer       = 0.0

    def mark_away(self):
        self.state = "AWAY"
        self._reset_state()

    def get_dashboard_payload(self):
        t = max(1, self.total_frames)
        return {
            "liveRaw":     self.state,
            "totalFrames": self.total_frames,
            "working":     int((self.state_counts["Working"]    / t) * 100),
            "idle":        int((self.state_counts["Idle"]       / t) * 100),
            "distracted":  int((self.state_counts["Distracted"] / t) * 100),
            "away":        int((self.state_counts["Away"]       / t) * 100),
            "raw_counts":  self.state_counts 
        }

    def update(self, dt, kps, phone_boxes, center):
        self.time_since_last_seen = 0.0
        self.centroid_hist.append(center)

        # 1. Safely extract keypoints
        if len(kps) > 10:
            l_wrist, r_wrist = kps[9], kps[10]
            if l_wrist[2] > 0.4: self.l_wrist_hist.append((l_wrist[0], l_wrist[1]))
            if r_wrist[2] > 0.4: self.r_wrist_hist.append((r_wrist[0], r_wrist[1]))
        else:
            l_wrist, r_wrist = [0,0,0], [0,0,0]

        l_elbow = kps[7] if len(kps) > 7 else [0,0,0]
        r_elbow = kps[8] if len(kps) > 8 else [0,0,0]

        # 2. Distraction Check
        is_scrolling_phone = False
        for ph_box in phone_boxes:
            x1, y1 = ph_box[0] - 30, ph_box[1] - 30
            x2, y2 = ph_box[2] + 30, ph_box[3] + 30
            if point_in_rect(center, x1, y1, x2, y2): is_scrolling_phone = True
            if l_wrist[2] > 0.4 and point_in_rect((l_wrist[0], l_wrist[1]), x1, y1, x2, y2): is_scrolling_phone = True
            if r_wrist[2] > 0.4 and point_in_rect((r_wrist[0], r_wrist[1]), x1, y1, x2, y2): is_scrolling_phone = True
            if l_elbow[2] > 0.4 and point_in_rect((l_elbow[0], l_elbow[1]), x1, y1, x2, y2): is_scrolling_phone = True
            if r_elbow[2] > 0.4 and point_in_rect((r_elbow[0], r_elbow[1]), x1, y1, x2, y2): is_scrolling_phone = True

        if is_scrolling_phone:
            self.state = "DISTRACTED"
            self._tally_state()
            return

        # 3. Ghost Chair Check
        if len(self.centroid_hist) >= self.fps * 10:
            _, _, center_std = calculate_std_dev(self.centroid_hist)
            if center_std < 0.3:
                self.mark_away()
                self._tally_state()
                return

        # 4. ZONE CHECK LOGIC
        in_work_zone = False
        if is_point_in_poly(center, self.zone_cfg["work_poly"]):
            in_work_zone = True
        elif l_wrist[2] > 0.4 and is_point_in_poly((l_wrist[0], l_wrist[1]), self.zone_cfg["work_poly"]):
            in_work_zone = True
        elif r_wrist[2] > 0.4 and is_point_in_poly((r_wrist[0], r_wrist[1]), self.zone_cfg["work_poly"]):
            in_work_zone = True

        if not in_work_zone:
            self.out_of_zone_timer += dt
            self.still_timer = 0.0 
            
            if self.out_of_zone_timer >= 120.0:
                self.state = "PASSIVE WORKING"
            else:
                self.state = "WORKING" 
        else:
            self.out_of_zone_timer = 0.0
            _, _, l_std = calculate_std_dev(self.l_wrist_hist)
            _, _, r_std = calculate_std_dev(self.r_wrist_hist)
            
            if max(l_std, r_std) >= self.min_std or len(self.l_wrist_hist) < self.fps * 2:
                self.still_timer = 0.0
                self.state = "WORKING"
            else:
                self.still_timer += dt
                if self.still_timer >= 120.0:
                    self.state = "PASSIVE WORKING"
                else:
                    self.state = "WORKING"

        self._tally_state()

    def apply_absence(self, dt):
        self.time_since_last_seen += dt
        if self.time_since_last_seen > 15.0: # 15-second tracking buffer
            self.mark_away()
        self._tally_state()

    def _tally_state(self):
        self.total_frames += 1
        if self.state == "WORKING": self.state_counts["Working"] += 1
        elif self.state == "PASSIVE WORKING": self.state_counts["Idle"] += 1
        elif self.state == "DISTRACTED": self.state_counts["Distracted"] += 1
        else: self.state_counts["Away"] += 1


# ==========================================
# 7. FIREBASE PUSH (ASYNC)
# ==========================================
last_firebase_push_time = 0

def push_to_firestore_rate_limited(desk_states):
    global last_firebase_push_time
    if db is None: return

    current_time = time.time()
    if current_time - last_firebase_push_time < FIREBASE_SYNC_INTERVAL:
        return

    last_firebase_push_time = current_time
    now_str = datetime.now().strftime("%H:%M:%S")
    today_str = datetime.now().strftime("%Y-%m-%d")

    payload = {"timestamp": now_str, "updatedAt": firestore.SERVER_TIMESTAMP, "workers": {}}
    for d_id, desk in desk_states.items():
        payload["workers"][f"W00{d_id}"] = desk.get_dashboard_payload()

    def fire_and_forget(payload_data, doc_date):
        try:
            db.collection("live_workstations").document("Workstation-1").set(payload_data)
            db.collection("daily_stats").document(doc_date).set(payload_data, merge=True)
            print(f"[☁️ SYNC @ {payload_data['timestamp']}] Firebase Updated.")
        except Exception as e:
            print(f"❌ Async Firebase Sync Failed: {e}")

    threading.Thread(target=fire_and_forget, args=(payload, today_str), daemon=True).start()


# ==========================================
# 8. MAIN LOOP
# ==========================================
def main():
    print("🚀 Initializing POSE PIPELINE (With Cloud HLS Bypass)")

    pose_model  = YOLO(POSE_MODEL_PATH, task='pose')
    phone_model = YOLO(PHONE_MODEL_PATH)
    tracker     = sv.ByteTrack(track_activation_threshold=0.25, minimum_matching_threshold=0.5, frame_rate=30)

    desk_states = { d["id"]: DeskState(d, 30, CONSOLIDATED_ZONES[d["side"]]) for d in DESK_CONFIG }
    
    track_to_desk = {} 

    # --- RESTORE PREVIOUS SESSION DATA ---
    today_str = datetime.now().strftime("%Y-%m-%d")
    print(f"🔍 Checking for existing data for today ({today_str})...")
    if db is not None:
        try:
            doc_ref = db.collection("daily_stats").document(today_str)
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict()
                if "workers" in data:
                    for d_id, desk in desk_states.items():
                        w_id = f"W00{d_id}"
                        if w_id in data["workers"]:
                            w_data = data["workers"][w_id]
                            desk.total_frames = w_data.get("totalFrames", 0)
                            if "raw_counts" in w_data: desk.state_counts = w_data["raw_counts"]
                    print("✅ Successfully restored today's accumulated data!")
        except Exception as e:
            pass
    # ----------------------------------------------------

    # --- REPLACED LOCAL RTSP WITH EZVIZ CLOUD CAPTURE ---
    cam = EZVIZCloudCapture(width=1920, height=1080, fps=25)
    
    current_date       = datetime.now().date()
    current_video_file = get_video_filename()
    writer             = FFmpegVideoWriter(current_video_file, width=1920, height=1080, fps=25)
    writer_thread      = VideoWriterThread(cam, writer)
    writer_thread.start()

    print("🎬 Pipeline Running Indefinitely via EZVIZ Cloud...")
    last_time = time.time()

    try:
        while True:
            current_time = time.time()

            # --- MIDNIGHT ROLLOVER ---
            now_date = datetime.now().date()
            if now_date > current_date:
                writer_thread.running = False
                writer_thread.join()
                writer.release()
                threading.Thread(target=upload_video_to_drive, args=(current_video_file,)).start()
                
                current_date = now_date
                current_video_file = get_video_filename()
                writer = FFmpegVideoWriter(current_video_file, width=1920, height=1080, fps=25)
                writer_thread = VideoWriterThread(cam, writer)
                writer_thread.start()
                
                track_to_desk.clear() 
                for d_id in desk_states:
                    desk_states[d_id]._reset_state()
                    desk_states[d_id].total_frames = 0
                    desk_states[d_id].state_counts = {"Working": 0, "Idle": 0, "Distracted": 0, "Away": 0}

            ret, frame = cam.read()
            if not ret or frame is None:
                time.sleep(0.1)
                continue

            dt        = current_time - last_time
            last_time = current_time

            pose_results  = pose_model(frame, imgsz=640, verbose=False, conf=0.50)[0]
            phone_results = phone_model(frame, imgsz=640, verbose=False, conf=0.25)[0]

            phone_boxes = [box.xyxy.cpu().numpy()[0] for box in phone_results.boxes if int(box.cls[0]) == 0] if phone_results.boxes else []
            detections  = sv.Detections.from_ultralytics(pose_results)
            tracked_detections = tracker.update_with_detections(detections)
            kps_list    = (pose_results.keypoints.data.cpu().numpy() if pose_results.keypoints else [])
            pose_boxes  = pose_results.boxes.xyxy.cpu().numpy()

            desks_updated_this_frame = set()

            for i in range(len(tracked_detections)):
                t_id  = tracked_detections.tracker_id[i]
                t_box = tracked_detections.xyxy[i]
                
                best_iou, best_idx = 0, -1
                for j, p_box in enumerate(pose_boxes):
                    iou = get_iou(t_box, p_box)
                    if iou > best_iou: best_iou, best_idx = iou, j

                kps = kps_list[best_idx] if best_iou > 0.5 and best_idx != -1 else []
                center = ((t_box[0]+t_box[2])/2, (t_box[1]+t_box[3])/2)

                if t_id not in track_to_desk:
                    for side, zone in CONSOLIDATED_ZONES.items():
                        if is_point_in_poly(center, zone["seat_poly"]) or is_point_in_poly(center, zone["work_poly"]):
                            assigned_d_id = assign_desk_id_by_y(side, center[1])
                            track_to_desk[t_id] = assigned_d_id
                            break
                
                assigned_d_id = track_to_desk.get(t_id)

                if assigned_d_id and assigned_d_id not in desks_updated_this_frame:
                    desk_states[assigned_d_id].update(dt, kps, phone_boxes, center)
                    desks_updated_this_frame.add(assigned_d_id)

            for d_id, desk in desk_states.items():
                if d_id not in desks_updated_this_frame:
                    desk.apply_absence(dt)

            push_to_firestore_rate_limited(desk_states)

    except KeyboardInterrupt:
        print("\n🛑 Shutting down gracefully...")
    finally:
        writer_thread.running = False
        writer_thread.join()
        cam.release()
        writer.release()
        print("✅ Pipeline Offline.")

if __name__ == "__main__":
    main()
'''
import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO
from shapely.geometry import Polygon, Point
from collections import deque
import math
import time
import threading
import subprocess
import requests
from datetime import datetime
import os
import sys
import socket
import shutil
import firebase_admin
from firebase_admin import credentials, firestore

# --- EZVIZ CLOUD IMPORTS ---
from ezviz_openapi_utils import Client, EZVIZOpenAPI

# --- GOOGLE DRIVE IMPORTS ---
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2 import service_account

# ==========================================
# 1. CONFIGURATION
# ==========================================
# --- EZVIZ CLOUD CONFIGURATION ---
APP_KEY = "526595c516eb4797bac8322c0e90244e"
APP_SECRET = "8f8cacf15b834811905363919005380c"
DEVICE_SERIAL = "BE4119693"
VERIFICATION_CODE = "CBKLVW"  # Camera verification code for EZOPEN fallback

POSE_MODEL_PATH  = "yolo11l-pose.pt"
PHONE_MODEL_PATH = "best (13).pt"

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
def get_video_filename():
    return os.path.join(SCRIPT_DIR, f"Live_Record_{datetime.now().strftime('%Y-%m-%d')}.mp4")

# --- FIREBASE & RATE LIMITING ---
SERVICE_ACCOUNT_KEY = os.path.join(SCRIPT_DIR, "serviceAccountKey.json")
FIREBASE_SYNC_INTERVAL = 2.0  

GDRIVE_FOLDER_ID = "1ZnckEMbKstvH5FG1pgmKnXoZK6PqcEbx"

print("☁️ Initializing Firebase...")
try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Firebase connected successfully!")
except Exception as e:
    print(f"❌ Firebase init failed: {e}")
    db = None

# ==========================================
# 2. CONSOLIDATED ZONE CONFIG
# ==========================================
CONSOLIDATED_ZONES = {
    "left": {
        "desk_ids": [1, 2, 3],
        "work_poly": np.array([[782, 0], [659, 1079], [1010, 1073], [1127, 6], [782, 1]]),
        "seat_poly": np.array([[382, 2], [339, 457], [341, 624], [336, 814], [355, 900],
                               [392, 1040], [414, 1077], [694, 1072], [819, 0], [383, 1]])
    },
    "right": {
        "desk_ids": [4, 5, 6],
        "work_poly": np.array([[1403, 1072], [1472, 784], [1493, 586], [1510, 419], [1527, 252], [1551, 4], [1212, 8], [1138, 1064], [1134, 1073], [1404, 1072]]),
        "seat_poly": np.array([[1490, 10], [1894, 4], [1894, 5], [1854, 595],
                               [1821, 870], [1771, 1064], [1366, 1068], [1452, 646],
                               [1480, 423], [1489, 15]])
    }
}

DESK_CONFIG = [
    { "id": 1, "min_std": 1.8, "side": "left"  },
    { "id": 2, "min_std": 2.0, "side": "left"  },
    { "id": 3, "min_std": 2.0, "side": "left"  },
    { "id": 4, "min_std": 3.8, "side": "right" },
    { "id": 5, "min_std": 2.0, "side": "right" },
    { "id": 6, "min_std": 1.8, "side": "right" },
]

FRAME_HEIGHT = 1080  

# ==========================================
# 3. GOOGLE DRIVE UPLOAD LOGIC
# ==========================================
def upload_video_to_drive(file_path):
    print(f"☁️ Uploading {file_path} to Google Drive...")
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_KEY, scopes=['https://www.googleapis.com/auth/drive.file']
        )
        service = build('drive', 'v3', credentials=creds)

        file_metadata = {'name': os.path.basename(file_path), 'parents': [GDRIVE_FOLDER_ID]}
        media = MediaFileUpload(file_path, mimetype='video/mp4', resumable=True)
        file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        print(f"✅ Successfully uploaded to Drive. File ID: {file.get('id')}")
        os.remove(file_path)
    except Exception as e:
        print(f"❌ Google Drive upload failed: {e}")

# ==========================================
# 4. VLC BRIDGE CAPTURE (ULTRA-LOW LATENCY)
# ==========================================
class EZVIZVLCCapture:
    """
    Ultra-low latency EZVIZ Cloud capture using VLC as bridge.
    VLC handles HLS/EZOPEN with minimal buffering (1-3 second lag).
    OpenCV connects to local RTSP stream from VLC.
    """
    def __init__(self, width=1920, height=1080, fps=25):
        self.width = width
        self.height = height
        self.fps = fps
        self.local_rtsp_port = 8554
        self.local_rtsp_url = f"rtsp://localhost:{self.local_rtsp_port}/stream"
        
        self.vlc_process = None
        self.cap = None
        self.ret = False
        self.frame = None
        self.running = True
        self._lock = threading.Lock()
        
        # Stats
        self.reconnect_count = 0
        self.last_successful_frame = time.time()
        self.current_protocol = None
        
        # Start VLC bridge and connect OpenCV
        self._start_vlc_bridge()
        self._connect_opencv()
        
        # Start watchdog thread for monitoring
        self.watchdog = threading.Thread(target=self._watchdog, daemon=True)
        self.watchdog.start()
        
        print("✅ VLC Bridge capture ready (Ultra-Low Latency Mode)")
    
    def _get_client_and_token(self):
        """Get fresh client and token from EZVIZ API"""
        client = Client(app_key=APP_KEY, app_secret=APP_SECRET, region="in")
        api = EZVIZOpenAPI(client)
        base_url = client._access_token.data.area_domain
        token = client.access_token
        return base_url, token
    
    def _get_hls_url(self):
        """Get HLS stream URL from EZVIZ Cloud"""
        try:
            base_url, token = self._get_client_and_token()
            params = {
                "accessToken": token,
                "deviceSerial": DEVICE_SERIAL,
                "channelNo": 1,
                "protocol": 2,  # HLS
                "quality": 1    # HD
            }
            resp = requests.post(f"{base_url}/api/lapp/live/address/get", data=params, timeout=10)
            result = resp.json()
            if result.get("code") == "200":
                self.current_protocol = "HLS"
                return result["data"]["url"]
        except Exception as e:
            print(f"⚠️ HLS URL fetch failed: {e}")
        return None
    
    def _get_ezopen_url(self):
        """Construct EZOPEN URL directly (no API call needed)"""
        self.current_protocol = "EZOPEN"
        return f"ezopen://{VERIFICATION_CODE}@iindiaopen.ezvizlife.com/{DEVICE_SERIAL}/1.hd.live"
    
    def _check_vlc_health(self):
        """Check if VLC process is responsive"""
        if self.vlc_process is None:
            return False
        
        # Check if process is alive
        if self.vlc_process.poll() is not None:
            return False
        
        # Try to connect to RTSP port
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex(('localhost', self.local_rtsp_port))
            sock.close()
            return result == 0
        except:
            return False
    
    def _start_vlc_bridge(self):
        """Start VLC as local RTSP server with minimal buffering"""
        
        # Try HLS first, fallback to EZOPEN
        stream_url = self._get_hls_url()
        if not stream_url:
            print("⚠️ HLS failed, falling back to EZOPEN protocol...")
            stream_url = self._get_ezopen_url()
        
        if not stream_url:
            raise Exception("❌ Could not get stream URL from any protocol")
        
        print(f"🎬 Starting VLC bridge with {self.current_protocol} protocol...")
        print(f"📡 Stream URL: {stream_url[:80]}..." if len(stream_url) > 80 else f"📡 Stream URL: {stream_url}")
        
        # Kill any existing VLC on this port
        subprocess.run(['pkill', '-f', f'VLC.*:{self.local_rtsp_port}'], 
                      stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        time.sleep(1)
        
        # Confirmed VLC path on macOS
        vlc_exe = '/Applications/VLC.app/Contents/MacOS/VLC'
        
        if not os.path.exists(vlc_exe):
            # Try alternative paths
            alt_paths = ['/usr/local/bin/vlc', '/opt/homebrew/bin/vlc']
            for alt in alt_paths:
                if os.path.exists(alt):
                    vlc_exe = alt
                    break
            else:
                raise FileNotFoundError(f"VLC not found at {vlc_exe}")
        
        print(f"✅ Using VLC: {vlc_exe}")
        
        # VLC command with ULTRA-LOW latency settings
        vlc_cmd = [
            vlc_exe,
            stream_url,
            '--sout', f'#transcode{{vcodec=h264,width={self.width},height={self.height},fps={self.fps},acodec=none,threads=2}}:rtp{{sdp=rtsp://:{self.local_rtsp_port}/stream}}',
            '--sout-keep',
            '--sout-all',
            
            # CRITICAL: Ultra-low latency settings
            '--network-caching=500',        # 500ms buffer
            '--live-caching=300',           # 300ms live buffer
            '--clock-synchro=0',            # Disable clock sync
            '--hls-live-restart',           # Restart on disconnect
            '--avcodec-hw', 'none',         # Disable hardware acceleration
            
            # Additional optimizations
            '--no-audio',
            '--no-video-title-show',
            '--no-keyboard-events',
            '--no-mouse-events',
            '--verbose=0',                  # Minimal logging
            '-I', 'dummy'                   # No GUI
        ]
        
        try:
            env = os.environ.copy()
            env['DISPLAY'] = ':0'
            env['VLC_VERBOSE'] = '0'
            
            self.vlc_process = subprocess.Popen(
                vlc_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                bufsize=0,
                env=env
            )
            self.reconnect_count += 1
            print(f"⏳ VLC initializing (waiting 6 seconds for RTSP server)...")
            time.sleep(6)
            
            # Check if VLC is still running
            if self.vlc_process.poll() is not None:
                stderr = self.vlc_process.stderr.read().decode('utf-8', errors='ignore')
                print(f"❌ VLC died during startup. Error: {stderr[-500:]}")
                raise Exception("VLC failed to start")
            
            print(f"✅ VLC RTSP server running on port {self.local_rtsp_port}")
            
        except Exception as e:
            print(f"❌ Failed to start VLC: {e}")
            raise
    
    def _connect_opencv(self):
        """Connect OpenCV to local VLC RTSP stream"""
        print(f"📹 Connecting OpenCV to {self.local_rtsp_url}...")
        
        # Wait for RTSP server to be ready
        max_wait = 20
        for i in range(max_wait):
            if self._check_vlc_health():
                print(f"✅ RTSP server is ready after {i+1} seconds")
                break
            time.sleep(1)
        else:
            print("⚠️ RTSP server not responding, trying anyway...")
        
        max_retries = 15
        for i in range(max_retries):
            try:
                self.cap = cv2.VideoCapture(self.local_rtsp_url)
                
                # Optimize OpenCV for low latency
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'H264'))
                self.cap.set(cv2.CAP_PROP_FPS, self.fps)
                
                # Test reading multiple frames
                for _ in range(5):
                    ret, frame = self.cap.read()
                    if ret and frame is not None:
                        h, w = frame.shape[:2]
                        if w == self.width and h == self.height:
                            with self._lock:
                                self.ret = True
                                self.frame = frame.copy()
                                self.last_successful_frame = time.time()
                            print(f"✅ OpenCV connected! Frame: {w}x{h} @ {self.fps}fps")
                            return
                        else:
                            print(f"⚠️ Wrong dimensions: {w}x{h}, expected {self.width}x{self.height}")
                            break
                    time.sleep(0.1)
                
                print(f"   Retry {i+1}/{max_retries}...")
                
            except Exception as e:
                print(f"   Retry {i+1}/{max_retries} - Error: {e}")
            
            if self.cap:
                self.cap.release()
                self.cap = None
            
            time.sleep(1)
        
        raise Exception("❌ Could not connect OpenCV to VLC RTSP stream")
    
    def _restart_bridge(self):
        """Restart VLC bridge if it dies"""
        print("🔄 Restarting VLC bridge...")
        
        with self._lock:
            self.ret = False
        
        if self.cap:
            self.cap.release()
            self.cap = None
        
        if self.vlc_process:
            try:
                self.vlc_process.terminate()
                self.vlc_process.wait(timeout=5)
            except:
                self.vlc_process.kill()
        
        try:
            self._start_vlc_bridge()
            self._connect_opencv()
        except Exception as e:
            print(f"❌ Failed to restart VLC bridge: {e}")
    
    def _watchdog(self):
        """Monitor VLC and OpenCV health"""
        while self.running:
            time.sleep(10)
            
            if not self.running:
                break
            
            vlc_dead = False
            if self.vlc_process and self.vlc_process.poll() is not None:
                print("⚠️ Watchdog: VLC process died")
                vlc_dead = True
            
            time_since_last_frame = time.time() - self.last_successful_frame
            if time_since_last_frame > 15:
                print(f"⚠️ Watchdog: No frames for {time_since_last_frame:.0f}s")
                vlc_dead = True
            
            if vlc_dead:
                self._restart_bridge()
    
    def read(self):
        """Return current frame (OpenCV-compatible interface)"""
        if self.cap and self.cap.isOpened():
            try:
                ret, frame = self.cap.read()
                with self._lock:
                    self.ret = ret
                    if ret and frame is not None:
                        self.frame = frame.copy()
                        self.last_successful_frame = time.time()
                return ret, frame
            except Exception as e:
                print(f"⚠️ OpenCV read error: {e}")
                with self._lock:
                    self.ret = False
        
        return False, None
    
    def get_stats(self):
        """Get stream statistics"""
        return {
            "protocol": self.current_protocol,
            "reconnect_count": self.reconnect_count,
            "last_frame": datetime.fromtimestamp(self.last_successful_frame).strftime("%H:%M:%S") if self.ret else "None",
            "is_connected": self.ret,
            "latency": "1-3 seconds"
        }
    
    def release(self):
        """Clean up resources"""
        print(f"\n📴 Releasing VLC bridge (Total reconnects: {self.reconnect_count})")
        self.running = False
        
        if hasattr(self, 'watchdog'):
            self.watchdog.join(timeout=2)
        
        if self.cap:
            self.cap.release()
        
        if self.vlc_process:
            self.vlc_process.terminate()
            try:
                self.vlc_process.wait(timeout=5)
            except:
                self.vlc_process.kill()
        
        subprocess.run(['pkill', '-f', f'VLC.*:{self.local_rtsp_port}'], 
                      stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)


# ==========================================
# 5. FALLBACK: FFMPEG HLS CAPTURE (Higher Latency)
# ==========================================
class EZVIZCloudCapture:
    """
    Fallback capture using FFmpeg HLS (higher latency but more compatible).
    Used if VLC bridge fails.
    """
    def __init__(self, width=1920, height=1080, fps=25):
        self.width = width
        self.height = height
        self.fps = fps
        self.frame_size = width * height * 3
        
        self.current_url = None
        self.process = None
        self.ret = False
        self.frame = None
        self.running = True
        self._lock = threading.Lock()
        
        self.reconnect_count = 0
        self.last_successful_frame = time.time()
        
        self._initialize_stream()
        
        self.t = threading.Thread(target=self._reader_thread, daemon=True)
        self.t.start()
        
        print("⏳ Waiting for first frame from EZVIZ Cloud (HLS)...")
        for i in range(45):
            if self.ret:
                print(f"✅ Cloud HLS stream acquired successfully!")
                break
            time.sleep(1.0)
            if i % 5 == 0 and i > 0:
                print(f"   Still buffering HLS chunks... ({i}/45)")
    
    def _get_client_and_token(self):
        client = Client(app_key=APP_KEY, app_secret=APP_SECRET, region="in")
        api = EZVIZOpenAPI(client)
        base_url = client._access_token.data.area_domain
        token = client.access_token
        return base_url, token
    
    def _get_hls_url(self):
        try:
            base_url, token = self._get_client_and_token()
            params = {
                "accessToken": token,
                "deviceSerial": DEVICE_SERIAL,
                "channelNo": 1,
                "protocol": 2,
                "quality": 1
            }
            resp = requests.post(f"{base_url}/api/lapp/live/address/get", data=params, timeout=10)
            result = resp.json()
            if result.get("code") == "200":
                return result["data"]["url"]
        except Exception as e:
            print(f"⚠️ Exception getting HLS URL: {e}")
        return None
            
    def _initialize_stream(self):
        if self.process:
            try:
                self.process.kill()
                self.process.wait(timeout=2)
            except:
                pass
            
        self.current_url = self._get_hls_url()
        if not self.current_url:
            print("⚠️ Could not retrieve URL. Retrying in 5s...")
            time.sleep(5)
            return

        command = [
            'ffmpeg',
            '-hide_banner', '-loglevel', 'error',
            
            # AGGRESSIVE RECONNECTION
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '2',      # 2 seconds max delay (was 5)
            '-rw_timeout', '5000000',         # 5 second timeout (was 15)
            
            # REDUCE BUFFERING
            '-analyzeduration', '500000',     # 0.5 seconds (was 1M)
            '-probesize', '500000',           # 0.5 seconds (was 1M)
            
            # INPUT
            '-f', 'hls',
            '-i', self.current_url,
            
            # OUTPUT - LOWER LATENCY
            '-f', 'image2pipe',
            '-pix_fmt', 'bgr24',
            '-vcodec', 'rawvideo',
            '-an',
            '-vf', f'scale={self.width}:{self.height},fps={self.fps}',
            
            # CRITICAL: Reduce FFmpeg buffer
            '-avioflags', 'direct',
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            
            '-'
        ]
                
        try:
            self.process = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                bufsize=self.frame_size * 2
            )
            self.reconnect_count += 1
        except FileNotFoundError:
            print("❌ FFmpeg is not installed!")
            self.running = False
        
    def _reader_thread(self):
        url_refresh_time = time.time()
        URL_REFRESH_INTERVAL = 5400
        
        while self.running:
            if time.time() - url_refresh_time > URL_REFRESH_INTERVAL:
                print("🔄 Refreshing stream URL...")
                self._initialize_stream()
                url_refresh_time = time.time()
                continue
                
            if self.process and self.process.stdout:
                try:
                    raw_bytes = self.process.stdout.read(self.frame_size)
                    if len(raw_bytes) == self.frame_size:
                        frame_array = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((self.height, self.width, 3))
                        with self._lock:
                            self.ret = True
                            self.frame = frame_array.copy()
                            self.last_successful_frame = time.time()
                    else:
                        with self._lock:
                            self.ret = False
                        time.sleep(2)
                        if self.running:
                            self._initialize_stream()
                except Exception as e:
                    with self._lock:
                        self.ret = False
                    time.sleep(2)
                    if self.running:
                        self._initialize_stream()
            else:
                time.sleep(1)
                    
    def read(self):
        with self._lock:
            return self.ret, (self.frame.copy() if self.frame is not None else None)

    def release(self):
        self.running = False
        if self.process:
            self.process.kill()


class FFmpegVideoWriter:
    def __init__(self, output_path, width=1920, height=1080, fps=25):
        self.output_path = output_path
        self.opened = False
        command = [
            "ffmpeg", "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", f"{width}x{height}", "-pix_fmt", "bgr24", "-r", str(fps),
            "-i", "-", "-vcodec", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "ultrafast", "-crf", "23", output_path
        ]
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.opened = True
        except Exception as e:
            print(f"❌ FFmpeg Writer error: {e}")

    def write(self, frame):
        if self.opened:
            try: 
                self.process.stdin.write(frame.tobytes())
            except BrokenPipeError: 
                self.opened = False

    def release(self):
        if self.opened:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=10)
            except: 
                self.process.kill()


class VideoWriterThread(threading.Thread):
    def __init__(self, cam, writer):
        super().__init__(daemon=True)
        self.cam = cam
        self.writer = writer
        self.running = True
        self.frame_time = 1.0 / 25.0

    def run(self):
        while self.running:
            start_time = time.time()
            ret, frame = self.cam.read()
            if ret and frame is not None: 
                self.writer.write(frame)
            elapsed = time.time() - start_time
            if self.frame_time > elapsed: 
                time.sleep(self.frame_time - elapsed)


# ==========================================
# 6. HELPER FUNCTIONS
# ==========================================
def is_point_in_poly(point, poly_points): 
    return Polygon(poly_points).contains(Point(point))

def point_in_rect(pt, x1, y1, x2, y2): 
    return x1 <= pt[0] <= x2 and y1 <= pt[1] <= y2

def get_iou(box1, box2):
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2
    xi1, yi1 = max(x1_1, x1_2), max(y1_1, y1_2)
    xi2, yi2 = min(x2_1, x2_2), min(y2_1, y2_2)
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    union = ((x2_1-x1_1)*(y2_1-y1_1)) + ((x2_2-x1_2)*(y2_2-y1_2)) - inter
    return inter / union if union > 0 else 0

def calculate_std_dev(history):
    if len(history) < 3: return 0.0, 0.0, 0.0
    xs, ys = [pt[0] for pt in history], [pt[1] for pt in history]
    return float(np.mean(xs)), float(np.mean(ys)), (float(np.std(xs)) + float(np.std(ys))) / 2.0

def assign_desk_id_by_y(side, y_pos):
    segment = FRAME_HEIGHT / 3.0
    if side == "left":
        if y_pos < segment:             return 3
        elif y_pos < segment * 2:       return 2
        else:                           return 1
    else:  
        if y_pos < segment:             return 6
        elif y_pos < segment * 2:       return 5
        else:                           return 4


# ==========================================
# 7. POSE-AWARE ZONE & TIME STATE MACHINE
# ==========================================
class DeskState:
    def __init__(self, desk_cfg, fps, zone_cfg):
        self.desk_cfg = desk_cfg
        self.desk_id  = desk_cfg["id"]
        self.fps      = fps
        self.min_std  = desk_cfg["min_std"]
        self.zone_cfg = zone_cfg          
        self.state    = "AWAY"
        
        self.total_frames = 0
        self.state_counts = { "Working": 0, "Idle": 0, "Distracted": 0, "Away": 0 }

        self.centroid_hist = deque(maxlen=int(15.0 * fps)) 
        self.l_wrist_hist  = deque(maxlen=int(3.0 * fps))   
        self.r_wrist_hist  = deque(maxlen=int(3.0 * fps))
        
        self.time_since_last_seen = 0.0
        self.out_of_zone_timer    = 0.0
        self.still_timer          = 0.0
        
        # Phone distraction timer (5 minutes = 300 seconds)
        self.phone_detected_timer = 0.0
        self.PHONE_DISTRACTION_THRESHOLD = 300.0  # 5 minutes
        self.phone_buffer_active = False

    def _reset_state(self):
        self.centroid_hist.clear()
        self.l_wrist_hist.clear()
        self.r_wrist_hist.clear()
        self.out_of_zone_timer = 0.0
        self.still_timer       = 0.0
        self.phone_detected_timer = 0.0
        self.phone_buffer_active = False

    def mark_away(self):
        self.state = "AWAY"
        self._reset_state()

    def get_dashboard_payload(self):
        t = max(1, self.total_frames)
        return {
            "liveRaw":     self.state,
            "totalFrames": self.total_frames,
            "working":     int((self.state_counts["Working"]    / t) * 100),
            "idle":        int((self.state_counts["Idle"]       / t) * 100),
            "distracted":  int((self.state_counts["Distracted"] / t) * 100),
            "away":        int((self.state_counts["Away"]       / t) * 100),
            "raw_counts":  self.state_counts,
            "phoneTimer":  round(self.phone_detected_timer, 1)  # Debug info
        }

    def update(self, dt, kps, phone_boxes, center):
        self.time_since_last_seen = 0.0
        self.centroid_hist.append(center)

        # 1. Safely extract keypoints
        if len(kps) > 10:
            l_wrist, r_wrist = kps[9], kps[10]
            if l_wrist[2] > 0.4: self.l_wrist_hist.append((l_wrist[0], l_wrist[1]))
            if r_wrist[2] > 0.4: self.r_wrist_hist.append((r_wrist[0], r_wrist[1]))
        else:
            l_wrist, r_wrist = [0,0,0], [0,0,0]

        l_elbow = kps[7] if len(kps) > 7 else [0,0,0]
        r_elbow = kps[8] if len(kps) > 8 else [0,0,0]

        # 2. Phone Detection Check
        is_scrolling_phone = False
        for ph_box in phone_boxes:
            x1, y1 = ph_box[0] - 30, ph_box[1] - 30
            x2, y2 = ph_box[2] + 30, ph_box[3] + 30
            if point_in_rect(center, x1, y1, x2, y2): 
                is_scrolling_phone = True
            if l_wrist[2] > 0.4 and point_in_rect((l_wrist[0], l_wrist[1]), x1, y1, x2, y2): 
                is_scrolling_phone = True
            if r_wrist[2] > 0.4 and point_in_rect((r_wrist[0], r_wrist[1]), x1, y1, x2, y2): 
                is_scrolling_phone = True
            if l_elbow[2] > 0.4 and point_in_rect((l_elbow[0], l_elbow[1]), x1, y1, x2, y2): 
                is_scrolling_phone = True
            if r_elbow[2] > 0.4 and point_in_rect((r_elbow[0], r_elbow[1]), x1, y1, x2, y2): 
                is_scrolling_phone = True

        # Phone distraction with 5-minute buffer
        if is_scrolling_phone:
            self.phone_detected_timer += dt
            self.phone_buffer_active = True
            
            # Check if phone distraction threshold is reached
            if self.phone_detected_timer >= self.PHONE_DISTRACTION_THRESHOLD:
                self.state = "DISTRACTED"
                self._tally_state()
                return
        else:
            # Reset phone timer when phone is no longer detected
            self.phone_detected_timer = 0.0
            self.phone_buffer_active = False

        # 3. Ghost Chair Check
        if len(self.centroid_hist) >= self.fps * 10:
            _, _, center_std = calculate_std_dev(self.centroid_hist)
            if center_std < 0.3:
                self.mark_away()
                self._tally_state()
                return

        # 4. ZONE CHECK LOGIC
        in_work_zone = False
        if is_point_in_poly(center, self.zone_cfg["work_poly"]):
            in_work_zone = True
        elif l_wrist[2] > 0.4 and is_point_in_poly((l_wrist[0], l_wrist[1]), self.zone_cfg["work_poly"]):
            in_work_zone = True
        elif r_wrist[2] > 0.4 and is_point_in_poly((r_wrist[0], r_wrist[1]), self.zone_cfg["work_poly"]):
            in_work_zone = True

        if not in_work_zone:
            self.out_of_zone_timer += dt
            self.still_timer = 0.0 
            
            if self.out_of_zone_timer >= 120.0:
                self.state = "PASSIVE WORKING"
            else:
                self.state = "WORKING" 
        else:
            self.out_of_zone_timer = 0.0
            _, _, l_std = calculate_std_dev(self.l_wrist_hist)
            _, _, r_std = calculate_std_dev(self.r_wrist_hist)
            
            if max(l_std, r_std) >= self.min_std or len(self.l_wrist_hist) < self.fps * 2:
                self.still_timer = 0.0
                self.state = "WORKING"
            else:
                self.still_timer += dt
                if self.still_timer >= 120.0:
                    self.state = "PASSIVE WORKING"
                else:
                    self.state = "WORKING"

        self._tally_state()

    def apply_absence(self, dt):
        self.time_since_last_seen += dt
        if self.time_since_last_seen > 2.0:  # CHANGED: 2-second tracking buffer for quick AWAY detection
            self.mark_away()
        self._tally_state()

    def _tally_state(self):
        self.total_frames += 1
        if self.state == "WORKING": 
            self.state_counts["Working"] += 1
        elif self.state == "PASSIVE WORKING": 
            self.state_counts["Idle"] += 1
        elif self.state == "DISTRACTED": 
            self.state_counts["Distracted"] += 1
        else: 
            self.state_counts["Away"] += 1


# ==========================================
# 8. FIREBASE PUSH (ASYNC)
# ==========================================
last_firebase_push_time = 0

def push_to_firestore_rate_limited(desk_states):
    global last_firebase_push_time
    if db is None: 
        return

    current_time = time.time()
    if current_time - last_firebase_push_time < FIREBASE_SYNC_INTERVAL:
        return

    last_firebase_push_time = current_time
    now_str = datetime.now().strftime("%H:%M:%S")
    today_str = datetime.now().strftime("%Y-%m-%d")

    payload = {"timestamp": now_str, "updatedAt": firestore.SERVER_TIMESTAMP, "workers": {}}
    for d_id, desk in desk_states.items():
        payload["workers"][f"W00{d_id}"] = desk.get_dashboard_payload()

    def fire_and_forget(payload_data, doc_date):
        try:
            db.collection("live_workstations").document("Workstation-1").set(payload_data)
            db.collection("daily_stats").document(doc_date).set(payload_data, merge=True)
            print(f"[☁️ SYNC @ {payload_data['timestamp']}] Firebase Updated.")
        except Exception as e:
            print(f"❌ Async Firebase Sync Failed: {e}")

    threading.Thread(target=fire_and_forget, args=(payload, today_str), daemon=True).start()


# ==========================================
# 9. MAIN LOOP
# ==========================================
def main():
    print("=" * 60)
    print("🚀 INITIALIZING POSE PIPELINE (VLC BRIDGE - ULTRA LOW LATENCY)")
    print("=" * 60)

    pose_model  = YOLO(POSE_MODEL_PATH, task='pose')
    phone_model = YOLO(PHONE_MODEL_PATH)
    tracker     = sv.ByteTrack(track_activation_threshold=0.25, minimum_matching_threshold=0.5, frame_rate=30)

    desk_states = { d["id"]: DeskState(d, 30, CONSOLIDATED_ZONES[d["side"]]) for d in DESK_CONFIG }
    track_to_desk = {} 

    # --- RESTORE PREVIOUS SESSION DATA ---
    today_str = datetime.now().strftime("%Y-%m-%d")
    print(f"🔍 Checking for existing data for today ({today_str})...")
    if db is not None:
        try:
            doc_ref = db.collection("daily_stats").document(today_str)
            doc = doc_ref.get()
            if doc.exists:
                data = doc.to_dict()
                if "workers" in data:
                    for d_id, desk in desk_states.items():
                        w_id = f"W00{d_id}"
                        if w_id in data["workers"]:
                            w_data = data["workers"][w_id]
                            desk.total_frames = w_data.get("totalFrames", 0)
                            if "raw_counts" in w_data: 
                                desk.state_counts = w_data["raw_counts"]
                    print("✅ Successfully restored today's accumulated data!")
        except Exception as e:
            pass

    # --- TRY VLC BRIDGE FIRST, FALLBACK TO FFMPEG HLS ---
    print("\n📡 Starting capture...")
    try:
        cam = EZVIZVLCCapture(width=1920, height=1080, fps=25)
        print("✅ Using VLC Bridge (Ultra-Low Latency: 1-3 seconds)")
    except Exception as e:
        print(f"⚠️ VLC Bridge failed: {e}")
        print("🔄 Falling back to FFmpeg HLS (Higher Latency: 30-60 seconds)")
        cam = EZVIZCloudCapture(width=1920, height=1080, fps=25)
    
    current_date       = datetime.now().date()
    current_video_file = get_video_filename()
    writer             = FFmpegVideoWriter(current_video_file, width=1920, height=1080, fps=25)
    writer_thread      = VideoWriterThread(cam, writer)
    writer_thread.start()

    print("\n🎬 Pipeline Running Indefinitely via EZVIZ Cloud...")
    print("   Zero Tailscale dependency | 24/7 Monitoring")
    print("   📱 Phone Distraction Timer: 5 minutes (300 seconds)")
    print("-" * 60)
    
    last_time = time.time()
    frame_count = 0
    start_time = time.time()

    try:
        while True:
            current_time = time.time()

            # --- MIDNIGHT ROLLOVER ---
            now_date = datetime.now().date()
            if now_date > current_date:
                print(f"🌙 Midnight rollover: {current_date} → {now_date}")
                writer_thread.running = False
                writer_thread.join()
                writer.release()
                threading.Thread(target=upload_video_to_drive, args=(current_video_file,)).start()
                
                current_date = now_date
                current_video_file = get_video_filename()
                writer = FFmpegVideoWriter(current_video_file, width=1920, height=1080, fps=25)
                writer_thread = VideoWriterThread(cam, writer)
                writer_thread.start()
                
                track_to_desk.clear() 
                for d_id in desk_states:
                    desk_states[d_id]._reset_state()
                    desk_states[d_id].total_frames = 0
                    desk_states[d_id].state_counts = {"Working": 0, "Idle": 0, "Distracted": 0, "Away": 0}

            ret, frame = cam.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue

            frame_count += 1
            dt = current_time - last_time
            last_time = current_time

            pose_results  = pose_model(frame, imgsz=640, verbose=False, conf=0.50)[0]
            phone_results = phone_model(frame, imgsz=640, verbose=False, conf=0.25)[0]

            phone_boxes = [box.xyxy.cpu().numpy()[0] for box in phone_results.boxes if int(box.cls[0]) == 0] if phone_results.boxes else []
            detections  = sv.Detections.from_ultralytics(pose_results)
            tracked_detections = tracker.update_with_detections(detections)
            kps_list    = (pose_results.keypoints.data.cpu().numpy() if pose_results.keypoints else [])
            pose_boxes  = pose_results.boxes.xyxy.cpu().numpy()

            desks_updated_this_frame = set()

            for i in range(len(tracked_detections)):
                t_id  = tracked_detections.tracker_id[i]
                t_box = tracked_detections.xyxy[i]
                
                best_iou, best_idx = 0, -1
                for j, p_box in enumerate(pose_boxes):
                    iou = get_iou(t_box, p_box)
                    if iou > best_iou: 
                        best_iou, best_idx = iou, j

                kps = kps_list[best_idx] if best_iou > 0.5 and best_idx != -1 else []
                center = ((t_box[0]+t_box[2])/2, (t_box[1]+t_box[3])/2)

                if t_id not in track_to_desk:
                    for side, zone in CONSOLIDATED_ZONES.items():
                        if is_point_in_poly(center, zone["seat_poly"]) or is_point_in_poly(center, zone["work_poly"]):
                            assigned_d_id = assign_desk_id_by_y(side, center[1])
                            track_to_desk[t_id] = assigned_d_id
                            break
                
                assigned_d_id = track_to_desk.get(t_id)

                if assigned_d_id and assigned_d_id not in desks_updated_this_frame:
                    desk_states[assigned_d_id].update(dt, kps, phone_boxes, center)
                    desks_updated_this_frame.add(assigned_d_id)

            for d_id, desk in desk_states.items():
                if d_id not in desks_updated_this_frame:
                    desk.apply_absence(dt)

            push_to_firestore_rate_limited(desk_states)
            
            # Periodic status update
            if frame_count % 250 == 0:
                elapsed = time.time() - start_time
                fps_actual = frame_count / elapsed
                
                # Show phone timer status for debugging
                phone_timers = {d_id: round(desk.phone_detected_timer, 1) for d_id, desk in desk_states.items() if desk.phone_buffer_active}
                
                if hasattr(cam, 'get_stats'):
                    stats = cam.get_stats()
                    print(f"📊 FPS: {fps_actual:.1f} | Protocol: {stats.get('protocol', 'HLS')} | Reconnects: {stats.get('reconnect_count', 0)}")
                else:
                    print(f"📊 FPS: {fps_actual:.1f} | Frames: {frame_count}")
                
                if phone_timers:
                    print(f"   📱 Phone timers active: {phone_timers}")

    except KeyboardInterrupt:
        print("\n🛑 Shutting down gracefully...")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        writer_thread.running = False
        writer_thread.join(timeout=5)
        cam.release()
        writer.release()
        print("✅ Pipeline Offline.")

if __name__ == "__main__":
    main()