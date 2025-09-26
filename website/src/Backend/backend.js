import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// --- Data and Helpers ---

const redZones = [
  { name: "Zone A (Delhi)", coordinates: [28.6139, 77.2090], radius: 5000 }, // 5km
  { name: "Zone B (Lucknow)", coordinates: [26.8467, 80.9462], radius: 4000 }, // 4km
];

// Haversine formula to calculate distance between two geo-coordinates
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distance in meters
}

// Checks if any coordinate in a route's path falls within any red zone
function isRouteUnsafe(route) {
  const coordinates = route.geometry.coordinates; // Array of [lng, lat]
  for (const coord of coordinates) {
    const [lng, lat] = coord;
    for (const zone of redZones) {
      const distance = haversineDistance(lat, lng, zone.coordinates[0], zone.coordinates[1]);
      if (distance < zone.radius) {
        return true; // The route is unsafe
      }
    }
  }
  return false; // The route is safe
}

// --- API Endpoints ---

app.get("/api/redzones", (req, res) => {
  res.json(redZones);
});

// Endpoint to get the initial, fastest route
app.get("/api/route", async (req, res) => {
  const { start, end } = req.query;
  const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(osrmUrl);
    const data = await response.json();

    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
      return res.status(400).json({ status: "error", message: "Route not found" });
    }

    const primaryRoute = data.routes[0];
    if (isRouteUnsafe(primaryRoute)) {
      res.json({ status: "unsafe", route: data });
    } else {
      res.json({ status: "safe", route: data });
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: "Failed to fetch route" });
  }
});

// Endpoint to find a safe alternative route
app.get("/api/reroute", async (req, res) => {
    const { start, end } = req.query;
    // Request alternatives from OSRM
    const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson&alternatives=true`;

    try {
        const response = await fetch(osrmUrl);
        const data = await response.json();

        if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
            return res.status(400).json({ status: "error", message: "No routes found" });
        }
        
        // Find the first safe route among the alternatives
        const safeRoute = data.routes.find(route => !isRouteUnsafe(route));

        if (safeRoute) {
            // We need to return it in the same structure as the original /route call
            const safeRouteData = { ...data, routes: [safeRoute] };
            res.json({ status: "safe", route: safeRouteData });
        } else {
            res.json({ status: "no_safe_alternatives_found" });
        }
    } catch (err) {
        res.status(500).json({ status: "error", message: "Failed to fetch reroute" });
    }
});


app.listen(5000, () => console.log("🚀 Express server running at http://localhost:5000"));