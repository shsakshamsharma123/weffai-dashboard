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

# --- DEBUG CONFIGURATION ---
ENABLE_VISUAL_DEBUG = True  # Set to False for pure production mode
DEBUG_WINDOW_NAME = "Production Pipeline - Visual Debug"
WRIST_TRAIL_MAXLEN = 30
LOG_LEVEL = "INFO"  # Can be "DEBUG", "INFO", "WARNING"

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
PHONE_BOX_EXPAND_PX       = 30

GHOSTING_ABSENCE_LIMIT    = 15.0

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
FRAME_WIDTH = 1920

# --- COLOR PALETTE FOR VISUAL DEBUGGING ---
DESK_COLOURS = [
    (255, 180,  60),   # 1 - Orange
    ( 60, 200, 255),   # 2 - Yellow/Blue
    ( 80, 255, 120),   # 3 - Green
    (255,  80, 180),   # 4 - Pink
    (255, 255,  80),   # 5 - Cyan/Yellow
    (180,  80, 255),   # 6 - Purple
]

SIDE_COLOURS = {
    "left":  ( 60, 200, 255), 
    "right": (255, 180,  60), 
}

STATE_COLOURS = {
    "WORKING":         ( 60, 220,  60),  # Green
    "THINKING":        (220, 180,  60),  # Yellow/Orange
    "IDLE":            (200, 160,  60),  # Brown/Yellow
    "DISTRACTED":      ( 60,  60, 220),  # Red
    "PHONE PROXIMITY": ( 60, 100, 255),  # Orange/Red
    "AWAY":            (130, 130, 130),  # Gray
    "BREAK":           (100, 100, 100),  # Dark Gray
    "ON LEAVE":        ( 80,  80,  80),  # Darker Gray
}

KP_LIMBS = [(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16),(0,5),(0,6)]

# ==========================================
# 3. LOGGING UTILITY
# ==========================================
class Logger:
    @staticmethod
    def debug(msg):
        if LOG_LEVEL == "DEBUG":
            print(f"🔍 [DEBUG] {datetime.now().strftime('%H:%M:%S')} - {msg}")
    
    @staticmethod
    def info(msg):
        if LOG_LEVEL in ["DEBUG", "INFO"]:
            print(f"ℹ️ [INFO] {datetime.now().strftime('%H:%M:%S')} - {msg}")
    
    @staticmethod
    def warning(msg):
        print(f"⚠️ [WARNING] {datetime.now().strftime('%H:%M:%S')} - {msg}")
    
    @staticmethod
    def error(msg):
        print(f"❌ [ERROR] {datetime.now().strftime('%H:%M:%S')} - {msg}")

# ==========================================
# 4. BACKGROUND CLOUD SYNC THREAD
# ==========================================
firebase_data = {
    "schedule": {},
    "profiles": {}
}

def sync_firebase_config_loop():
    while True:
        try:
            if db is not None:
                # Sync Profiles & Waivers
                prof_docs = db.collection("worker_profiles").stream()
                firebase_data["profiles"] = {doc.id: doc.to_dict() for doc in prof_docs}
                Logger.debug(f"Synced {len(firebase_data['profiles'])} worker profiles")
                
                # Sync Master Schedule
                sched_doc = db.collection("global_config").document("schedule").get()
                if sched_doc.exists:
                    firebase_data["schedule"] = sched_doc.to_dict()
                    Logger.debug("Synced schedule configuration")
        except Exception as e:
            Logger.warning(f"Background Firebase Sync warning: {e}")
        time.sleep(30) # Refresh every 30 seconds

threading.Thread(target=sync_firebase_config_loop, daemon=True).start()

def parse_hm(hm_str):
    if not hm_str or ':' not in hm_str: return None
    h, m = map(int, hm_str.split(':'))
    return h * 60 + m

