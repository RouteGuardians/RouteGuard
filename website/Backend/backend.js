import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const redZones = [
  { lat: 28.6139, lon: 77.2090, radius: 7000 },
  { lat: 26.8467, lon: 80.9462, radius: 5000 },
];

const R = 6378137;
const toRad = deg => deg * Math.PI / 180;

function distance(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  return Math.acos(Math.sin(φ1)*Math.sin(φ2) + Math.cos(φ1)*Math.cos(φ2)*Math.cos(Δλ)) * R;
}

function inRedZone(lat, lon) {
  return redZones.some(zone => distance(lat, lon, zone.lat, zone.lon) < zone.radius);
}

function routeUnsafe(route) {
  return route.geometry.coordinates.some(([lon, lat]) => inRedZone(lat, lon));
}
app.get("/",(req,res)=>{
  res.send("Backend is running")
});
// Check if point is inside red zone
app.get("/check", (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: "Missing lat/lon" });
  res.json({ inRedZone: inRedZone(parseFloat(lat), parseFloat(lon)) });
});

// Dummy loitering detection API
app.get("/loitering", (req, res) => {
  const randomCount = Math.floor(Math.random() * 50); // simulate people count
  res.json({ count: randomCount });
});
app.get("/route", async (req, res) => {
  // **FIX**: The frontend now sends all coordinates in a single 'coords' parameter
  const { coords } = req.query; 

  if (!coords) {
    return res.status(400).json({ error: "Coordinates are missing" });
  }

  // OSRM expects coordinates in lon,lat format
  // The frontend now sends them correctly, so no need to reverse here.
  const url = `http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!data.routes || data.routes.length === 0) {
      return res.status(400).json({ error: "No route found" });
    }

    const unsafe = routeUnsafe(data.routes[0]);
    res.json({ route: data, unsafe });
  } catch (err) {
    console.error("Failed to fetch from OSRM:", err);
    res.status(500).json({ error: "Failed to fetch route from OSRM server." });
  }
});

app.listen(5000, () => console.log("🚀 Backend running on http://localhost:5000"));