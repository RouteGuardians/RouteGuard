import cv2
import numpy as np
import time
import sys # Added sys import for exit calls

# --- CONFIGURATION CONSTANTS ---
# Setting the video source to the file you uploaded for immediate testing.
VIDEO_SOURCE = 'vid1.mp4' 

# Time (in seconds) an object must remain relatively still in the ROI to be flagged as loitering.
# Reset to 5 seconds, as 1 second is usually too sensitive for loitering.
LOITERING_TIME_THRESHOLD = 2

# Region of Interest (ROI) for Loitering Detection (x, y, width, height)
# Adjusted to cover a large portion of the frame to capture the person in 'vid2.webm'.
# NOTE: If your video resolution is very high, you might still need to increase ROI_W/ROI_H.
ROI_X, ROI_Y, ROI_W, ROI_H = 0, 0, 1000, 800 

# Minimum area (in pixels) for a detected contour to be considered a moving object (prevents noise).
MIN_CONTOUR_AREA = 1000

# Posture detection heuristic: H/W ratio threshold. 
# A high ratio (e.g., > 1.2) usually suggests a standing person.
# Adjusted to 1.2 to correctly classify standing individuals.
STANDING_ASPECT_RATIO_THRESHOLD = 1.2 

class LoiteringDetector:
    """
    Detects loitering by tracking objects (motion blobs) within a predefined ROI.
    Loitering is defined as an object staying in the ROI without significant movement for 
    longer than the LOITERING_TIME_THRESHOLD.
    """
    def __init__(self, video_source):
        self.cap = cv2.VideoCapture(video_source)
        if not self.cap.isOpened():
            print(f"Error: Could not open video source {video_source}")
            sys.exit(1)

        # Get video resolution (Feature 1)
        self.frame_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.frame_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # Background Subtractor for detecting motion
        # MODIFIED: Increased history to 1000 and decreased varThreshold to 12.
        # This makes the background model adapt much slower, ensuring static people remain 
        # classified as 'moving objects' (foreground) long enough to trigger the loitering timer.
        self.fgbg = cv2.createBackgroundSubtractorMOG2(history=1000, varThreshold=12, detectShadows=True)
        
        # Dictionary to track objects: {object_id: {... tracking data ...}}
        self.tracked_objects = {}
        self.next_object_id = 0
        self.loitering_alert_active = False # Flag for real-time alert

        # Data structure for final report: {object_id: max_loitering_time}
        self.loitering_report = {} 

    def process_frame(self, frame):
        # 1. Preprocessing and Mask Generation
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Apply background subtraction
        fgmask = self.fgbg.apply(gray)
        
        # Apply binary threshold and morphological operations to clean up the mask
        _, thresh = cv2.threshold(fgmask, 254, 255, cv2.THRESH_BINARY)
        kernel = np.ones((5, 5), np.uint8)
        thresh = cv2.dilate(thresh, kernel, iterations=2)
        
        # 2. Find Contours (Moving Objects)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        current_active_ids = set()
        
        # 3. Process Contours
        for contour in contours:
            if cv2.contourArea(contour) < MIN_CONTOUR_AREA:
                continue

            # Bounding box and Centroid
            (x, y, w, h) = cv2.boundingRect(contour)
            centroid_x = x + w // 2
            centroid_y = y + h // 2
            current_centroid = (centroid_x, centroid_y)
            
            # Draw bounding box (optional, useful for debugging)
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            
            # Check if centroid is within the ROI
            in_roi = (ROI_X < centroid_x < ROI_X + ROI_W and
                      ROI_Y < centroid_y < ROI_Y + ROI_H)
            
            # --- Posture Detection (Feature 2) ---
            # Aspect Ratio H/W
            aspect_ratio = h / w if w > 0 else 0
            current_posture = "STANDING" if aspect_ratio > STANDING_ASPECT_RATIO_THRESHOLD else "SITTING/LYING"
            
            # 4. Loitering Logic and Tracking
            
            # Simple association logic: Find the closest existing tracked object within a small radius
            matched_id = None
            min_dist = float('inf')
            max_dist_threshold = 50  # Max distance to link to an old object
            
            for obj_id, data in self.tracked_objects.items():
                last_pos = data['last_position']
                dist = np.linalg.norm(np.array(last_pos) - np.array(current_centroid))
                if dist < min_dist and dist < max_dist_threshold:
                    min_dist = dist
                    matched_id = obj_id

            if matched_id is None:
                # New object found
                obj_id = self.next_object_id
                self.next_object_id += 1
                matched_id = obj_id
                self.tracked_objects[obj_id] = {
                    'start_time': time.time() if in_roi else 0,
                    'last_position': current_centroid,
                    'loitering_timer': 0.0,
                    'is_loitering': False,
                    'last_time': time.time(), # Initialize last_time for new objects
                    'posture': current_posture,
                    'posture_timer': 0.0 # Timer for current posture
                }
                
            current_active_ids.add(matched_id)
            obj_data = self.tracked_objects[matched_id]
            
            # Update tracking data and loitering timer
            if in_roi:
                current_time = time.time()
                time_diff = current_time - obj_data.get('last_time', current_time)
                
                # If the object hasn't moved much, increment the loitering timer
                movement = np.linalg.norm(np.array(obj_data['last_position']) - np.array(current_centroid))
                
                # Check for significant movement (e.g., more than 10 pixels since last frame)
                if movement < 10:
                    obj_data['loitering_timer'] += time_diff
                else:
                    # Significant movement resets the loitering timer
                    obj_data['loitering_timer'] = 0.0
                
                # Check for posture change and update posture timer
                if obj_data['posture'] == current_posture:
                    obj_data['posture_timer'] += time_diff
                else:
                    obj_data['posture'] = current_posture
                    obj_data['posture_timer'] = time_diff # Start new posture timer

                obj_data['last_time'] = current_time
                
                # Check for loitering trigger
                if obj_data['loitering_timer'] >= LOITERING_TIME_THRESHOLD:
                    obj_data['is_loitering'] = True
                    self.loitering_alert_active = True
                else:
                    obj_data['is_loitering'] = False
                    
                # --- UPDATE FINAL REPORT DATA ---
                # Update the maximum recorded loitering time for this object ID
                current_max = self.loitering_report.get(matched_id, 0.0)
                self.loitering_report[matched_id] = max(current_max, obj_data['loitering_timer'])
                
                # Display timer and status
                status = "LOITERING" if obj_data['is_loitering'] else f"{obj_data['posture']}: {obj_data['posture_timer']:.1f}s"
                color = (0, 0, 255) if obj_data['is_loitering'] else (255, 255, 0) if obj_data['posture'] == "STANDING" else (0, 255, 255)
                
                cv2.putText(frame, status, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
            else:
                # Object is outside the ROI, reset its timer state
                obj_data['loitering_timer'] = 0.0
                obj_data['is_loitering'] = False
                obj_data['posture_timer'] = 0.0 # Reset posture timer outside ROI

            # Update last known position regardless of ROI status
            obj_data['last_position'] = current_centroid
            
        # 5. Drawing and Cleanup
        
        # Remove old, untracked objects
        self.tracked_objects = {
            k: v for k, v in self.tracked_objects.items() if k in current_active_ids or v['is_loitering']
        }
        
        # Draw the ROI rectangle
        cv2.rectangle(frame, (ROI_X, ROI_Y), (ROI_X + ROI_W, ROI_Y + ROI_H), (255, 0, 0), 2)
        cv2.putText(frame, "Loitering ROI", (ROI_X, ROI_Y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)

        # Global Loitering Alert
        if any(data['is_loitering'] for data in self.tracked_objects.values()):
            cv2.putText(frame, "!!! LOITERING DETECTED !!!", (10, 50), cv2.FONT_HERSHEY_DUPLEX, 1, (0, 0, 255), 3)
        else:
             cv2.putText(frame, "Status: OK", (10, 50), cv2.FONT_HERSHEY_DUPLEX, 1, (0, 255, 0), 2)
             
        return frame

    def run(self):
        print(f"--- Starting Loitering Detection ---")
        # Display video resolution (Feature 1)
        print(f"Video Resolution: {self.frame_width}x{self.frame_height}")
        print(f"Processing video: {VIDEO_SOURCE}")
        print(f"ROI: ({ROI_X}, {ROI_Y}) to ({ROI_X + ROI_W}, {ROI_Y + ROI_H})")
        print(f"Threshold: {LOITERING_TIME_THRESHOLD} seconds of stillness")
        
        while self.cap.isOpened():
            ret, frame = self.cap.read()
            if not ret:
                break

            # Process the frame and get the annotated result
            processed_frame = self.process_frame(frame)
            
            # Display the result
            cv2.imshow('Loitering Detector', processed_frame)
            
            # Press 'q' to exit
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        self.cap.release()
        cv2.destroyAllWindows()
        print("--- Detection Completed and Windows Closed ---")

        # --- FINAL SUMMARY OUTPUT (New/Restored Block) ---
        
        # Check if any loitering event exceeded the threshold
        loitering_detected = any(time >= LOITERING_TIME_THRESHOLD for time in self.loitering_report.values())
        
        final_verdict = "Suspicion Found (Loitering Detected)" if loitering_detected else "No Loitering Detected"
        
        print("\n" + "="*70)
        print(f"FINAL ANALYSIS VERDICT: {final_verdict}")
        print("-" * 70)
        print("LOITERING REPORT (Max time still in ROI):")
        
        if not self.loitering_report:
            print("  No objects were tracked or entered the ROI.")
        else:
            for obj_id, max_time in self.loitering_report.items():
                status = "ALERT" if max_time >= LOITERING_TIME_THRESHOLD else "Normal"
                
                print(f"  Object ID {obj_id}: {max_time:.2f} seconds still (Status: {status})")

        print("-" * 70)
        
        if loitering_detected:
             safety_assessment = "Safety Assessment: Suspicious activity (loitering) was detected above the threshold. Review footage for Object IDs flagged as ALERT."
        else:
             safety_assessment = "Safety Assessment: No loitering activity exceeded the set threshold."
             
        print(safety_assessment)
        print("="*70)
        
        # Ensure output is printed before the program exits
        sys.stdout.flush() 


if __name__ == '__main__':
    import sys
    
    # Check for a video path argument, otherwise use the default
    if len(sys.argv) > 1:
        video_path = sys.argv[1]
    else:
        video_path = VIDEO_SOURCE

    # IMPORTANT: Ensure you have a video file named 'test_video.mp4' 
    # or pass a path as a command line argument!
    detector = LoiteringDetector(video_path)
    detector.run()