def is_system_paused():
    schedule = firebase_data["schedule"]
    if not schedule: return False
    now = datetime.now()
    curr = now.hour * 60 + now.minute

    on_t = parse_hm(schedule.get('onTime', {}).get('single'))
    off_t = parse_hm(schedule.get('offTime', {}).get('single'))
    if on_t is not None and off_t is not None:
        if curr < on_t or curr >= off_t: 
            Logger.debug(f"System paused: Outside working hours ({on_t}-{off_t})")
            return True

    for k in ['lunchTime', 'teaTime', 'miscTime']:
        start = parse_hm(schedule.get(k, {}).get('start'))
        end = parse_hm(schedule.get(k, {}).get('end'))
        if start is not None and end is not None:
            if start <= curr <= end: 
                Logger.debug(f"System paused: During {k}")
                return True
    return False

# ==========================================
# 5. BUFFERLESS CAPTURE & VIDEO WRITER
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
        
        Logger.info(f"RTSP Stream connected: {width}x{height}")

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
            Logger.info(f"Video writer initialized: {output_path}")
        except Exception as e:
            Logger.error(f"FFmpeg Writer error: {e}")

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

def upload_video_to_drive(file_path):
    Logger.info(f"Uploading {file_path} to Google Drive...")
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
        Logger.info(f"Successfully uploaded to Drive. File ID: {file.get('id')}")

        os.remove(file_path)
    except Exception as e:
        Logger.error(f"Google Drive upload failed: {e}")

