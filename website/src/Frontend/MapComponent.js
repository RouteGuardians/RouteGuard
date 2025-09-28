import React, { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Polygon,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

function ClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick(`${e.latlng.lat.toFixed(6)},${e.latlng.lng.toFixed(6)}`);
    },
  });
  return null;
}

function MapComponent() {
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [route, setRoute] = useState(null);
  const [unsafeRoute, setUnsafeRoute] = useState(false);
  const [selecting, setSelecting] = useState(null);
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [vehiclePos, setVehiclePos] = useState(null);
  const [logs, setLogs] = useState([]);
  const logCooldown = useRef(false);
  const redZoneTimer = useRef(null);

  const redZones = [
    { lat: 28.6139, lon: 77.209, radius: 7000 },
    { lat: 26.8467, lon: 80.9462, radius: 5000 },
  ];

  const getRedZonePolygons = () =>
    redZones.map((zone, idx) => {
      const coords = [];
      const segments = 32;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const dx =
          (zone.radius * Math.cos(angle)) /
          (111320 * Math.cos((zone.lat * Math.PI) / 180));
        const dy = (zone.radius * Math.sin(angle)) / 111000;
        coords.push([zone.lat + dy, zone.lon + dx]);
      }
      coords.push(coords[0]);
      return (
        <Polygon
          key={idx}
          positions={coords}
          color="red"
          fillColor="#f03"
          fillOpacity={0.4}
        />
      );
    });

  const formatRoute = (osrmData) =>
    osrmData.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);

  const fetchRoute = async (currentWaypoints) => {
    if (!start || !end) return alert("Please select start and end first.");
    setIsLoading(true);
    setRoute(null);

    try {
      const wpParam = currentWaypoints.length
        ? currentWaypoints
            .map((wp) => wp.split(",").reverse().join(","))
            .join(";")
        : "";
      const startParam = start.split(",").reverse().join(",");
      const endParam = end.split(",").reverse().join(",");

      let allCoords = [startParam];
      if (wpParam) allCoords.push(wpParam);
      allCoords.push(endParam);
      const coordStr = allCoords.join(";");

      const res = await fetch(`http://localhost:5000/route?coords=${coordStr}`);
      const data = await res.json();

      // ✅ FIX: Only error if routes missing
      if (!data.route || !data.route.routes || !data.route.routes.length) {
        alert("No route found.");
      } else {
        setRoute(formatRoute(data.route));
        setUnsafeRoute(data.unsafe);
        if (data.unsafe && currentWaypoints.length === 0) {
          const takeUnsafe = window.confirm(
            "The fastest route is unsafe. OK = accept, Cancel = add waypoint."
          );
          if (!takeUnsafe) setAddingWaypoint(true);
        }
      }
    } catch {
      alert("Failed to fetch route");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetRouteClick = () => {
    setWaypoints([]);
    fetchRoute([]);
  };

  const addWaypoint = (point) => {
    const newWps = [...waypoints, point];
    setWaypoints(newWps);
    setAddingWaypoint(false);
    fetchRoute(newWps);
  };

  // 🚗 Vehicle animation
  useEffect(() => {
    if (!route) return;
    let i = 0;
    const interval = setInterval(() => {
      if (i < route.length) {
        setVehiclePos(route[i]);
        i++;
      } else clearInterval(interval);
    }, 300); // faster animation
    return () => clearInterval(interval);
  }, [route]);

  // ⏱️ Red zone logging
  useEffect(() => {
    if (!vehiclePos) return;

    const inside = redZones.some((zone) => {
      const dist =
        111000 *
        Math.sqrt(
          Math.pow(vehiclePos[0] - zone.lat, 2) +
            Math.pow(
              (vehiclePos[1] - zone.lon) *
                Math.cos((zone.lat * Math.PI) / 180),
              2
            )
        );
      return dist < zone.radius;
    });

    if (inside && !logCooldown.current) {
      setLogs((l) => [...l, `⏰ ENTER red zone at ${new Date().toLocaleTimeString()}`]);
      logCooldown.current = true;

      // Start police timer
      if (!redZoneTimer.current) {
        redZoneTimer.current = setTimeout(() => {
          alert("⚠ Vehicle still inside red zone. Informing police...");
        }, 10000); // 10 sec inside zone
      }

      setTimeout(() => {
        logCooldown.current = false;
      }, 2000);
    }

    if (!inside && redZoneTimer.current) {
      clearTimeout(redZoneTimer.current);
      redZoneTimer.current = null;
      setLogs((l) => [...l, `✅ EXIT red zone at ${new Date().toLocaleTimeString()}`]);
    }
  }, [vehiclePos]);

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            zIndex: 1999,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <h2>Calculating...</h2>
        </div>
      )}

      <MapContainer center={[27.5, 79]} zoom={6} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {getRedZonePolygons()}
        {route && <Polyline positions={route} color={unsafeRoute ? "red" : "blue"} weight={5} />}
        {start && <Marker position={start.split(",").map(Number)} />}
        {end && <Marker position={end.split(",").map(Number)} />}
        {waypoints.map((wp, idx) => (
          <Marker key={idx} position={wp.split(",").map(Number)} />
        ))}
        {vehiclePos && <Marker position={vehiclePos} />}

        {selecting && (
          <ClickHandler
            onClick={(point) => {
              if (selecting === "start") setStart(point);
              if (selecting === "end") setEnd(point);
              setSelecting(null);
            }}
          />
        )}

        {addingWaypoint && <ClickHandler onClick={addWaypoint} />}
      </MapContainer>

      <div
        style={{
          position: "absolute",
          top: 10,
          left: 50,
          zIndex: 1000,
          background: "white",
          padding: 10,
          borderRadius: 5,
        }}
      >
        <button
          onClick={handleGetRouteClick}
          style={{
            width: "100%",
            padding: 8,
            background: "#007bff",
            color: "white",
            border: "none",
          }}
        >
          {isLoading ? "Calculating..." : "Get Route"}
        </button>
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setSelecting("start")} style={{ marginRight: 5 }}>
            Set Start
          </button>
          <button onClick={() => setSelecting("end")}>Set End</button>
        </div>
        <div style={{ marginTop: 10, fontSize: "12px", maxHeight: 150, overflow: "auto" }}>
          <b>Logs:</b>
          <ul>
            {logs.map((log, idx) => (
              <li key={idx}>{log}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default MapComponent;
