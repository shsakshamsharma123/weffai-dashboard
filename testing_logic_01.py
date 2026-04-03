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
from datetime import datetime
import os
import firebase_admin
from firebase_admin import credentials, firestore

# --- GOOGLE DRIVE IMPORTS ---
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2 import service_account

# ==========================================
# 1. CONFIGURATION
# ==========================================
RTSP_URL         = "rtsp://admin:CBKLVW@172.16.15.121:554/streaming/channels/101/"
POSE_MODEL_PATH  = "/Users/musab/Desktop/Optimized_model/yolo11l-pose.pt"
PHONE_MODEL_PATH = "/Users/musab/Desktop/weffai-dashboard/best (13).pt"

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

# --- ENERGY & KINEMATIC CONSTANTS ---
MAX_WORK_ENERGY          = 100.0
MAX_GESTURE_ENERGY       = 100.0
MAX_DISTRACTION_ENERGY   = 120.0
MAX_THINKING_TIME        = 180.0
MAX_PHONE_PROXIMITY_TIME = 120.0

MIN_PATH_LENGTH_TYPING       = 5.0
MAX_BOX_AREA_TYPING          = 2000.0
MIN_PATH_LENGTH_GESTURE      = 15.0
MAX_SHOULDER_EXTENSION_RATIO = 2.5

WRIST_CONF_GATE         = 0.65
WRIST_MAX_VELOCITY_PX   = 80.0
WRIST_STALE_FRAME_LIMIT = 60
MIN_WRIST_SEPARATION_PX = 70

WORK_ENERGY_CHARGE_RATE   = 30.0
WORK_ENERGY_STILL_DRAIN   = 5.0
WORK_ENERGY_GRACE_SECONDS = 3.0
WORKING_STATE_THRESHOLD   = 60.0
WORKING_CONFIRM_FRAMES    = 3
PHONE_BOX_EXPAND_PX       = 35

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

        file_metadata = {
            'name': os.path.basename(file_path),
            'parents': [GDRIVE_FOLDER_ID]
        }
        media = MediaFileUpload(file_path, mimetype='video/mp4', resumable=True)
        file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        print(f"✅ Successfully uploaded to Drive. File ID: {file.get('id')}")

        os.remove(file_path)
        print("🗑️ Local video file deleted.")
    except Exception as e:
        print(f"❌ Google Drive upload failed: {e}")

