from flask import Flask, request, jsonify
import cv2
import numpy as np
import time
import os
import uuid

# --- CONFIGURATION ---
VIDEO_UPLOAD_DIR = "uploads"
os.makedirs(VIDEO_UPLOAD_DIR, exist_ok=True)

# Constants
LOITERING_TIME_THRESHOLD = 2
ROI_X, ROI_Y, ROI_W, ROI_H = 0, 0, 1000, 800
MIN_CONTOUR_AREA = 1000
STANDING_ASPECT_RATIO_THRESHOLD = 1.2


class LoiteringDetector:
    def __init__(self, video_source):
        self.cap = cv2.VideoCapture(video_source)
        if not self.cap.isOpened():
            raise Exception(f"Error: Could not open video source {video_source}")
            
        self.frame_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.frame_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fgbg = cv2.createBackgroundSubtractorMOG2(history=1000, varThreshold=12, detectShadows=True)
        self.tracked_objects = {}
        self.next_object_id = 0
        self.loitering_report = {}

    def process_frame(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        fgmask = self.fgbg.apply(gray)
        _, thresh = cv2.threshold(fgmask, 254, 255, cv2.THRESH_BINARY)
        kernel = np.ones((5, 5), np.uint8)
        thresh = cv2.dilate(thresh, kernel, iterations=2)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        current_active_ids = set()

        for contour in contours:
            if cv2.contourArea(contour) < MIN_CONTOUR_AREA:
                continue

            (x, y, w, h) = cv2.boundingRect(contour)
            centroid = (x + w // 2, y + h // 2)
            in_roi = (ROI_X < centroid[0] < ROI_X + ROI_W and ROI_Y < centroid[1] < ROI_Y + ROI_H)
            aspect_ratio = h / w if w > 0 else 0
            posture = "STANDING" if aspect_ratio > STANDING_ASPECT_RATIO_THRESHOLD else "SITTING/LYING"

            matched_id, min_dist = None, float('inf')
            for obj_id, data in self.tracked_objects.items():
                dist = np.linalg.norm(np.array(data['last_position']) - np.array(centroid))
                if dist < min_dist and dist < 50:
                    min_dist = dist
                    matched_id = obj_id

            if matched_id is None:
                matched_id = self.next_object_id
                self.next_object_id += 1
                self.tracked_objects[matched_id] = {
                    'last_position': centroid,
                    'loitering_timer': 0.0,
                    'is_loitering': False,
                    'posture': posture,
                    'posture_timer': 0.0,
                    'last_time': time.time(),
                }

            obj = self.tracked_objects[matched_id]
            current_active_ids.add(matched_id)

            if in_roi:
                current_time = time.time()
                delta = current_time - obj['last_time']
                movement = np.linalg.norm(np.array(obj['last_position']) - np.array(centroid))

                if movement < 45:
                    obj['loitering_timer'] += delta
                else:
                    obj['loitering_timer'] = 0.0

                if posture == obj['posture']:
                    obj['posture_timer'] += delta
                else:
                    obj['posture'] = posture
                    obj['posture_timer'] = delta

                obj['last_time'] = current_time
                obj['is_loitering'] = obj['loitering_timer'] >= LOITERING_TIME_THRESHOLD

                self.loitering_report[matched_id] = max(
                    self.loitering_report.get(matched_id, 0.0),
                    obj['loitering_timer']
                )
            else:
                obj['loitering_timer'] = 0.0
                obj['posture_timer'] = 0.0
                obj['is_loitering'] = False

            obj['last_position'] = centroid

        self.tracked_objects = {k: v for k, v in self.tracked_objects.items() if k in current_active_ids or v['is_loitering']}

    def analyze(self):
        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break
            self.process_frame(frame)

        self.cap.release()

        loitering_detected = any(time >= LOITERING_TIME_THRESHOLD for time in self.loitering_report.values())
        result = {
            "resolution": f"{self.frame_width}x{self.frame_height}",
            "threshold_sec": LOITERING_TIME_THRESHOLD,
            "roi": [ROI_X, ROI_Y, ROI_W, ROI_H],
            "loitering_detected": loitering_detected,
            "report": [
                {"object_id": oid, "max_loiter_time": t, "status": "ALERT" if t >= LOITERING_TIME_THRESHOLD else "Normal"}
                for oid, t in self.loitering_report.items()
            ],
            "assessment": (
                "Suspicious activity detected (loitering)" if loitering_detected
                else "No loitering detected"
            )
        }
        return result


# --- Flask REST API ---
app = Flask(__name__)

@app.route('/analyze', methods=['POST'])
def analyze_video():
    if 'video' not in request.files:
        return jsonify({"error": "No video file provided"}), 400
    
    video = request.files['video']
    filename = f"{uuid.uuid4().hex}_{video.filename}"
    path = os.path.join(VIDEO_UPLOAD_DIR, filename)
    video.save(path)

    try:
        detector = LoiteringDetector(path)
        result = detector.analyze()
        os.remove(path)  # cleanup
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/', methods=['GET'])
def home():
    return jsonify({"message": "Loitering Detection API is running."})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
