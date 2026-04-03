"""
debug_visual.py — 2-minute live visual debugger for the worker efficiency pipeline.

Run this independently alongside (or instead of) main.py:
    python debug_visual.py

What it draws on each frame
───────────────────────────
  • CONSOLIDATED work + seat polygons (left side / right side, semi-transparent fills)
  • Y-band desk assignment lines (dashed horizontal lines showing desk boundaries)
  • Pose skeleton  — joints (coloured by confidence) + limb sticks
  • Wrist trails   — last N positions for L (cyan) and R (magenta) wrists
  • Elbow keypoints highlighted (used for phone proximity on top-down camera)
  • Phone boxes    — raw detection (red) + expanded proximity region (orange dashed)
  • Per-desk HUD   — live state badge, energy bars, % counters, absence timer
  • Global overlay — FPS, frame counter, 120-s countdown, model inference time
  • Wrist-gate viz — rejected wrists shown as hollow red X circles

Firebase is NOT called. VideoWriter is NOT started.
Window auto-closes after 120 seconds and saves a snapshot to debug_snapshot.jpg.

Press  Q  to quit early.  Press  S  to save a snapshot at any time.
"""

import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO
from shapely.geometry import Polygon, Point
from collections import deque
import math
import time
import subprocess
import threading
from datetime import datetime
import os

# ── Config ────────────────────────────────────────────────────────────────────
RTSP_URL         = "rtsp://admin:CBKLVW@172.16.15.121:554/streaming/channels/101/"
POSE_MODEL_PATH  = "yolo11l-pose.pt"
PHONE_MODEL_PATH = "best (13).pt"

DEBUG_DURATION_S   = 120
WRIST_TRAIL_MAXLEN = 30
SNAPSHOT_PATH      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug_snapshot.jpg")

FRAME_HEIGHT = 1080
FRAME_WIDTH  = 1920

# ── CONSOLIDATED ZONES (mirrors main.py exactly) ──────────────────────────────
CONSOLIDATED_ZONES = {
    "left": {
        "desk_ids": [1, 2, 3],
        "work_poly": np.array([[643, 1073], [660, 710], [691, 673], [749, 0], [1120, 2], [1032, 1066], [1031, 1073], [644, 1068]]),
        "seat_poly": np.array([[382, 2], [339, 457], [341, 624], [336, 814], [355, 900],
                               [392, 1040], [414, 1077], [694, 1072], [819, 0], [383, 1]])
    },
    "right": {
        "desk_ids": [4, 5, 6],
        "work_poly": np.array([[1398, 1077], [1469, 745], [1490, 566], [1498, 468],
                               [1523, 265], [1532, 3], [1183, 0], [1125, 1063], [1397, 1076]]),
        "seat_poly": np.array([[1368, 1065], [1442, 711], [1476, 387], [1490, 2], [1909, 3], [1875, 577], [1776, 1071], [1364, 1072]])
    }
}

# Individual desk configs — only id, min_std, side (no polys)
DESK_CONFIG = [
    { "id": 1, "min_std": 1.8, "side": "left"  },
    { "id": 2, "min_std": 2.0, "side": "left"  },
    { "id": 3, "min_std": 2.0, "side": "left"  },
    { "id": 4, "min_std": 3.8, "side": "right" },
    { "id": 5, "min_std": 2.0, "side": "right" },
    { "id": 6, "min_std": 1.8, "side": "right" },
]

# ── Constants (mirrors main.py) ───────────────────────────────────────────────
WRIST_CONF_GATE         = 0.65
WRIST_MAX_VELOCITY_PX   = 80.0
WRIST_STALE_FRAME_LIMIT = 60
PHONE_BOX_EXPAND_PX     = 35    # increased from 24 — covers wrist-to-hand gap

# ── Colour palette (BGR) ──────────────────────────────────────────────────────
DESK_COLOURS = [
    (255, 180,  60),   # 1 — amber
    ( 60, 200, 255),   # 2 — sky blue
    ( 80, 255, 120),   # 3 — green
    (255,  80, 180),   # 4 — pink
    (255, 255,  80),   # 5 — yellow
    (180,  80, 255),   # 6 — violet
]
SIDE_COLOURS = {
    "left":  ( 60, 200, 255),  # blue tint for left zone
    "right": (255, 180,  60),  # amber tint for right zone
}
STATE_COLOURS = {
    "WORKING":         ( 60, 220,  60),
    "THINKING":        (220, 180,  60),
    "IDLE":            ( 60, 180, 220),
    "DISTRACTED":      ( 60,  60, 220),
    "PHONE PROXIMITY": ( 60, 100, 255),
    "AWAY":            (130, 130, 130),
}