# ==========================================
# 4. BUFFERLESS CAPTURE & VIDEO WRITER
# ==========================================
class BufferlessVideoCapture:
    def __init__(self, rtsp_url, width=1920, height=1080):
        self.width, self.height = width, height
        self.frame_size = width * height * 3
        command = [
            "ffmpeg", "-rtsp_transport", "tcp", "-timeout", "30000000",
            "-i", rtsp_url, "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-vf", f"scale={width}:{height}", "-"
        ]
        self.pipe = subprocess.Popen(command, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, bufsize=10**8)
        self._lock = threading.Lock()
        self.ret, self.frame, self.running = False, None, True
        self.t = threading.Thread(target=self._reader, daemon=True)
        self.t.start()

        for _ in range(30):
            if self.ret: break
            time.sleep(1.0)

    def _reader(self):
        while self.running:
            raw = self.pipe.stdout.read(self.frame_size)
            if len(raw) == self.frame_size:
                with self._lock:
                    self.frame = np.frombuffer(raw, dtype=np.uint8).reshape(
                        (self.height, self.width, 3)).copy()
                    self.ret = True
            else:
                self.running = False
                break

    def read(self):
        with self._lock:
            return self.ret, (self.frame.copy() if self.frame is not None else None)

    def release(self):
        self.running = False
        try: self.pipe.kill()
        except: pass

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
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE,
                                            stderr=subprocess.DEVNULL)
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
            if ret and frame is not None:
                self.writer.write(frame)
            elapsed = time.time() - start_time
            if self.frame_time > elapsed:
                time.sleep(self.frame_time - elapsed)

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
    return 0.0, 0.0, (float(np.std(xs)) + float(np.std(ys))) / 2.0

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
# 6. DESK STATE MACHINE
# ==========================================
class DeskState:
    def __init__(self, desk_cfg, fps, zone_cfg):
        self.desk_cfg = desk_cfg
        self.desk_id  = desk_cfg["id"]
        self.fps      = fps
        self.min_std  = desk_cfg["min_std"]
        self.zone_cfg = zone_cfg          
        self.state    = "AWAY"
        self._reset_state()

        self.total_frames = 0
        self.state_counts = { "Working": 0, "Idle": 0, "Distracted": 0, "Away": 0 }

    def _reset_state(self):
        self.work_energy, self.gesture_energy, self.distraction_energy = 0.0, 0.0, 0.0
        self.thinking_timer, self.phone_proximity_timer, self.still_timer = 0.0, 0.0, 0.0
        self.working_confirm_counter = 0
        self.l_wrist_hist, self.r_wrist_hist = deque(maxlen=int(self.fps)), deque(maxlen=int(self.fps))
        self.l_wrist_last, self.r_wrist_last = None, None
        self.l_frames_since_accepted, self.r_frames_since_accepted = 0, 0

    def mark_away(self):
        self.state = "AWAY"
        self._reset_state()
        self._tally_state()

    def _tally_state(self):
        self.total_frames += 1
        if self.state in ["WORKING", "THINKING"]: self.state_counts["Working"] += 1
        elif self.state == "IDLE": self.state_counts["Idle"] += 1
        elif self.state in ["DISTRACTED", "PHONE PROXIMITY"]: self.state_counts["Distracted"] += 1
        else: self.state_counts["Away"] += 1

    def get_dashboard_payload(self):
        t = max(1, self.total_frames)
        return {
            "liveRaw":     self.state,
            "totalFrames": self.total_frames,
            "working":     int((self.state_counts["Working"]    / t) * 100),
            "idle":        int((self.state_counts["Idle"]       / t) * 100),
            "distracted":  int((self.state_counts["Distracted"] / t) * 100),
            "away":        int((self.state_counts["Away"]       / t) * 100),
            "raw_counts":  self.state_counts # <--- THE ANTI-AMNESIA PAYLOAD
        }

    def calculate_kinematics(self, history):
        if len(history) < 2: return 0.0, 0.0
        path = sum(math.hypot(history[i][0]-history[i-1][0], history[i][1]-history[i-1][1]) for i in range(1, len(history)))
        xs, ys = [pt[0] for pt in history], [pt[1] for pt in history]
        return path, (max(xs)-min(xs)) * (max(ys)-min(ys))

    def _accept_wrist(self, wrist_kp, last_pos):
        x, y, conf = wrist_kp
        if conf < WRIST_CONF_GATE: return False, None
        if last_pos and math.hypot(x-last_pos[0], y-last_pos[1]) > WRIST_MAX_VELOCITY_PX: return False, None
        return True, (x, y)

    def update(self, dt, kps, phone_boxes):
        if self.state == "AWAY":
            self._reset_state()
            self.state = "THINKING"

        l_shoulder, r_shoulder = kps[5], kps[6]
        l_wrist,    r_wrist    = kps[9], kps[10]
        l_elbow,    r_elbow    = kps[7], kps[8]   

        valid_posture = True
        if l_shoulder[2] > 0.5 and r_shoulder[2] > 0.5:
            sw  = math.hypot(l_shoulder[0]-r_shoulder[0], l_shoulder[1]-r_shoulder[1])
            smx, smy = (l_shoulder[0]+r_shoulder[0]) / 2, (l_shoulder[1]+r_shoulder[1]) / 2
            if l_wrist[2] > 0.5 and sw > 10 and math.hypot(l_wrist[0]-smx, l_wrist[1]-smy)/sw > MAX_SHOULDER_EXTENSION_RATIO: valid_posture = False
            if r_wrist[2] > 0.5 and sw > 10 and math.hypot(r_wrist[0]-smx, r_wrist[1]-smy)/sw > MAX_SHOULDER_EXTENSION_RATIO: valid_posture = False

        l_ok, l_pos = self._accept_wrist(l_wrist, self.l_wrist_last)
        r_ok, r_pos = self._accept_wrist(r_wrist, self.r_wrist_last)

        if l_ok:
            self.l_wrist_hist.append(l_pos); self.l_wrist_last = l_pos; self.l_frames_since_accepted = 0
        else:
            self.l_frames_since_accepted += 1
            if self.l_frames_since_accepted >= WRIST_STALE_FRAME_LIMIT: self.l_wrist_hist.clear(); self.l_wrist_last = None

        if r_ok:
            self.r_wrist_hist.append(r_pos); self.r_wrist_last = r_pos; self.r_frames_since_accepted = 0
        else:
            self.r_frames_since_accepted += 1
            if self.r_frames_since_accepted >= WRIST_STALE_FRAME_LIMIT: self.r_wrist_hist.clear(); self.r_wrist_last = None

        l_path, l_area = self.calculate_kinematics(self.l_wrist_hist)
        r_path, r_area = self.calculate_kinematics(self.r_wrist_hist)
        _, _, l_std    = calculate_std_dev(self.l_wrist_hist)
        _, _, r_std    = calculate_std_dev(self.r_wrist_hist)

        l_last = self.l_wrist_hist[-1] if self.l_wrist_hist else None
        r_last = self.r_wrist_hist[-1] if self.r_wrist_hist else None

        l_in_work = l_last and is_point_in_poly(l_last, self.zone_cfg["work_poly"])
        r_in_work = r_last and is_point_in_poly(r_last, self.zone_cfg["work_poly"])

        wrists_clasped = False
        if l_last and r_last and math.hypot(l_last[0]-r_last[0], l_last[1]-r_last[1]) < MIN_WRIST_SEPARATION_PX: wrists_clasped = True

        raw_working, is_gesturing, is_scrolling_phone = False, False, False

        if valid_posture and not wrists_clasped:
            if (l_in_work and l_path > MIN_PATH_LENGTH_TYPING and l_area < MAX_BOX_AREA_TYPING and l_std > self.min_std) or \
               (r_in_work and r_path > MIN_PATH_LENGTH_TYPING and r_area < MAX_BOX_AREA_TYPING and r_std > self.min_std): raw_working = True

        self.working_confirm_counter = self.working_confirm_counter + 1 if raw_working else 0
        is_working_physically = self.working_confirm_counter >= WORKING_CONFIRM_FRAMES

        if (l_path > MIN_PATH_LENGTH_GESTURE and l_area > MAX_BOX_AREA_TYPING and not l_in_work) or \
           (r_path > MIN_PATH_LENGTH_GESTURE and r_area > MAX_BOX_AREA_TYPING and not r_in_work): is_gesturing = True

        is_still = not is_working_physically and not is_gesturing

        for ph_box in phone_boxes:
            x1, y1 = ph_box[0] - PHONE_BOX_EXPAND_PX, ph_box[1] - PHONE_BOX_EXPAND_PX
            x2, y2 = ph_box[2] + PHONE_BOX_EXPAND_PX, ph_box[3] + PHONE_BOX_EXPAND_PX
            if l_last and point_in_rect(l_last, x1, y1, x2, y2): is_scrolling_phone = True
            if r_last and point_in_rect(r_last, x1, y1, x2, y2): is_scrolling_phone = True
            if l_elbow[2] > 0.5 and point_in_rect((l_elbow[0], l_elbow[1]), x1, y1, x2, y2): is_scrolling_phone = True
            if r_elbow[2] > 0.5 and point_in_rect((r_elbow[0], r_elbow[1]), x1, y1, x2, y2): is_scrolling_phone = True

        if is_scrolling_phone:
            self.distraction_energy   = min(MAX_DISTRACTION_ENERGY, self.distraction_energy + dt)
            self.phone_proximity_timer = min(MAX_PHONE_PROXIMITY_TIME, self.phone_proximity_timer + dt)
            self.work_energy = max(0.0, self.work_energy - (20.0 * dt))
        else:
            self.distraction_energy    = max(0.0, self.distraction_energy - (2.0 * dt))
            self.phone_proximity_timer = max(0.0, self.phone_proximity_timer - (1.0 * dt))

        if is_working_physically and not is_scrolling_phone:
            self.work_energy    = min(MAX_WORK_ENERGY, self.work_energy + (WORK_ENERGY_CHARGE_RATE * dt))
            self.gesture_energy, self.thinking_timer, self.still_timer = max(0.0, self.gesture_energy - (20.0 * dt)), max(0.0, self.thinking_timer - (10.0 * dt)), 0.0
        elif is_gesturing:
            self.gesture_energy = min(MAX_GESTURE_ENERGY, self.gesture_energy + (1.0 * dt))
            self.work_energy, self.thinking_timer, self.still_timer = max(0.0, self.work_energy - (20.0 * dt)), max(0.0, self.thinking_timer - (10.0 * dt)), 0.0
        elif is_still:
            self.still_timer += dt
            if self.still_timer > WORK_ENERGY_GRACE_SECONDS: self.work_energy = max(0.0, self.work_energy - (WORK_ENERGY_STILL_DRAIN * dt))
            self.gesture_energy = max(0.0, self.gesture_energy - (10.0 * dt))
            if not is_scrolling_phone: self.thinking_timer += dt

        if wrists_clasped: self.work_energy, self.still_timer = max(0.0, self.work_energy - (WORK_ENERGY_STILL_DRAIN * dt)), 0.0
        if not valid_posture: self.work_energy = max(0.0, self.work_energy - (30.0 * dt))

        if self.distraction_energy >= MAX_DISTRACTION_ENERGY: self.state = "DISTRACTED"
        elif self.gesture_energy >= 60.0 or self.thinking_timer >= MAX_THINKING_TIME: self.state = "IDLE"
        elif self.work_energy >= WORKING_STATE_THRESHOLD: self.state = "WORKING"
        elif self.work_energy < 5.0: self.state = "PHONE PROXIMITY" if self.phone_proximity_timer >= MAX_PHONE_PROXIMITY_TIME else "THINKING"

        self._tally_state()


