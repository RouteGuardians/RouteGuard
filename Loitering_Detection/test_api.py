import requests

url = "http://127.0.0.1:8000/analyze"
files = {'video': open('vid1.mp4', 'rb')}

response = requests.post(url, files=files)
data = response.json()

print(f"\n✅ Assessment: {data['assessment']}")
print(f"🔍 Loitering Detected: {data['loitering_detected']}")
print(f"📹 Resolution: {data['resolution']}")
print(f"🎯 ROI: {data['roi']}")
print(f"⏱️ Threshold: {data['threshold_sec']} seconds")

# optional: count how many objects were checked
print(f"👥 Objects Analyzed: {len(data['report'])}")
