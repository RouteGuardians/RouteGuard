import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());

// Hardcoded Red Zones (lat, lng, radius in meters)
// The frontend will use this data to validate start/end points.
const redZones = [
  { name: "Zone A (Delhi)", coordinates: [28.6139, 77.2090], radius: 5000 }, // 5km radius
  { name: "Zone B (Lucknow)", coordinates: [26.8467, 80.9462], radius: 4000 }  // 4km radius
];

// API: Get all red zones
app.get("/api/redzones", (req, res) => {
  res.json(redZones);
});

// API: Request a route from OSRM
// NOTE: This backend does NOT perform any "safe route" calculation.
// It simply fetches the standard shortest route from the OSRM public server.
// The "safety" check is handled entirely on the frontend by preventing a request
// if the start or end points are inside a defined red zone.
app.get("/api/route", async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: "Start and End parameters are required." });
  }

  // OSRM API URL for the 'driving' profile
  const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(osrmUrl);
    const data = await response.json();

    // If OSRM returns an error or no route, pass that along
    if (data.code !== "Ok") {
        return res.status(400).json({ error: data.message || "No route found." });
    }

    res.json(data); // Return the full route data from OSRM
  } catch (err) {
    console.error("OSRM request failed:", err);
    res.status(500).json({ error: "Failed to fetch route from the routing service." });
  }
});


app.listen(5000, () => console.log("🚀 Express server running at http://localhost:5000"));