KP_LIMBS = [
    (5,6),(5,7),(7,9),(6,8),(8,10),
    (5,11),(6,12),(11,12),
    (11,13),(13,15),(12,14),(14,16),
    (0,5),(0,6),
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def in_poly(pt, arr):
    return Polygon(arr).contains(Point(pt))

def get_iou(b1, b2):
    xi1=max(b1[0],b2[0]); yi1=max(b1[1],b2[1])
    xi2=min(b1[2],b2[2]); yi2=min(b1[3],b2[3])
    inter = max(0,xi2-xi1)*max(0,yi2-yi1)
    union = ((b1[2]-b1[0])*(b1[3]-b1[1]))+((b2[2]-b2[0])*(b2[3]-b2[1]))-inter
    return inter/union if union>0 else 0

def assign_desk_id_by_y(side, y_pos):
    """Top→bottom: left = 3→2→1, right = 6→5→4"""
    segment = FRAME_HEIGHT / 3.0
    if side == "left":
        if y_pos < segment:       return 3
        elif y_pos < segment*2:   return 2
        else:                     return 1
    else:
        if y_pos < segment:       return 6
        elif y_pos < segment*2:   return 5
        else:                     return 4

def pt_in_rect(pt, x1, y1, x2, y2):
    return x1 <= pt[0] <= x2 and y1 <= pt[1] <= y2


# ── Bufferless capture ────────────────────────────────────────────────────────
class BufferlessCapture:
    def __init__(self, url, w=1920, h=1080):
        self.w, self.h = w, h
        self.frame_size = w * h * 3
        cmd = ["ffmpeg", "-rtsp_transport", "tcp", "-timeout", "30000000",
               "-i", url, "-f", "rawvideo", "-pix_fmt", "bgr24",
               "-vf", f"scale={w}:{h}", "-"]
        self.pipe = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, bufsize=10**8)
        self._lock = threading.Lock()
        self.ret, self.frame, self.running = False, None, True
        threading.Thread(target=self._reader, daemon=True).start()
        for _ in range(30):
            if self.ret: break
            time.sleep(1.0)

    def _reader(self):
        while self.running:
            raw = self.pipe.stdout.read(self.frame_size)
            if len(raw) == self.frame_size:
                with self._lock:
                    self.frame = np.frombuffer(raw, np.uint8).reshape(
                        (self.h, self.w, 3)).copy()
                    self.ret = True
            else:
                self.running = False

    def read(self):
        with self._lock:
            return self.ret, (self.frame.copy() if self.frame is not None else None)

    def release(self):
        self.running = False
        try: self.pipe.kill()
        except: pass