# ==========================================
# 6. VISUAL DEBUGGING UTILITIES
# ==========================================
class VisualDebugger:
    def __init__(self):
        self.font = cv2.FONT_HERSHEY_SIMPLEX
        self.hud_positions = {
            1: (10, 10), 2: (10, 150), 3: (10, 290),
            4: (210, 10), 5: (210, 150), 6: (210, 290)
        }
        
    def draw_text(self, img, text, pos, scale=0.45, color=(255,255,255), thickness=1, bg=None, alpha=0.6):
        x, y = pos
        (tw, th), bl = cv2.getTextSize(text, self.font, scale, thickness)
        if bg is not None:
            pad = 4
            overlay = img.copy()
            cv2.rectangle(overlay, (x-pad, y-th-pad), (x+tw+pad, y+bl+pad), bg, -1)
            cv2.addWeighted(overlay, alpha, img, 1-alpha, 0, img)
        cv2.putText(img, text, (x, y), self.font, scale, color, thickness, cv2.LINE_AA)

    def draw_polygon_overlay(self, img, pts, colour, alpha=0.15):
        pts32 = pts.reshape((-1,1,2)).astype(np.int32)
        overlay = img.copy()
        cv2.fillPoly(overlay, [pts32], colour)
        cv2.addWeighted(overlay, alpha, img, 1-alpha, 0, img)
        cv2.polylines(img, [pts32], True, colour, 1, cv2.LINE_AA)

    def draw_skeleton(self, img, kps, colour=(200,200,200)):
        for a, b in KP_LIMBS:
            if kps[a][2] > 0.3 and kps[b][2] > 0.3:
                cv2.line(img, (int(kps[a][0]), int(kps[a][1])), 
                        (int(kps[b][0]), int(kps[b][1])), colour, 2, cv2.LINE_AA)
        
        for i, (x, y, c) in enumerate(kps):
            if c < 0.3: continue
            r = 6 if i in (9,10) else 5 if i in (7,8) else 4
            kp_col = (0,255,0) if c>0.7 else (0,200,255) if c>0.5 else (0,100,200)
            cv2.circle(img, (int(x),int(y)), r, kp_col, -1, cv2.LINE_AA)
            cv2.circle(img, (int(x),int(y)), r, (0,0,0), 1, cv2.LINE_AA)

    def draw_wrist_trail(self, img, trail, colour, dot_r=3):
        pts = list(trail)
        n = len(pts)
        for i in range(1, n):
            frac = i / n
            c = tuple(int(v*frac) for v in colour)
            cv2.line(img, (int(pts[i-1][0]), int(pts[i-1][1])), 
                    (int(pts[i][0]), int(pts[i][1])), c, 2, cv2.LINE_AA)
        if pts:
            cv2.circle(img, (int(pts[-1][0]), int(pts[-1][1])), dot_r+1, colour, -1)

    def draw_energy_bar(self, img, x, y, w, h, value, max_val, label, colour):
        cv2.rectangle(img, (x,y), (x+w,y+h), (50,50,50), -1)
        fill = int(w * min(value, max_val) / max_val)
        if fill > 0:
            cv2.rectangle(img, (x,y), (x+fill,y+h), colour, -1)
        cv2.rectangle(img, (x,y), (x+w,y+h), (120,120,120), 1)
        self.draw_text(img, f"{label}:{value:.0f}", (x+w+4, y+h-1), 0.35, (200,200,200))

    def draw_desk_hud(self, img, desk_state, desk_id, side, ghost_str=""):
        hud_x, hud_y = self.hud_positions[desk_id]
        col = DESK_COLOURS[(desk_id-1) % len(DESK_COLOURS)]
        
        display_state = desk_state.state + ghost_str
        sc = (150, 150, 150) if ghost_str else STATE_COLOURS.get(desk_state.state, (130,130,130))
        
        bar_w = 80
        
        self.draw_text(img, f"DESK {desk_id} ({side.upper()})", (hud_x, hud_y+12), 0.45, col, 1, bg=(20,20,20))
        self.draw_text(img, display_state, (hud_x, hud_y+30), 0.45, sc, 1, bg=(20,20,20))
        
        bars = [
            (desk_state.work_energy, 100, "WRK", (60,220,60)),
            (desk_state.gesture_energy, 100, "GES", (220,180,60)),
            (desk_state.distraction_energy, 120, "DST", (60,60,220)),
            (desk_state.phone_proximity_timer, 120, "PHN", (60,100,255)),
        ]
        
        for i, (val, mx, lbl, bc) in enumerate(bars):
            self.draw_energy_bar(img, hud_x, hud_y+40+i*14, bar_w, 10, val, mx, lbl, bc)
        
        t = max(1, desk_state.total_frames)
        pct = {k: int(v/t*100) for k, v in desk_state.state_counts.items()}
        pct_str = f"W{pct['Working']:02d} I{pct['Idle']:02d} D{pct['Distracted']:02d} A{pct['Away']:02d}"
        self.draw_text(img, pct_str, (hud_x, hud_y+108), 0.38, (190,190,190))

    def draw_yband_lines(self, img):
        segment = FRAME_HEIGHT / 3
        for y_line in [int(segment), int(segment*2)]:
            for x in range(0, FRAME_WIDTH, 20):
                cv2.line(img, (x, y_line), (x+10, y_line), (200,200,200), 1)

    def render_frame(self, frame, desk_states, phone_boxes, tracked_detections, 
                     kps_list, pose_boxes, absence_timer, infer_ms, fps):
        vis = frame.copy()
        
        # Draw zones
        for side, zone in CONSOLIDATED_ZONES.items():
            col = SIDE_COLOURS[side]
            self.draw_polygon_overlay(vis, zone["work_poly"], col, alpha=0.15)
            pts = zone["seat_poly"].reshape((-1,1,2)).astype(np.int32)
            cv2.polylines(vis, [pts], True, col, 1, cv2.LINE_AA)
        
        self.draw_yband_lines(vis)
        
        # Draw phone boxes
        for b in phone_boxes:
            x1,y1,x2,y2 = map(int,b)
            cv2.rectangle(vis, (x1,y1), (x2,y2), (0,0,255), 2)
            cv2.rectangle(vis, (x1-PHONE_BOX_EXPAND_PX, y1-PHONE_BOX_EXPAND_PX),
                         (x2+PHONE_BOX_EXPAND_PX, y2+PHONE_BOX_EXPAND_PX), (0,140,255), 1)
        
        # Draw tracked persons
        for i in range(len(tracked_detections)):
            t_box = tracked_detections.xyxy[i]
            tid = int(tracked_detections.tracker_id[i]) if tracked_detections.tracker_id is not None else -1
            
            best_iou, best_idx = 0, -1
            for j, pb in enumerate(pose_boxes):
                iou = get_iou(t_box, pb)
                if iou > best_iou:
                    best_iou, best_idx = iou, j
            
            if best_idx >= 0 and best_iou > 0.3:
                kps = kps_list[best_idx]
                if len(kps) >= 11:
                    cx_f, cy_f = (t_box[0]+t_box[2])/2, (t_box[1]+t_box[3])/2
                    
                    assigned_side = next((s for s, z in CONSOLIDATED_ZONES.items() 
                                        if is_point_in_poly((cx_f,cy_f), z["seat_poly"]) or 
                                        is_point_in_poly((cx_f,cy_f), z["work_poly"])), None)
                    assigned_d_id = assign_desk_id_by_y(assigned_side, cy_f) if assigned_side else None
                    
                    person_col = DESK_COLOURS[(assigned_d_id-1)%6] if assigned_d_id else (180,180,180)
                    
                    x1,y1,x2,y2 = map(int,t_box)
                    cv2.rectangle(vis, (x1,y1), (x2,y2), person_col, 2)
                    self.draw_text(vis, f"ID:{tid}", (x1, y1-5), 0.4, person_col)
                    
                    self.draw_skeleton(vis, kps, colour=person_col)
                    
                    if assigned_d_id and assigned_d_id in desk_states:
                        ds = desk_states[assigned_d_id]
                        self.draw_wrist_trail(vis, ds.l_wrist_hist, (255,200,0))
                        self.draw_wrist_trail(vis, ds.r_wrist_hist, (200,0,255))
        
        # Draw HUD for all desks
        for d_id, ds in desk_states.items():
            abs_t = absence_timer[d_id]
            ghost_str = f" (GHOST {int(GHOSTING_ABSENCE_LIMIT - abs_t)}s)" if 0 < abs_t < GHOSTING_ABSENCE_LIMIT and ds.state != "AWAY" else ""
            self.draw_desk_hud(vis, ds, d_id, DESK_CONFIG[d_id-1]["side"], ghost_str)
        
        # Draw status bar
        status = f"FPS:{fps:.1f}  Infer:{infer_ms:.0f}ms  Time:{datetime.now().strftime('%H:%M:%S')}"
        self.draw_text(vis, status, (420,18), 0.45, (255,255,255), 1, bg=(0,0,0), alpha=0.7)
        
        return vis

