import cv2
import numpy as np
import time
import sys
import math
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi

# --- CONFIGURATION CONSTANTS ---
VIDEO_SOURCE = 'Loitering_Detection\\vid2.webm'  # Change to your video path
LOITERING_TIME_THRESHOLD = 2
MIN_CONTOUR_AREA = 1000
STANDING_ASPECT_RATIO_THRESHOLD = 1.2

# --- MongoDB Setup ---
MONGO_URI = "mongodb+srv://namansrivastava1608_db_user:E2ulW2JnArL1aI7Q@loitering.rahlbgp.mongodb.net/?appName=loitering"
client = MongoClient(MONGO_URI, server_api=ServerApi('1'))
db = client["loitering_db"]
collection = db["alerts"]

try:
    client.admin.command('ping')
    print("✅ Successfully connected to MongoDB Atlas!")
except Exception as e:
    print("❌ MongoDB connection failed:", e)

class LoiteringDetector:
    def __init__(self, video_source):
        self.cap = cv2.VideoCapture(video_source)
        if not self.cap.isOpened():
            print(f"Error: Could not open video source {video_source}")
            sys.exit(1)

        self.frame_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.frame_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.ROI_X, self.ROI_Y, self.ROI_W, self.ROI_H = 0, 0, self.frame_width, self.frame_height

        self.fgbg = cv2.createBackgroundSubtractorMOG2(history=1000, varThreshold=12, detectShadows=True)
        self.tracked_objects = {}
        self.next_object_id = 0
        self.loitering_alert_active = False
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

            x, y, w, h = cv2.boundingRect(contour)
            centroid = (x + w // 2, y + h // 2)
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

            in_roi = (self.ROI_X < centroid[0] < self.ROI_X + self.ROI_W and
                      self.ROI_Y < centroid[1] < self.ROI_Y + self.ROI_H)

            aspect_ratio = h / w if w > 0 else 0
            current_posture = "STANDING" if aspect_ratio > STANDING_ASPECT_RATIO_THRESHOLD else "SITTING/LYING"

            # Nearest-object matching
            matched_id = None
            min_dist = float('inf')
            for obj_id, data in self.tracked_objects.items():
                last_pos = data['last_position']
                dist = np.linalg.norm(np.array(last_pos) - np.array(centroid))
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
                    'last_time': time.time(),
                    'posture': current_posture,
                    'posture_timer': 0.0
                }

            current_active_ids.add(matched_id)
            obj_data = self.tracked_objects[matched_id]

            if in_roi:
                now = time.time()
                dt = now - obj_data.get('last_time', now)
                movement = np.linalg.norm(np.array(obj_data['last_position']) - np.array(centroid))
                if movement < 45:
                    obj_data['loitering_timer'] += dt
                else:
                    obj_data['loitering_timer'] = 0.0

                if obj_data['posture'] == current_posture:
                    obj_data['posture_timer'] += dt
                else:
                    obj_data['posture'] = current_posture
                    obj_data['posture_timer'] = dt

                obj_data['last_time'] = now
                obj_data['is_loitering'] = obj_data['loitering_timer'] >= LOITERING_TIME_THRESHOLD
                self.loitering_alert_active = any(d['is_loitering'] for d in self.tracked_objects.values())
                self.loitering_report[matched_id] = max(self.loitering_report.get(matched_id, 0.0),
                                                        obj_data['loitering_timer'])

                status = "LOITERING" if obj_data['is_loitering'] else f"{obj_data['posture']}: {obj_data['posture_timer']:.1f}s"
                color = (0, 0, 255) if obj_data['is_loitering'] else (255, 255, 0) if obj_data['posture'] == "STANDING" else (0, 255, 255)
                cv2.putText(frame, status, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
            else:
                obj_data['loitering_timer'] = 0.0
                obj_data['is_loitering'] = False
                obj_data['posture_timer'] = 0.0

            obj_data['last_position'] = centroid

        self.tracked_objects = {k: v for k, v in self.tracked_objects.items() if k in current_active_ids or v['is_loitering']}
        cv2.rectangle(frame, (self.ROI_X, self.ROI_Y), (self.ROI_X + self.ROI_W, self.ROI_Y + self.ROI_H), (255, 0, 0), 2)
        cv2.putText(frame, "Loitering ROI", (self.ROI_X, self.ROI_Y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
        if self.loitering_alert_active:
            cv2.putText(frame, "!!! LOITERING DETECTED !!!", (10, 50), cv2.FONT_HERSHEY_DUPLEX, 1, (0, 0, 255), 3)
        else:
            cv2.putText(frame, "Status: OK", (10, 50), cv2.FONT_HERSHEY_DUPLEX, 1, (0, 255, 0), 2)

        return frame

    def run(self):
        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break
            processed_frame = self.process_frame(frame)
            cv2.imshow('Loitering Detector', processed_frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        self.cap.release()
        cv2.destroyAllWindows()

        # --- Prepare MongoDB Data ---
        import math
        report_for_mongo = {str(k): math.ceil(v) for k, v in self.loitering_report.items()}
        total_person = sum(1 for t in report_for_mongo.values() if t >= LOITERING_TIME_THRESHOLD)
        standing_count = sum(1 for d in self.tracked_objects.values() if d['posture'] == "STANDING")
        alert_doc = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "loitering_detected": total_person > 0,
            "total_person": total_person,
            "standing_count": standing_count,
        }

        # Push to MongoDB
        try:
            collection.insert_one(alert_doc)
            print("✅ Alert pushed to MongoDB:", alert_doc)
        except Exception as e:
            print("❌ Failed to push alert to MongoDB:", e)


if __name__ == '__main__':
    video_path = sys.argv[1] if len(sys.argv) > 1 else VIDEO_SOURCE
    detector = LoiteringDetector(video_path)
    detector.run()