# ── Per-desk debug state ──────────────────────────────────────────────────────
class DebugDeskState:
    """
    Mirrors the energy physics of DeskState (main.py) exactly:
      - Consolidated zone for work_poly check
      - Elbow keypoints added to phone proximity check
      - gesture_energy charge rate = 1.0/s  → 80s to reach IDLE threshold
      - thinking_timer still triggers IDLE at 120s
    """

    def __init__(self, cfg, zone_cfg):
        self.id       = cfg["id"]
        self.cfg      = cfg
        self.zone_cfg = zone_cfg          # consolidated zone for this desk's side
        self.state    = "AWAY"

        self.work_e  = 0.0
        self.dist_e  = 0.0
        self.gest_e  = 0.0
        self.think_t = 0.0
        self.phone_t = 0.0
        self.still_t = 0.0
        self.confirm_n = 0
        self.absence_t = 0.0

        self.l_trail: deque = deque(maxlen=WRIST_TRAIL_MAXLEN)
        self.r_trail: deque = deque(maxlen=WRIST_TRAIL_MAXLEN)
        self.l_last   = None
        self.r_last   = None
        self.l_stale  = 0
        self.r_stale  = 0

        self.frame_counts = {"Working": 0, "Idle": 0, "Distracted": 0, "Away": 0}
        self.total_frames = 0

        # Wrist + elbow gating debug info (for hollow-circle viz)
        self.l_wrist_raw  = None   # (x, y, conf)
        self.r_wrist_raw  = None
        self.l_elbow_raw  = None
        self.r_elbow_raw  = None
        self.l_accepted   = False
        self.r_accepted   = False
        # Was phone detected via elbow (not wrist)?
        self.phone_via_elbow = False

    def update(self, dt, kps, phone_boxes):
        if self.state == "AWAY":
            self._reset_physics()
            self.state = "THINKING"

        MIN_PATH_TYPING  = 5.0
        MAX_AREA_TYPING  = 2000.0
        MIN_PATH_GESTURE = 15.0
        MAX_SHOULDER_EXT = 2.5
        MIN_WRIST_SEP    = 70.0
        WORK_CHARGE      = 30.0
        WORK_DRAIN_STILL = 5.0
        GRACE_S          = 3.0
        WORK_THRESHOLD   = 60.0
        CONFIRM_FRAMES   = 3

        ls, rs = kps[5], kps[6]   # shoulders
        lw, rw = kps[9], kps[10]  # wrists
        le, re = kps[7], kps[8]   # elbows

        # Store raw keypoints for viz
        self.l_wrist_raw = (lw[0], lw[1], lw[2])
        self.r_wrist_raw = (rw[0], rw[1], rw[2])
        self.l_elbow_raw = (le[0], le[1], le[2])
        self.r_elbow_raw = (re[0], re[1], re[2])
        self.phone_via_elbow = False

        # Posture gate
        valid_posture = True
        if ls[2] > 0.5 and rs[2] > 0.5:
            sw  = math.hypot(ls[0]-rs[0], ls[1]-rs[1])
            smx = (ls[0]+rs[0])/2; smy = (ls[1]+rs[1])/2
            if lw[2]>0.5 and sw>10 and math.hypot(lw[0]-smx,lw[1]-smy)/sw > MAX_SHOULDER_EXT:
                valid_posture = False
            if rw[2]>0.5 and sw>10 and math.hypot(rw[0]-smx,rw[1]-smy)/sw > MAX_SHOULDER_EXT:
                valid_posture = False

        # Wrist gating
        def accept(kp, last):
            x, y, c = kp
            if c < WRIST_CONF_GATE: return False, None
            if last and math.hypot(x-last[0], y-last[1]) > WRIST_MAX_VELOCITY_PX:
                return False, None
            return True, (x, y)

        l_ok, l_pos = accept(lw, self.l_last)
        r_ok, r_pos = accept(rw, self.r_last)
        self.l_accepted = l_ok
        self.r_accepted = r_ok

        if l_ok:
            self.l_trail.append(l_pos); self.l_last = l_pos; self.l_stale = 0
        else:
            self.l_stale += 1
            if self.l_stale >= WRIST_STALE_FRAME_LIMIT:
                self.l_trail.clear(); self.l_last = None

        if r_ok:
            self.r_trail.append(r_pos); self.r_last = r_pos; self.r_stale = 0
        else:
            self.r_stale += 1
            if self.r_stale >= WRIST_STALE_FRAME_LIMIT:
                self.r_trail.clear(); self.r_last = None

        def kin(trail):
            if len(trail) < 2: return 0.0, 0.0
            pts  = list(trail)
            path = sum(math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])
                       for i in range(1, len(pts)))
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            return path, (max(xs)-min(xs))*(max(ys)-min(ys))

        def std_avg(trail):
            if len(trail) < 3: return 0.0
            xs=[p[0] for p in trail]; ys=[p[1] for p in trail]
            return (float(np.std(xs))+float(np.std(ys)))/2.0

        l_path, l_area = kin(self.l_trail)
        r_path, r_area = kin(self.r_trail)
        l_std = std_avg(self.l_trail)
        r_std = std_avg(self.r_trail)

        l_last_pt = self.l_trail[-1] if self.l_trail else None
        r_last_pt = self.r_trail[-1] if self.r_trail else None

        # ── Use CONSOLIDATED work_poly ────────────────────────────────────────
        l_in_work = l_last_pt and in_poly(l_last_pt, self.zone_cfg["work_poly"])
        r_in_work = r_last_pt and in_poly(r_last_pt, self.zone_cfg["work_poly"])

        wrists_clasped = (l_last_pt and r_last_pt and
                          math.hypot(l_last_pt[0]-r_last_pt[0],
                                     l_last_pt[1]-r_last_pt[1]) < MIN_WRIST_SEP)

        raw_working = False
        if valid_posture and not wrists_clasped:
            if (l_in_work and l_path>MIN_PATH_TYPING and l_area<MAX_AREA_TYPING and l_std>self.cfg["min_std"]) or \
               (r_in_work and r_path>MIN_PATH_TYPING and r_area<MAX_AREA_TYPING and r_std>self.cfg["min_std"]):
                raw_working = True

        self.confirm_n = self.confirm_n + 1 if raw_working else 0
        is_working_phys = self.confirm_n >= CONFIRM_FRAMES

        is_gesturing = ((l_path>MIN_PATH_GESTURE and l_area>MAX_AREA_TYPING and not l_in_work) or
                        (r_path>MIN_PATH_GESTURE and r_area>MAX_AREA_TYPING and not r_in_work))
        is_still = not is_working_phys and not is_gesturing

        # ── Phone proximity — wrist + elbow check ────────────────────────────
        is_scrolling = False
        for b in phone_boxes:
            x1 = b[0]-PHONE_BOX_EXPAND_PX; y1 = b[1]-PHONE_BOX_EXPAND_PX
            x2 = b[2]+PHONE_BOX_EXPAND_PX; y2 = b[3]+PHONE_BOX_EXPAND_PX

            # Wrist checks
            if l_last_pt and pt_in_rect(l_last_pt, x1, y1, x2, y2): is_scrolling = True
            if r_last_pt and pt_in_rect(r_last_pt, x1, y1, x2, y2): is_scrolling = True

            # Elbow checks — compensates for wrist KP drift on top-down camera
            if le[2] > 0.5:
                le_pos = (le[0], le[1])
                if pt_in_rect(le_pos, x1, y1, x2, y2):
                    is_scrolling = True
                    self.phone_via_elbow = True
            if re[2] > 0.5:
                re_pos = (re[0], re[1])
                if pt_in_rect(re_pos, x1, y1, x2, y2):
                    is_scrolling = True
                    self.phone_via_elbow = True

        # ── Energy physics ────────────────────────────────────────────────────
        MAX_DE=180; MAX_WE=100; MAX_GE=100; MAX_TT=120; MAX_PT=180

        if is_scrolling:
            self.dist_e  = min(MAX_DE, self.dist_e + dt)
            self.phone_t = min(MAX_PT, self.phone_t + dt)
            self.work_e  = max(0.0, self.work_e - 20.0*dt)
        else:
            self.dist_e  = max(0.0, self.dist_e - 2.0*dt)
            self.phone_t = max(0.0, self.phone_t - 1.0*dt)

        if is_working_phys and not is_scrolling:
            self.work_e  = min(MAX_WE, self.work_e + WORK_CHARGE*dt)
            self.gest_e  = max(0.0, self.gest_e  - 20.0*dt)
            self.think_t = max(0.0, self.think_t - 10.0*dt)
            self.still_t = 0.0
        elif is_gesturing:
            # Slowed charge rate: 1.0/s → need 80s of continuous gesturing to hit 80.0
            self.gest_e  = min(MAX_GE, self.gest_e  + 1.0*dt)
            self.work_e  = max(0.0, self.work_e  - 20.0*dt)
            self.think_t = max(0.0, self.think_t - 10.0*dt)
            self.still_t = 0.0
        elif is_still:
            self.still_t += dt
            if self.still_t > GRACE_S:
                self.work_e = max(0.0, self.work_e - WORK_DRAIN_STILL*dt)
            self.gest_e = max(0.0, self.gest_e - 10.0*dt)
            if not is_scrolling: self.think_t += dt

        if wrists_clasped:
            self.work_e  = max(0.0, self.work_e - WORK_DRAIN_STILL*dt)
            self.still_t = 0.0
        if not valid_posture:
            self.work_e = max(0.0, self.work_e - 30.0*dt)

        # ── State transitions ─────────────────────────────────────────────────
        if   self.dist_e >= MAX_DE:
            self.state = "DISTRACTED"
        elif self.gest_e >= 70.0 or self.think_t >= MAX_TT:
            self.state = "IDLE"
        elif self.work_e >= WORK_THRESHOLD:
            self.state = "WORKING"
        elif self.work_e < 5.0:
            self.state = "PHONE PROXIMITY" if self.phone_t >= MAX_PT else "THINKING"

        # Tally
        self.total_frames += 1
        if self.state in ("WORKING", "THINKING"):
            self.frame_counts["Working"] += 1
        elif self.state == "IDLE":
            self.frame_counts["Idle"] += 1
        elif self.state in ("DISTRACTED", "PHONE PROXIMITY"):
            self.frame_counts["Distracted"] += 1
        else:
            self.frame_counts["Away"] += 1

    def mark_away(self):
        self.state = "AWAY"
        self._reset_physics()
        self.l_trail.clear(); self.r_trail.clear()
        self.l_last = self.r_last = None
        self.total_frames += 1
        self.frame_counts["Away"] += 1

    def _reset_physics(self):
        self.work_e = self.dist_e = self.gest_e = 0.0
        self.think_t = self.phone_t = self.still_t = 0.0
        self.confirm_n = 0