# ==========================================
# 7. FIREBASE PUSH (DUAL-WRITE ARCHITECTURE)
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

    payload = {
        "timestamp":  now_str,
        "updatedAt":  firestore.SERVER_TIMESTAMP,
        "workers":    {}
    }

    for d_id, desk in desk_states.items():
        worker_id = f"W00{d_id}"
        payload["workers"][worker_id] = desk.get_dashboard_payload()

    try:
        db.collection("live_workstations").document("Workstation-1").set(payload)
        db.collection("daily_stats").document(today_str).set(payload)
        print(f"[☁️ SYNC @ {now_str}] Firebase Updated (Live + History).")
    except Exception as e:
        print(f"❌ Firebase Sync Failed: {e}")


# ==========================================
# 8. MAIN LOOP
# ==========================================
def main():
    print("🚀 Initializing LIVE PRODUCTION PIPELINE")

    pose_model  = YOLO(POSE_MODEL_PATH, task='pose')
    phone_model = YOLO(PHONE_MODEL_PATH)
    tracker     = sv.ByteTrack(track_activation_threshold=0.25, minimum_matching_threshold=0.5, frame_rate=30)

    desk_states = { d["id"]: DeskState(d, 30, CONSOLIDATED_ZONES[d["side"]]) for d in DESK_CONFIG }
    desk_absence_counter = {d["id"]: 0.0 for d in DESK_CONFIG}

    # --- RESTORE PREVIOUS SESSION DATA (Anti-Amnesia) ---
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
                    print("✅ Successfully restored today's accumulated data! AI will resume counting.")
            else:
                print("ℹ️ No previous data found for today. Starting fresh.")
        except Exception as e:
            print(f"⚠️ Could not restore data: {e}")
    # ----------------------------------------------------

    print(f"📡 Connecting to RTSP Stream: {RTSP_URL}")
    cam = BufferlessVideoCapture(RTSP_URL, width=1920, height=1080)
    if not cam.ret:
        print("❌ ERROR: Could not read stream.")
        return

    current_date       = datetime.now().date()
    current_video_file = get_video_filename()
    writer             = FFmpegVideoWriter(current_video_file, width=1920, height=1080, fps=25)
    writer_thread      = VideoWriterThread(cam, writer)
    writer_thread.start()

    print("🎬 Pipeline Running Indefinitely...")
    last_time = time.time()

    try:
        while True:
            current_time = time.time()

            # --- END OF DAY ROLLOVER ---
            now_date = datetime.now().date()
            if now_date > current_date:
                print("🌙 Midnight Rollover! Finalizing today's video...")
                writer_thread.running = False
                writer_thread.join()
                writer.release()

                upload_thread = threading.Thread(target=upload_video_to_drive, args=(current_video_file,))
                upload_thread.start()

                current_date       = now_date
                current_video_file = get_video_filename()
                writer             = FFmpegVideoWriter(current_video_file, width=1920, height=1080, fps=25)
                writer_thread      = VideoWriterThread(cam, writer)
                writer_thread.start()

                # Reset accumulators for the new day
                for d_id in desk_states:
                    desk_states[d_id]._reset_state()
                    desk_states[d_id].total_frames = 0
                    desk_states[d_id].state_counts = {"Working": 0, "Idle": 0, "Distracted": 0, "Away": 0}

            # --- FRAME READ ---
            ret, frame = cam.read()
            if not ret or frame is None:
                time.sleep(0.1)
                continue

            dt        = current_time - last_time
            last_time = current_time

            pose_results  = pose_model(frame, imgsz=640, verbose=False, conf=0.50)[0]
            phone_results = phone_model(frame, imgsz=640, verbose=False, conf=0.25)[0]

            phone_boxes = [box.xyxy.cpu().numpy()[0] for box in phone_results.boxes if int(box.cls[0]) == 0] if phone_results.boxes else []
            detections        = sv.Detections.from_ultralytics(pose_results)
            tracked_detections = tracker.update_with_detections(detections)
            kps_list          = (pose_results.keypoints.data.cpu().numpy() if pose_results.keypoints else [])
            pose_boxes        = pose_results.boxes.xyxy.cpu().numpy()

            desks_updated_this_frame = set()

            for i in range(len(tracked_detections)):
                t_box = tracked_detections.xyxy[i]
                best_iou, best_idx = 0, -1
                for j, p_box in enumerate(pose_boxes):
                    iou = get_iou(t_box, p_box)
                    if iou > best_iou: best_iou, best_idx = iou, j

                kps = kps_list[best_idx] if best_iou > 0.5 and best_idx != -1 else []
                if len(kps) < 11: continue

                center = ((t_box[0]+t_box[2])/2, (t_box[1]+t_box[3])/2)
                cx, cy = center

                assigned_side = None
                for side, zone in CONSOLIDATED_ZONES.items():
                    if is_point_in_poly(center, zone["seat_poly"]) or is_point_in_poly(center, zone["work_poly"]):
                        assigned_side = side
                        break

                assigned_d_id = None
                if assigned_side: assigned_d_id = assign_desk_id_by_y(assigned_side, cy)

                if assigned_d_id:
                    desk_states[assigned_d_id].update(dt, kps, phone_boxes)
                    desks_updated_this_frame.add(assigned_d_id)

            for d_id in desk_states:
                if d_id in desks_updated_this_frame: desk_absence_counter[d_id] = 0.0
                else:
                    desk_absence_counter[d_id] += dt
                    if desk_absence_counter[d_id] >= 5.0: desk_states[d_id].mark_away()

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