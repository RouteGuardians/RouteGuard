import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb"; // Import MongoDB client

const app = express();
app.use(cors());

// --- MongoDB Setup ---
const MONGO_URI = "mongodb+srv://namansrivastava1608_db_user:E2ulW2JnArL1aI7Q@loitering.rahlbgp.mongodb.net/?appName=loitering";
const client = new MongoClient(MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let alertsCollection; // Variable to hold the collection reference

// --- Connect to MongoDB and start the server ---
async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    // Access the database and collection
    const db = client.db("loitering_db");
    alertsCollection = db.collection("alerts");
    console.log("✅ Successfully connected to MongoDB Atlas!");

    // Start the Express server only after the DB connection is successful
    app.listen(5000, () => console.log("🚀 Backend running on http://localhost:5000"));

  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1); // Exit if DB connection fails
  }
}

run().catch(console.dir);


// 🚫 Define restricted areas (red zones)
const redZones = [
 { lat: 28.6139, lon: 77.2090, radius: 700 }, // Delhi
 { lat: 26.8467, lon: 80.9462, radius: 500 }, // Lucknow
];

const R = 6378137; // Earth's radius (m)
const toRad = deg => deg * Math.PI / 180;

// ---------------- Distance + Red Zone Checks ----------------

function distance(lat1, lon1, lat2, lon2) {
 const φ1 = toRad(lat1), φ2 = toRad(lat2);
 const Δλ = toRad(lon2 - lon1);
 return Math.acos(Math.sin(φ1) * Math.sin(φ2) +
   Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ)) * R;
}

function inRedZone(lat, lon) {
 return redZones.some(zone => distance(lat, lon, zone.lat, zone.lon) < zone.radius);
}

function routeUnsafe(route) {
 return route.geometry.coordinates.some(([lon, lat]) => inRedZone(lat, lon));
}

// ---------------- Helper: Snap Point to Nearest Road ----------------

async function snapToRoad(lon, lat) {
 try {
   const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${lon},${lat}`);
   const data = await res.json();
   if (data.code === "Ok" && data.waypoints?.length > 0) {
     return data.waypoints[0].location; // [lon, lat]
   }
   console.warn("Snap failed, using original point");
   return [lon, lat];
 } catch (err) {
   console.error("Snap to road error:", err);
   return [lon, lat];
 }
}

// ---------------- Routes ----------------

app.get("/", (req, res) => {
 res.send("✅ Backend is running");
});

// ⭐️ --- NEW ROUTE TO GET LOITERING ALERTS --- ⭐️
app.get("/alerts", async (req, res) => {
  if (!alertsCollection) {
    return res.status(503).json({ error: "Database not connected" });
  }
  try {
    // Find all documents and sort by timestamp in descending order (newest first)
    const alerts = await alertsCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(alerts);
  } catch (err) {
    console.error("Failed to fetch alerts:", err);
    res.status(500).json({ error: "Failed to fetch alerts from database." });
  }
});


// Check if a given point lies inside a red zone
app.get("/check", (req, res) => {
 const { lat, lon } = req.query;
 if (!lat || !lon)
   return res.status(400).json({ error: "Missing lat/lon" });

 res.json({ inRedZone: inRedZone(parseFloat(lat), parseFloat(lon)) });
});

// Core: Get route between coordinates, detect safety
app.get("/route", async (req, res) => {
 const { coords, avoidRedZones } = req.query;
 if (!coords) return res.status(400).json({ error: "Coordinates are missing" });

 try {
   const rawPoints = coords.split(";").map(p => p.split(",").map(Number));

   // Snap each to nearest road
   const snappedPoints = await Promise.all(
     rawPoints.map(([lon, lat]) => snapToRoad(lon, lat))
   );

   const snappedCoordString = snappedPoints.map(([lon, lat]) => `${lon},${lat}`).join(";");

   let url = `https://router.project-osrm.org/route/v1/driving/${snappedCoordString}?overview=full&geometries=geojson`;

   if (avoidRedZones === "true") {
     console.warn("Avoid red zones requested — simulated only, not enforced by public OSRM");
   }

   const response = await fetch(url);
   const data = await response.json();

   if (!data.routes || data.routes.length === 0)
     return res.status(404).json({ error: "No route found" });

   const route = data.routes[0];
   const unsafe = routeUnsafe(route);

   res.json({
     route: data,
     unsafe,
     message: unsafe
       ? "⚠️ This route passes through a red zone."
       : "✅ Safe route.",
   });

 } catch (err) {
   console.error("Route fetch error:", err);
   res.status(500).json({ error: "Failed to process route." });
 }
});

// The app.listen() call is now inside the run() function