# ── Drawing helpers ───────────────────────────────────────────────────────────
FONT = cv2.FONT_HERSHEY_SIMPLEX

def draw_text(img, text, pos, scale=0.5, color=(255,255,255), thickness=1,
              bg=None, alpha=0.6):
    x, y = pos
    (tw, th), bl = cv2.getTextSize(text, FONT, scale, thickness)
    if bg is not None:
        pad = 4
        overlay = img.copy()
        cv2.rectangle(overlay, (x-pad, y-th-pad), (x+tw+pad, y+bl+pad), bg, -1)
        cv2.addWeighted(overlay, alpha, img, 1-alpha, 0, img)
    cv2.putText(img, text, (x, y), FONT, scale, color, thickness, cv2.LINE_AA)


def draw_polygon_overlay(img, pts, colour, alpha=0.18):
    pts32 = pts.reshape((-1,1,2)).astype(np.int32)
    overlay = img.copy()
    cv2.fillPoly(overlay, [pts32], colour)
    cv2.addWeighted(overlay, alpha, img, 1-alpha, 0, img)
    cv2.polylines(img, [pts32], True, colour, 1, cv2.LINE_AA)


def draw_skeleton(img, kps, colour=(200,200,200)):
    for a, b in KP_LIMBS:
        if kps[a][2]>0.3 and kps[b][2]>0.3:
            cv2.line(img,
                     (int(kps[a][0]), int(kps[a][1])),
                     (int(kps[b][0]), int(kps[b][1])),
                     colour, 2, cv2.LINE_AA)
    for i, (x, y, c) in enumerate(kps):
        if c < 0.3: continue
        r = 6 if i in (9,10) else 5 if i in (7,8) else 4
        kp_col = (0,255,0) if c>0.7 else (0,200,255) if c>0.5 else (0,100,200)
        cv2.circle(img, (int(x),int(y)), r, kp_col, -1, cv2.LINE_AA)
        cv2.circle(img, (int(x),int(y)), r, (0,0,0),  1, cv2.LINE_AA)


