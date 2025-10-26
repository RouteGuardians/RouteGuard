import React, { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Polygon,
  Popup,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ----------------- Custom Icons -----------------
const vehicleIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const destIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/854/854878.png",
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

const loiteringIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/3686/3686930.png",
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// ----------------- Click Handler -----------------
function ClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick(`${e.latlng.lat.toFixed(6)},${e.latlng.lng.toFixed(6)}`);
    },
  });
  return null;
}

// ----------------- Main Map Component -----------------
function MapComponent() {
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [route, setRoute] = useState(null);
  const [unsafeRoute, setUnsafeRoute] = useState(false);
  const [selecting, setSelecting] = useState(null);
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showUnsafePrompt, setShowUnsafePrompt] = useState(false);
  const [pendingRoute, setPendingRoute] = useState(null);
  const [vehiclePos, setVehiclePos] = useState(null);
  const [logs, setLogs] = useState([]);
  const [navRunning, setNavRunning] = useState(true);
  const logCooldown = useRef(false);
  const redZoneTimer = useRef(null);

  // Loitering detection states
  const [loiteringData, setLoiteringData] = useState(null);
  const [showLoiteringOverlay, setShowLoiteringOverlay] = useState(false);
  const [analyzingVideo, setAnalyzingVideo] = useState(false);

  const redZones = [
    { lat: 28.6139, lon: 77.2090, radius: 700 },
    { lat: 26.8467, lon: 80.9462, radius: 500 },
  ];

  // Function to call loitering detection API
  const analyzeLoitering = async () => {
    setAnalyzingVideo(true);
    try {
      console.log('Calling loitering detection API...');
      
      // Use the test endpoint that analyzes video directly from server
      const apiResponse = await fetch('http://127.0.0.1:8000/analyze-test', {
        method: 'POST',
      });
      
      console.log('API Response status:', apiResponse.status);
      
      if (!apiResponse.ok) {
        const errorData = await apiResponse.json();
        throw new Error(errorData.error || `API returned ${apiResponse.status}`);
      }
      
      const data = await apiResponse.json();
      console.log('Analysis result:', data);
      
      // Map the API response to include coordinates from red zones
      const enrichedReport = data.report.map((obj, idx) => ({
        ...obj,
        lat: redZones[idx % redZones.length].lat,
        lon: redZones[idx % redZones.length].lon
      }));
      
      setLoiteringData({
        ...data,
        report: enrichedReport
      });
      setShowLoiteringOverlay(true);
      
      setLogs((l) => [...l, `📹 Analysis Complete: ${data.report.length} objects, Status: ${data.assessment} at ${new Date().toLocaleTimeString()}`]);
    } catch (error) {
      console.error('Loitering detection error:', error);
      setLogs((l) => [...l, `❌ Error: ${error.message} at ${new Date().toLocaleTimeString()}`]);
      alert(`Loitering detection failed: ${error.message}`);
    } finally {
      setAnalyzingVideo(false);
    }
  };

  // ----------------- Red Zone Polygons -----------------
  const getRedZonePolygons = () =>
    redZones.map((zone, idx) => {
      const coords = [];
      const segments = 32;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const dx = (zone.radius * Math.cos(angle)) / (111320 * Math.cos((zone.lat * Math.PI) / 180));
        const dy = (zone.radius * Math.sin(angle)) / 111000;
        coords.push([zone.lat + dy, zone.lon + dx]);
      }
      coords.push(coords[0]);
      return <Polygon key={idx} positions={coords} color="red" fillColor="#f03" fillOpacity={0.4} />;
    });

  const formatRoute = (osrmData) =>
    osrmData.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);

  // ----------------- Fetch Route -----------------
  const fetchRoute = async (currentWaypoints, avoidRedZones = false) => {
    if (!start || !end) return alert("Please select a start and end point first.");
    setIsLoading(true);
    setRoute(null);
    setUnsafeRoute(false);

    try {
      const wpParam = currentWaypoints.length
        ? currentWaypoints.map((wp) => wp.split(",").reverse().join(",")).join(";")
        : "";
      const startParam = start.split(",").reverse().join(",");
      const endParam = end.split(",").reverse().join(",");
      const allCoords = [startParam];
      if (wpParam) allCoords.push(wpParam);
      allCoords.push(endParam);
      const coordStr = allCoords.join(";");

      const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const apiUrl = isLocal ? "http://localhost:5000" : "https://routeguard.onrender.com";

      let url = `${apiUrl}/route?coords=${coordStr}`;
      if (avoidRedZones) url += "&avoidRedZones=true";

      const res = await fetch(url);
      const data = await res.json();

      if (res.status !== 200 || !data.route || !data.route.routes.length) {
        alert(data.error || "No route found.");
      } else {
        setRoute(formatRoute(data.route));
        setUnsafeRoute(data.unsafe);

        if (data.unsafe && !avoidRedZones) {
          setPendingRoute(data);
          setShowUnsafePrompt(true);
        }
      }
    } catch (err) {
      alert("Failed to fetch route from the server.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // ----------------- Unsafe Route Handlers -----------------
  const handleAcceptUnsafe = async () => {
    setShowUnsafePrompt(false);
    
    if (pendingRoute) {
      setRoute(formatRoute(pendingRoute.route));
      setUnsafeRoute(true);
      setPendingRoute(null);
      
      // Run loitering detection immediately
      setAnalyzingVideo(true);
      try {
        console.log('Running loitering detection...');
        
        const apiResponse = await fetch('http://127.0.0.1:8000/analyze-test', {
          method: 'POST',
        });
        
        if (!apiResponse.ok) {
          throw new Error(`API error: ${apiResponse.status}`);
        }
        
        const data = await apiResponse.json();
        console.log('Loitering detection result:', data);
        
        // Add coordinates to detections
        const enrichedReport = data.report.map((obj, idx) => ({
          ...obj,
          lat: redZones[idx % redZones.length].lat,
          lon: redZones[idx % redZones.length].lon
        }));
        
        setLoiteringData({
          ...data,
          report: enrichedReport
        });
        setShowLoiteringOverlay(true);
        
        setLogs((l) => [...l, `📹 ${data.assessment} - ${data.report.length} objects at ${new Date().toLocaleTimeString()}`]);
      } catch (error) {
        console.error('Loitering detection failed:', error);
        setLogs((l) => [...l, `❌ Detection Error: ${error.message}`]);
      } finally {
        setAnalyzingVideo(false);
      }
    }
  };

  const handleFindSafeRoute = () => {
    setShowUnsafePrompt(false);
    setPendingRoute(null);
    fetchRoute(waypoints, true);
  };

  const handleAddWaypointChoice = () => {
    setShowUnsafePrompt(false);
    setPendingRoute(null);
    setAddingWaypoint(true);
  };

  const handleGetRouteClick = () => {
    setWaypoints([]);
    fetchRoute([], false);
  };

  const addWaypointAndRecalculate = (point) => {
    const newWps = [...waypoints, point];
    setWaypoints(newWps);
    setAddingWaypoint(false);
    fetchRoute(newWps, false);
  };

  // ----------------- Vehicle Animation -----------------
  useEffect(() => {
    if (!route || !navRunning) return;
    let i = 0;
    const interval = setInterval(() => {
      if (navRunning && i < route.length) setVehiclePos(route[i++]);
      else clearInterval(interval);
    }, 300);
    return () => clearInterval(interval);
  }, [route, navRunning]);

  // ----------------- Red Zone Detection -----------------
  useEffect(() => {
    if (!vehiclePos) return;
    const inside = redZones.some((zone) => {
      const dist = 111000 * Math.sqrt(Math.pow(vehiclePos[0] - zone.lat, 2) + Math.pow((vehiclePos[1] - zone.lon) * Math.cos((zone.lat * Math.PI) / 180), 2));
      return dist < zone.radius;
    });
    if (inside && !logCooldown.current) {
      setLogs((l) => [...l, `⏰ ENTER red zone at ${new Date().toLocaleTimeString()}`]);
      logCooldown.current = true;
      if (!redZoneTimer.current) {
        redZoneTimer.current = setTimeout(() => alert("⚠ Vehicle in red zone for 10s. Informing authorities..."), 10000);
      }
      setTimeout(() => { logCooldown.current = false; }, 2000);
    }
    if (!inside && redZoneTimer.current) {
      clearTimeout(redZoneTimer.current);
      redZoneTimer.current = null;
      setLogs((l) => [...l, `✅ EXIT red zone at ${new Date().toLocaleTimeString()}`]);
    }
  }, [vehiclePos]);

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {(isLoading || showUnsafePrompt || analyzingVideo) && (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.7)", zIndex: 1999, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isLoading && !showUnsafePrompt && !analyzingVideo && <h2>Calculating Route...</h2>}
          {analyzingVideo && <h2>🎥 Analyzing Surveillance Footage...</h2>}
          {showUnsafePrompt && !analyzingVideo && (
            <div style={{ background: "#333", padding: "20px 40px", borderRadius: "8px", textAlign: "center", border: "1px solid #555" }}>
              <h3>⚠️ Unsafe Route Detected</h3>
              <p>The fastest route passes through a designated red zone.</p>
              <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <button onClick={handleAcceptUnsafe} style={{ padding: "12px", background: "#c82333", color: "white", border: "none", cursor: "pointer", fontSize: "16px" }}>Accept Unsafe Route</button>
                <button onClick={handleFindSafeRoute} style={{ padding: "12px", background: "#218838", color: "white", border: "none", cursor: "pointer", fontSize: "16px" }}>Find a Safer Route</button>
                <button onClick={handleAddWaypointChoice} style={{ padding: "12px", background: "#0069d9", color: "white", border: "none", cursor: "pointer", fontSize: "16px" }}>Add Waypoint to Avoid</button>
              </div>
            </div>
          )}
        </div>
      )}

      <MapContainer center={[27.5, 79]} zoom={6} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {getRedZonePolygons()}
        {route && <Polyline positions={route} color={unsafeRoute ? "orange" : "blue"} weight={5} />}
        {start && <Marker position={start.split(",").map(Number)} />}
        {end && <Marker position={end.split(",").map(Number)} icon={destIcon} />}
        {waypoints.map((wp, idx) => (<Marker key={idx} position={wp.split(",").map(Number)} />))}
        {vehiclePos && <Marker position={vehiclePos} icon={vehicleIcon} />}
        
        {/* Loitering Detection Markers */}
        {showLoiteringOverlay && loiteringData && loiteringData.report.map((obj) => (
          <Marker 
            key={`loiter-${obj.object_id}`} 
            position={[obj.lat, obj.lon]}
            icon={loiteringIcon}
          >
            <Popup>
              <div>
                <strong>⚠️ Loitering Alert</strong><br/>
                Object ID: {obj.object_id}<br/>
                Time: {obj.max_loiter_time.toFixed(1)}s<br/>
                Status: {obj.status}
              </div>
            </Popup>
          </Marker>
        ))}

        {selecting && <ClickHandler onClick={(point) => { if (selecting === "start") setStart(point); if (selecting === "end") setEnd(point); setSelecting(null); }} />}
        {addingWaypoint && <ClickHandler onClick={addWaypointAndRecalculate} />}
      </MapContainer>

      <div style={{ position: "absolute", top: 10, left: 50, zIndex: 1000, background: "white", padding: 10, borderRadius: 5, boxShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>
        <div style={{ marginBottom: "10px" }}>
          <p><strong>Start:</strong> {start || "Not set"}</p>
          <p><strong>End:</strong> {end || "Not set"}</p>
        </div>
        <button onClick={() => setSelecting("start")} style={{ marginRight: 5 }}>Set Start</button>
        <button onClick={() => setSelecting("end")}>Set End</button>
        <button onClick={handleGetRouteClick} style={{ width: "100%", padding: 8, marginTop: 10, background: "#007bff", color: "white", border: "none" }} disabled={isLoading || !start || !end}>
          {isLoading ? "Calculating..." : "Get Route"}
        </button>
        <button onClick={() => setNavRunning(!navRunning)} style={{ width: "100%", padding: 8, marginTop: 5, background: navRunning ? "#dc3545" : "#28a745", color: "white", border: "none" }}>
          {navRunning ? "Stop Navigation" : "Resume Navigation"}
        </button>

        {/* Loitering Info Panel */}
        {showLoiteringOverlay && loiteringData && (
          <div style={{ marginTop: 10, padding: 10, background: "#ffebee", borderRadius: 5, border: "1px solid #f44336" }}>
            <strong style={{ color: "#d32f2f" }}>⚠️ Loitering Analysis</strong>
            <p style={{ margin: "5px 0", fontSize: "12px" }}>{loiteringData.assessment}</p>
            <div style={{ fontSize: "11px", maxHeight: 100, overflow: "auto" }}>
              <div><strong>Objects:</strong> {loiteringData.report.length}</div>
              {loiteringData.report.map((obj) => (
                <div key={obj.object_id} style={{ marginBottom: 5, color: obj.status === "ALERT" ? "#d32f2f" : "#666" }}>
                  ID {obj.object_id}: {obj.max_loiter_time.toFixed(1)}s - {obj.status}
                </div>
              ))}
            </div>
            <button 
              onClick={() => setShowLoiteringOverlay(false)}
              style={{ width: "100%", padding: 5, marginTop: 5, fontSize: "11px", background: "#666", color: "white", border: "none", cursor: "pointer" }}
            >
              Hide Overlay
            </button>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: "12px", maxHeight: 150, overflow: "auto" }}>
          <b>Logs:</b>
          <ul>{logs.map((log, idx) => (<li key={idx}>{log}</li>))}</ul>
        </div>
      </div>
    </div>
  );
}

export default MapComponent;