# ==========================================
# 7. HELPER FUNCTIONS
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

def get_torso_box(kps):
    """ Builds a stable bounding box using only the head and shoulders to defeat occlusion jitter """
    pts = [kps[i] for i in range(13) if kps[i][2] > 0.25]
    if not pts: return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    w, h = max(10, x2-x1), max(10, y2-y1)
    return [max(0, x1 - w*0.3), max(0, y1 - h*0.3), x2 + w*0.3, y2 + h*0.6]

# ==========================================
# 8. DESK STATE MACHINE
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
        if self.state not in ["BREAK", "ON LEAVE"]:
            old_state = self.state
            self.state = "AWAY"
            self._reset_state()
            self._tally_state()
            Logger.debug(f"Desk {self.desk_id} marked AWAY (was {old_state})")
            
    def force_state_paused(self, override_state):
        self.state = override_state
        self._reset_state()
        Logger.debug(f"Desk {self.desk_id} forced to {override_state}")

    def _tally_state(self):
        if self.state in ["BREAK", "ON LEAVE"]: return
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
            "raw_counts":  self.state_counts
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
        if self.state in ["AWAY", "BREAK", "ON LEAVE"]:
            self._reset_state()
            self.state = "THINKING"

        l_shoulder, r_shoulder = kps[5], kps[6]
        l_wrist,    r_wrist    = kps[9], kps[10]
        l_elbow,    r_elbow    = kps[7], kps[8]   

        valid_posture = True
        if l_shoulder[2] > 0.5 and r_shoulder[2] > 0.5:
            sw  = math.hypot(l_shoulder[0]-r_shoulder[0], l_shoulder[1]-r_shoulder[1])
            smx, smy = (l_shoulder[0]+r_shoulder[0]) / 2, (l_shoulder[1]+r_shoulder[1]) / 2
            if l_wrist[2] > 0.5 and sw > 10 and math.hypot(l_wrist[0]-smx, l_wrist[1]-smy)/sw > MAX_SHOULDER_EXTENSION_RATIO: 
                valid_posture = False
            if r_wrist[2] > 0.5 and sw > 10 and math.hypot(r_wrist[0]-smx, r_wrist[1]-smy)/sw > MAX_SHOULDER_EXTENSION_RATIO: 
                valid_posture = False

        l_ok, l_pos = self._accept_wrist(l_wrist, self.l_wrist_last)
        r_ok, r_pos = self._accept_wrist(r_wrist, self.r_wrist_last)

        if l_ok:
            self.l_wrist_hist.append(l_pos)
            self.l_wrist_last = l_pos
            self.l_frames_since_accepted = 0
        else:
            self.l_frames_since_accepted += 1
            if self.l_frames_since_accepted >= WRIST_STALE_FRAME_LIMIT:
                self.l_wrist_hist.clear()
                self.l_wrist_last = None

        if r_ok:
            self.r_wrist_hist.append(r_pos)
            self.r_wrist_last = r_pos
            self.r_frames_since_accepted = 0
        else:
            self.r_frames_since_accepted += 1
            if self.r_frames_since_accepted >= WRIST_STALE_FRAME_LIMIT:
                self.r_wrist_hist.clear()
                self.r_wrist_last = None

        l_path, l_area = self.calculate_kinematics(self.l_wrist_hist)
        r_path, r_area = self.calculate_kinematics(self.r_wrist_hist)
        _, _, l_std    = calculate_std_dev(self.l_wrist_hist)
        _, _, r_std    = calculate_std_dev(self.r_wrist_hist)

        l_last = self.l_wrist_hist[-1] if self.l_wrist_hist else None
        r_last = self.r_wrist_hist[-1] if self.r_wrist_hist else None

        l_in_work = l_last and is_point_in_poly(l_last, self.zone_cfg["work_poly"])
        r_in_work = r_last and is_point_in_poly(r_last, self.zone_cfg["work_poly"])

        wrists_clasped = False
        if l_last and r_last and math.hypot(l_last[0]-r_last[0], l_last[1]-r_last[1]) < MIN_WRIST_SEPARATION_PX:
            wrists_clasped = True

        raw_working, is_gesturing, is_scrolling_phone = False, False, False

        if valid_posture and not wrists_clasped:
            if (l_in_work and l_path > MIN_PATH_LENGTH_TYPING and l_area < MAX_BOX_AREA_TYPING and l_std > self.min_std) or \
               (r_in_work and r_path > MIN_PATH_LENGTH_TYPING and r_area < MAX_BOX_AREA_TYPING and r_std > self.min_std):
                raw_working = True

        self.working_confirm_counter = self.working_confirm_counter + 1 if raw_working else 0
        is_working_physically = self.working_confirm_counter >= WORKING_CONFIRM_FRAMES

        if (l_path > MIN_PATH_LENGTH_GESTURE and l_area > MAX_BOX_AREA_TYPING and not l_in_work) or \
           (r_path > MIN_PATH_LENGTH_GESTURE and r_area > MAX_BOX_AREA_TYPING and not r_in_work):
            is_gesturing = True

        is_still = not is_working_physically and not is_gesturing

        for ph_box in phone_boxes:
            x1, y1 = ph_box[0] - PHONE_BOX_EXPAND_PX, ph_box[1] - PHONE_BOX_EXPAND_PX
            x2, y2 = ph_box[2] + PHONE_BOX_EXPAND_PX, ph_box[3] + PHONE_BOX_EXPAND_PX
            if l_last and point_in_rect(l_last, x1, y1, x2, y2): 
                is_scrolling_phone = True
                Logger.debug(f"Desk {self.desk_id}: Left wrist in phone zone")
            if r_last and point_in_rect(r_last, x1, y1, x2, y2): 
                is_scrolling_phone = True
                Logger.debug(f"Desk {self.desk_id}: Right wrist in phone zone")
            if l_elbow[2] > 0.5 and point_in_rect((l_elbow[0], l_elbow[1]), x1, y1, x2, y2): 
                is_scrolling_phone = True
            if r_elbow[2] > 0.5 and point_in_rect((r_elbow[0], r_elbow[1]), x1, y1, x2, y2): 
                is_scrolling_phone = True

        old_state = self.state
        
        if is_scrolling_phone:
            self.distraction_energy = min(MAX_DISTRACTION_ENERGY, self.distraction_energy + dt)
            self.phone_proximity_timer = min(MAX_PHONE_PROXIMITY_TIME, self.phone_proximity_timer + dt)
            self.work_energy = max(0.0, self.work_energy - (20.0 * dt))
        else:
            self.distraction_energy = max(0.0, self.distraction_energy - (2.0 * dt))
            self.phone_proximity_timer = max(0.0, self.phone_proximity_timer - (1.0 * dt))

        if is_working_physically and not is_scrolling_phone:
            self.work_energy = min(MAX_WORK_ENERGY, self.work_energy + (WORK_ENERGY_CHARGE_RATE * dt))
            self.gesture_energy = max(0.0, self.gesture_energy - (20.0 * dt))
            self.thinking_timer = max(0.0, self.thinking_timer - (10.0 * dt))
            self.still_timer = 0.0
        elif is_gesturing:
            self.gesture_energy = min(MAX_GESTURE_ENERGY, self.gesture_energy + (1.0 * dt))
            self.work_energy = max(0.0, self.work_energy - (20.0 * dt))
            self.thinking_timer = max(0.0, self.thinking_timer - (10.0 * dt))
            self.still_timer = 0.0
        elif is_still:
            self.still_timer += dt
            if self.still_timer > WORK_ENERGY_GRACE_SECONDS:
                self.work_energy = max(0.0, self.work_energy - (WORK_ENERGY_STILL_DRAIN * dt))
            self.gesture_energy = max(0.0, self.gesture_energy - (10.0 * dt))
            if not is_scrolling_phone:
                self.thinking_timer += dt

        if wrists_clasped:
            self.work_energy = max(0.0, self.work_energy - (WORK_ENERGY_STILL_DRAIN * dt))
            self.still_timer = 0.0
        if not valid_posture:
            self.work_energy = max(0.0, self.work_energy - (30.0 * dt))

        if self.distraction_energy >= MAX_DISTRACTION_ENERGY:
            self.state = "DISTRACTED"
        elif self.gesture_energy >= 60.0 or self.thinking_timer >= MAX_THINKING_TIME:
            self.state = "IDLE"
        elif self.work_energy >= WORKING_STATE_THRESHOLD:
            self.state = "WORKING"
        elif self.work_energy < 5.0:
            self.state = "PHONE PROXIMITY" if self.phone_proximity_timer >= MAX_PHONE_PROXIMITY_TIME else "THINKING"

        if old_state != self.state:
            Logger.debug(f"Desk {self.desk_id} state transition: {old_state} -> {self.state} "
                        f"(WE:{self.work_energy:.1f}, GE:{self.gesture_energy:.1f}, DE:{self.distraction_energy:.1f})")

        self._tally_state()