def draw_wrist_trail(img, trail, colour, dot_r=3):
    pts = list(trail); n = len(pts)
    for i in range(1, n):
        frac = i / n
        c = tuple(int(v*frac) for v in colour)
        cv2.line(img,
                 (int(pts[i-1][0]),int(pts[i-1][1])),
                 (int(pts[i][0]),  int(pts[i][1])),
                 c, 2, cv2.LINE_AA)
    if pts:
        cv2.circle(img, (int(pts[-1][0]),int(pts[-1][1])), dot_r+1, colour, -1)


def draw_energy_bar(img, x, y, w, h, value, max_val, label, colour):
    cv2.rectangle(img, (x,y),(x+w,y+h),(50,50,50),-1)
    fill = int(w * min(value, max_val) / max_val)
    if fill > 0:
        cv2.rectangle(img,(x,y),(x+fill,y+h),colour,-1)
    cv2.rectangle(img,(x,y),(x+w,y+h),(120,120,120),1)
    draw_text(img, f"{label}:{value:.0f}", (x+w+4, y+h-1), 0.35, (200,200,200))


def draw_desk_hud(img, ds: DebugDeskState, hud_x: int, hud_y: int):
    col = DESK_COLOURS[(ds.id-1) % len(DESK_COLOURS)]
    sc  = STATE_COLOURS.get(ds.state, (130,130,130))
    bar_w = 80

    draw_text(img, f"DESK {ds.id} ({ds.cfg['side'].upper()})",
              (hud_x, hud_y+12), 0.45, col, 1, bg=(20,20,20))
    draw_text(img, ds.state, (hud_x, hud_y+30), 0.45, sc, 1, bg=(20,20,20))

    bars = [
        (ds.work_e,  100, "WRK", ( 60,220, 60)),
        (ds.dist_e,  120, "DST", ( 60, 60,220)),
        (ds.gest_e,  100, "GST", (220,180, 60)),
        (ds.think_t, 120, "THK", ( 60,200,220)),
        (ds.phone_t, 120, "PHN", ( 60,100,255)),
    ]
    for i, (val, mx, lbl, bc) in enumerate(bars):
        draw_energy_bar(img, hud_x, hud_y+40+i*14, bar_w, 10, val, mx, lbl, bc)

    t = max(1, ds.total_frames)
    pct = {k: int(v/t*100) for k, v in ds.frame_counts.items()}
    pct_str = f"W{pct['Working']:02d} I{pct['Idle']:02d} D{pct['Distracted']:02d} A{pct['Away']:02d}"
    draw_text(img, pct_str, (hud_x, hud_y+122), 0.38, (190,190,190))

    # Gesture IDLE progress (how far to 80s)
    gest_pct = int((ds.gest_e / 80.0) * 100)
    draw_text(img, f"IDLE@80s:{gest_pct}%", (hud_x, hud_y+136), 0.35, (220,180,60))


def draw_yband_lines(img):
    """Draw horizontal dashed lines showing Y-band desk assignment boundaries."""
    segment = FRAME_HEIGHT / 3
    for y_line in [int(segment), int(segment*2)]:
        for x in range(0, FRAME_WIDTH, 20):
            cv2.line(img, (x, y_line), (x+10, y_line), (200,200,200), 1)
    # Labels
    draw_text(img, "Band TOP  (D3/D6)", (FRAME_WIDTH//2-100, int(segment*0.5)),
              0.4, (200,200,200), 1, bg=(0,0,0), alpha=0.5)
    draw_text(img, "Band MID  (D2/D5)", (FRAME_WIDTH//2-100, int(segment*1.5)),
              0.4, (200,200,200), 1, bg=(0,0,0), alpha=0.5)
    draw_text(img, "Band BOT  (D1/D4)", (FRAME_WIDTH//2-100, int(segment*2.5)),
              0.4, (200,200,200), 1, bg=(0,0,0), alpha=0.5)


# ── Main debug loop ───────────────────────────────────────────────────────────
def main():
    print("🔍 Debug mode starting — will run for", DEBUG_DURATION_S, "seconds")
    print("   Press Q to quit early, S to save snapshot")

    pose_model  = YOLO(POSE_MODEL_PATH,  task='pose')
    phone_model = YOLO(PHONE_MODEL_PATH)
    tracker     = sv.ByteTrack(track_activation_threshold=0.25,
                               minimum_matching_threshold=0.5, frame_rate=30)

    # Build debug states — each desk gets its consolidated zone
    desk_states   = {
        d["id"]: DebugDeskState(d, CONSOLIDATED_ZONES[d["side"]])
        for d in DESK_CONFIG
    }
    absence_timer = {d["id"]: 0.0 for d in DESK_CONFIG}

    print("📡 Connecting to stream…")
    cam = BufferlessCapture(RTSP_URL)
    if not cam.ret:
        print("❌ Could not read stream. Check RTSP_URL.")
        return

    cv2.namedWindow("Debug View", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Debug View", 1280, 720)

    start_time = time.time()
    last_time  = start_time
    frame_idx  = 0

    # HUD positions: 6 desks in two columns
    HUD_POSITIONS = {
        1: (10,  10),  2: (10, 165), 3: (10, 320),
        4: (210, 10),  5: (210,165), 6: (210,320),
    }

    try:
        while True:
            t_now    = time.time()
            elapsed  = t_now - start_time
            dt       = t_now - last_time
            last_time = t_now

            if elapsed >= DEBUG_DURATION_S:
                print(f"⏱️  {DEBUG_DURATION_S}s reached — saving snapshot and closing.")
                break

            ret, frame = cam.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue

            frame_idx += 1
            t_infer = time.time()

            # ── Inference ─────────────────────────────────────────────────────
            pose_res  = pose_model (frame, imgsz=640, verbose=False, conf=0.50)[0]
            phone_res = phone_model(frame, imgsz=640, verbose=False, conf=0.25)[0]
            infer_ms  = (time.time()-t_infer)*1000

            phone_boxes = ([b.xyxy.cpu().numpy()[0]
                            for b in phone_res.boxes if int(b.cls[0])==0]
                           if phone_res.boxes else [])

            detections = sv.Detections.from_ultralytics(pose_res)
            tracked    = tracker.update_with_detections(detections)
            kps_list   = (pose_res.keypoints.data.cpu().numpy()
                          if pose_res.keypoints else [])
            pose_boxes = pose_res.boxes.xyxy.cpu().numpy()

            # ── Canvas ───────────────────────────────────────────────────────
            vis = frame.copy()

            # 1. Consolidated zone polygons (two sides, distinct colours)
            for side, zone in CONSOLIDATED_ZONES.items():
                col = SIDE_COLOURS[side]
                draw_polygon_overlay(vis, zone["work_poly"], col, alpha=0.15)
                # seat poly: border only
                pts = zone["seat_poly"].reshape((-1,1,2)).astype(np.int32)
                cv2.polylines(vis, [pts], True, col, 1, cv2.LINE_AA)
                # Label
                cx = int(zone["work_poly"][:,0].mean())
                cy = int(zone["work_poly"][:,1].mean())
                draw_text(vis, f"{side.upper()} ZONE", (cx-40, cy),
                          0.6, col, 2, bg=(0,0,0), alpha=0.5)

            # 2. Y-band assignment lines
            draw_yband_lines(vis)

            # 3. Phone boxes
            for b in phone_boxes:
                x1,y1,x2,y2 = map(int,b)
                cv2.rectangle(vis,(x1,y1),(x2,y2),(0,0,255),2)
                ex = PHONE_BOX_EXPAND_PX
                cv2.rectangle(vis,(x1-ex,y1-ex),(x2+ex,y2+ex),(0,140,255),1)
                draw_text(vis,"PHONE",(x1,y1-6),0.45,(0,0,255),1,bg=(0,0,0))

            # 4. Per-person overlays
            desks_seen = set()

            for i in range(len(tracked)):
                t_box = tracked.xyxy[i]
                tid   = int(tracked.tracker_id[i]) if tracked.tracker_id is not None else -1

                best_iou, best_idx = 0, -1
                for j, pb in enumerate(pose_boxes):
                    iou = get_iou(t_box, pb)
                    if iou > best_iou: best_iou, best_idx = iou, j

                kps = kps_list[best_idx] if best_iou > 0.5 and best_idx >= 0 else []
                if len(kps) < 11: continue

                cx_f = (t_box[0]+t_box[2])/2
                cy_f = (t_box[1]+t_box[3])/2

                # ── Consolidated zone assignment ──────────────────────────────
                assigned_side = None
                for side, zone in CONSOLIDATED_ZONES.items():
                    if in_poly((cx_f,cy_f), zone["seat_poly"]) or \
                       in_poly((cx_f,cy_f), zone["work_poly"]):
                        assigned_side = side
                        break

                assigned_d_id = None
                if assigned_side:
                    assigned_d_id = assign_desk_id_by_y(assigned_side, cy_f)

                person_col = (DESK_COLOURS[(assigned_d_id-1)%6]
                              if assigned_d_id else (180,180,180))

                # Bounding box
                x1,y1,x2,y2 = map(int,t_box)
                cv2.rectangle(vis,(x1,y1),(x2,y2),person_col,2)
                label = (f"ID{tid} → D{assigned_d_id}" if assigned_d_id
                         else f"ID{tid} (no zone)")
                draw_text(vis, label, (x1, y1-6), 0.45, person_col, 1, bg=(0,0,0))

                # Skeleton
                draw_skeleton(vis, kps, colour=person_col)

                if assigned_d_id:
                    ds = desk_states[assigned_d_id]
                    ds.update(dt, kps, phone_boxes)
                    desks_seen.add(assigned_d_id)

                    # Wrist trails
                    draw_wrist_trail(vis, ds.l_trail, (255,200,  0))  # left  — amber
                    draw_wrist_trail(vis, ds.r_trail, (200,  0,255))  # right — magenta

                    # ── Wrist gating debug circles ────────────────────────────
                    for wraw, accepted, trail_col in [
                        (ds.l_wrist_raw, ds.l_accepted, (255,200,0)),
                        (ds.r_wrist_raw, ds.r_accepted, (200,0,255)),
                    ]:
                        if wraw and wraw[2] > 0:
                            wx, wy = int(wraw[0]), int(wraw[1])
                            if accepted:
                                cv2.circle(vis,(wx,wy),9,trail_col,2)
                            else:
                                cv2.circle(vis,(wx,wy),9,(0,0,255),2)
                                cv2.line(vis,(wx-7,wy-7),(wx+7,wy+7),(0,0,255),2)
                                cv2.line(vis,(wx+7,wy-7),(wx-7,wy+7),(0,0,255),2)
                                reason = "conf" if wraw[2]<WRIST_CONF_GATE else "vel"
                                draw_text(vis, reason,(wx+10,wy),0.35,(0,100,255))

                    # ── Elbow keypoint highlight ──────────────────────────────
                    # Orange ring = elbow present, Red ring = elbow triggered phone
                    for eraw, triggered in [
                        (ds.l_elbow_raw, ds.phone_via_elbow),
                        (ds.r_elbow_raw, ds.phone_via_elbow),
                    ]:
                        if eraw and eraw[2] > 0.5:
                            ex_pt, ey_pt = int(eraw[0]), int(eraw[1])
                            ring_col = (0,60,255) if triggered else (0,165,255)
                            cv2.circle(vis,(ex_pt,ey_pt),11,ring_col,2,cv2.LINE_AA)
                            if triggered:
                                draw_text(vis,"📱ELBOW",(ex_pt+12,ey_pt),
                                          0.38,(0,60,255),1,bg=(0,0,0))

            # 5. Absence + mark-away
            for d_id in desk_states:
                if d_id in desks_seen:
                    absence_timer[d_id] = 0.0
                else:
                    absence_timer[d_id] += dt
                    if absence_timer[d_id] >= 3.0:
                        desk_states[d_id].mark_away()

            # 6. Per-desk HUD panels
            for d_id, ds in desk_states.items():
                hx, hy = HUD_POSITIONS[d_id]
                draw_desk_hud(vis, ds, hx, hy)

            # 7. Global status bar
            fps_inst  = 1.0 / max(dt, 0.001)
            remaining = max(0.0, DEBUG_DURATION_S-elapsed)
            status = (f"Frame:{frame_idx:04d}  FPS:{fps_inst:.1f}  "
                      f"Infer:{infer_ms:.0f}ms  Remaining:{remaining:.0f}s  "
                      f"People:{len(tracked)}  Phones:{len(phone_boxes)}")
            draw_text(vis, status, (420,18), 0.45,(255,255,255),1,bg=(0,0,0),alpha=0.7)

            # Progress bar
            bar_x = 420; bar_y = 25
            bar_w = vis.shape[1]-bar_x-10
            prog_w = int(bar_w * elapsed / DEBUG_DURATION_S)
            cv2.rectangle(vis,(bar_x,bar_y),(bar_x+bar_w,bar_y+5),(60,60,60),-1)
            cv2.rectangle(vis,(bar_x,bar_y),(bar_x+prog_w,bar_y+5),(0,200,255),-1)

            # Legend (bottom-left)
            legend_items = [
                ("CONSOLIDATED WORK ZONE (filled)",  SIDE_COLOURS["left"]),
                ("CONSOLIDATED SEAT ZONE (border)",  SIDE_COLOURS["right"]),
                ("Y-BAND DESK ASSIGNMENT (dashed)",  (200,200,200)),
                ("PHONE BOX raw (red) / expanded",   (0,100,255)),
                ("WRIST accepted (coloured ring)",    (255,200,0)),
                ("WRIST rejected (red X)",            (0,0,255)),
                ("ELBOW ring (phone proximity)",      (0,165,255)),
            ]
            for li, (ltxt, lcol) in enumerate(legend_items):
                draw_text(vis, ltxt,
                          (10, FRAME_HEIGHT-120+li*16),
                          0.35, lcol, 1, bg=(0,0,0), alpha=0.55)

            cv2.imshow("Debug View", vis)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                print("🛑 Quit requested.")
                break
            if key == ord('s'):
                cv2.imwrite(SNAPSHOT_PATH, vis)
                print(f"📸 Snapshot saved → {SNAPSHOT_PATH}")

    except KeyboardInterrupt:
        print("\n🛑 Interrupted.")
    finally:
        ret, frame = cam.read()
        if ret and frame is not None:
            cv2.imwrite(SNAPSHOT_PATH, frame)
            print(f"📸 Final snapshot → {SNAPSHOT_PATH}")
        cam.release()
        cv2.destroyAllWindows()
        print("✅ Debug session ended.")


if __name__ == "__main__":
    main()