# ==========================================
# 9. FIREBASE PUSH
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
        Logger.debug("Firebase sync completed successfully")
    except Exception as e:
        Logger.error(f"Firebase Sync Failed: {e}")

# ==========================================
# 10. MAIN LOOP
# ==========================================
def main():
    print("=" * 60)
    print("🚀 WORKER EFFICIENCY PIPELINE - PRODUCTION WITH VISUAL DEBUG")
    print("=" * 60)
    
    if ENABLE_VISUAL_DEBUG:
        Logger.info("Visual debugging ENABLED")
        cv2.namedWindow(DEBUG_WINDOW_NAME, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(DEBUG_WINDOW_NAME, 1280, 720)
        visual_debugger = VisualDebugger()
    else:
        Logger.info("Visual debugging DISABLED")

    Logger.info("Loading models...")
    pose_model  = YOLO(POSE_MODEL_PATH, task='pose')
    phone_model = YOLO(PHONE_MODEL_PATH)
    tracker     = sv.ByteTrack(track_activation_threshold=0.25, minimum_matching_threshold=0.5, frame_rate=30)
    Logger.info("Models loaded successfully")

    desk_states = { d["id"]: DeskState(d, 30, CONSOLIDATED_ZONES[d["side"]]) for d in DESK_CONFIG }
    desk_absence_counter = {d["id"]: 0.0 for d in DESK_CONFIG}

    today_str = datetime.now().strftime("%Y-%m-%d")
    Logger.info(f"Checking for existing data for today ({today_str})...")
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
                    Logger.info("✅ Successfully restored today's accumulated data!")
            else:
                Logger.info("ℹ️ No previous data found for today. Starting fresh.")
        except Exception as e:
            Logger.warning(f"Could not restore data: {e}")

    Logger.info(f"📡 Connecting to RTSP Stream: {RTSP_URL}")
    cam = BufferlessVideoCapture(RTSP_URL, width=FRAME_WIDTH, height=FRAME_HEIGHT)
    if not cam.ret:
        Logger.error("Could not read stream.")
        return

    current_date       = datetime.now().date()
    current_video_file = get_video_filename()
    writer             = FFmpegVideoWriter(current_video_file, width=FRAME_WIDTH, height=FRAME_HEIGHT, fps=25)
    writer_thread      = VideoWriterThread(cam, writer)
    writer_thread.start()

    Logger.info("🎬 Pipeline Running...")
    last_time = time.time()
    frame_count = 0
    fps_smooth = 25.0

    try:
        while True:
            frame_start_time = time.time()
            current_time = frame_start_time
            now_date = datetime.now().date()
            
            if now_date > current_date:
                Logger.info("🌙 Midnight Rollover! Finalizing today's video...")
                writer_thread.running = False
                writer_thread.join()
                writer.release()

                upload_thread = threading.Thread(target=upload_video_to_drive, args=(current_video_file,))
                upload_thread.start()

                current_date       = now_date
                current_video_file = get_video_filename()
                writer             = FFmpegVideoWriter(current_video_file, width=FRAME_WIDTH, height=FRAME_HEIGHT, fps=25)
                writer_thread      = VideoWriterThread(cam, writer)
                writer_thread.start()

                for d_id in desk_states:
                    desk_states[d_id]._reset_state()
                    desk_states[d_id].total_frames = 0
                    desk_states[d_id].state_counts = {"Working": 0, "Idle": 0, "Distracted": 0, "Away": 0}

            ret, frame = cam.read()
            if not ret or frame is None:
                time.sleep(0.1)
                continue

            frame_count += 1
            dt = current_time - last_time
            last_time = current_time
            
            # Smooth FPS calculation
            fps_smooth = 0.9 * fps_smooth + 0.1 * (1.0 / max(dt, 0.001))

            # Inference
            infer_start = time.time()
            pose_results  = pose_model(frame, imgsz=640, verbose=False, conf=0.30)[0]
            phone_results = phone_model(frame, imgsz=640, verbose=False, conf=0.25)[0]
            infer_ms = (time.time() - infer_start) * 1000

            phone_boxes = [box.xyxy.cpu().numpy()[0] for box in phone_results.boxes if int(box.cls[0]) == 0] if phone_results.boxes else []
            
            kps_list = (pose_results.keypoints.data.cpu().numpy() if pose_results.keypoints else [])
            pose_boxes = pose_results.boxes.xyxy.cpu().numpy() if pose_results.boxes else []
            
            # Defeating ByteTrack occlusion
            valid_torso_boxes = []
            valid_confs = []
            valid_class_ids = []
            valid_kps_map = []

            for i, kps in enumerate(kps_list):
                torso_box = get_torso_box(kps)
                if torso_box:
                    valid_torso_boxes.append(torso_box)
                    valid_confs.append(pose_results.boxes.conf[i].cpu().item())
                    valid_class_ids.append(0)
                    valid_kps_map.append(kps)

            if valid_torso_boxes:
                detections = sv.Detections(
                    xyxy=np.array(valid_torso_boxes),
                    confidence=np.array(valid_confs),
                    class_id=np.array(valid_class_ids)
                )
                tracked_detections = tracker.update_with_detections(detections)
            else:
                tracked_detections = sv.Detections.empty()

            # System schedule & waiver check
            system_paused = is_system_paused()
            desks_updated_this_frame = set()
            now_ms = current_time * 1000

            for d_id in desk_states:
                worker_id = f"W00{d_id}"
                profile = firebase_data["profiles"].get(worker_id, {})
                waiver_until = profile.get("active_waiver_until")

                if waiver_until and waiver_until > now_ms:
                    desk_states[d_id].force_state_paused("ON LEAVE")
                    desks_updated_this_frame.add(d_id)
                elif system_paused:
                    desk_states[d_id].force_state_paused("BREAK")
                    desks_updated_this_frame.add(d_id)

            # Normal tracking for active desks
            for i in range(len(tracked_detections)):
                t_box = tracked_detections.xyxy[i]
                
                best_iou, best_idx = 0, -1
                for j, v_box in enumerate(valid_torso_boxes):
                    iou = get_iou(t_box, v_box)
                    if iou > best_iou:
                        best_iou, best_idx = iou, j

                if best_idx == -1 or best_iou < 0.3:
                    continue
                    
                kps = valid_kps_map[best_idx]
                if len(kps) < 11:
                    continue

                center = ((t_box[0]+t_box[2])/2, (t_box[1]+t_box[3])/2)
                cx, cy = center

                assigned_side = None
                for side, zone in CONSOLIDATED_ZONES.items():
                    if is_point_in_poly(center, zone["seat_poly"]) or is_point_in_poly(center, zone["work_poly"]):
                        assigned_side = side
                        break

                assigned_d_id = None
                if assigned_side:
                    assigned_d_id = assign_desk_id_by_y(assigned_side, cy)

                if assigned_d_id and assigned_d_id not in desks_updated_this_frame:
                    desk_states[assigned_d_id].update(dt, kps, phone_boxes)
                    desks_updated_this_frame.add(assigned_d_id)

            # Ghosting window check
            for d_id in desk_states:
                if d_id in desks_updated_this_frame:
                    desk_absence_counter[d_id] = 0.0
                else:
                    desk_absence_counter[d_id] += dt
                    if desk_absence_counter[d_id] >= GHOSTING_ABSENCE_LIMIT:
                        desk_states[d_id].mark_away()

            # Visual debugging
            if ENABLE_VISUAL_DEBUG:
                debug_frame = visual_debugger.render_frame(
                    frame, desk_states, phone_boxes, tracked_detections,
                    kps_list, pose_boxes, desk_absence_counter, infer_ms, fps_smooth
                )
                cv2.imshow(DEBUG_WINDOW_NAME, debug_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    Logger.info("User requested shutdown via 'q' key")
                    break

            push_to_firestore_rate_limited(desk_states)
            
            if frame_count % 300 == 0:  # Log every ~300 frames
                Logger.info(f"Frame {frame_count}: FPS={fps_smooth:.1f}, Inference={infer_ms:.0f}ms")

    except KeyboardInterrupt:
        Logger.info("Shutting down gracefully...")
    finally:
        writer_thread.running = False
        writer_thread.join()
        cam.release()
        writer.release()
        if ENABLE_VISUAL_DEBUG:
            cv2.destroyAllWindows()
        Logger.info("✅ Pipeline Offline.")

if __name__ == "__main__":
    main()