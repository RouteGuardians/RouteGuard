import React, { useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMapEvents } from "react-leaflet";
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

  const redZones = [
    { lat: 28.6139, lon: 77.2090, radius: 7000 },
    { lat: 26.8467, lon: 80.9462, radius: 5000 },
  ];

  const getRedZonePolygons = () => {
    return redZones.map((zone, idx) => {
      const coords = [];
      const segments = 64;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        // A simplified conversion from meters to degrees
        const dx = (zone.radius * Math.cos(angle)) / (111320 * Math.cos(zone.lat * Math.PI / 180));
        const dy = (zone.radius * Math.sin(angle)) / 111000;
        coords.push([zone.lat + dy, zone.lon + dx]);
      }
      coords.push(coords[0]);
      return <Polygon key={idx} positions={coords} color="red" fillColor="#f03" fillOpacity={0.4} />;
    });
  };

  const formatRoute = (osrmData) => osrmData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

  const fetchRoute = async (currentWaypoints) => {
    if (!start || !end) return alert("Please select a start and end point first.");
    setIsLoading(true);
    setRoute(null); // Clear previous route
    try {
      // Use the provided waypoints for the request
      const wpParam = currentWaypoints.length ? currentWaypoints.map(wp => wp.split(',').reverse().join(',')).join(";") : "";
      const startParam = start.split(',').reverse().join(',');
      const endParam = end.split(',').reverse().join(',');
      
      let allCoords = [startParam];
      if (wpParam) allCoords.push(wpParam);
      allCoords.push(endParam);
      const coordStr = allCoords.join(';');

      const res = await fetch(`http://localhost:5000/route?coords=${coordStr}`);
      const data = await res.json();
      
      if (data.route) {
        setRoute(formatRoute(data.route));
        setUnsafeRoute(data.unsafe);
        
        // Only show the prompt if no waypoints have been added yet
        if (data.unsafe && currentWaypoints.length === 0) {
          // **CHANGE 1: Improved prompt message**
          const takeUnsafe = window.confirm("The fastest route is unsafe. Click 'OK' to accept it, or 'Cancel' to add a manual waypoint to find a safer path.");
          if (!takeUnsafe) {
            setAddingWaypoint(true); // User clicked Cancel, now prompt for manual waypoint
          }
        }
      } else {
        alert("No route found.");
      }
    } catch {
      alert("Failed to fetch route");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleGetRouteClick = () => {
    setWaypoints([]); // Clear old waypoints when starting a new route
    fetchRoute([]);   // Fetch route with no waypoints
  };

  const addWaypoint = (point) => {
    const newWaypoints = [...waypoints, point];
    setWaypoints(newWaypoints);
    setAddingWaypoint(false);
    fetchRoute(newWaypoints); // Recalculate the route with the new waypoint
  };

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {isLoading && <div style={{position:"absolute", top:0, left:0, width:"100%", height:"100%", background:"rgba(0,0,0,0.5)", zIndex:1999, color:"white", display:"flex", alignItems:"center", justifyContent:"center"}}><h2>Calculating...</h2></div>}
      
      {/* **CHANGE 2: New visual instruction banner** */}
      {addingWaypoint && <div style={{position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", zIndex:1001, background:"#ffc107", padding:"10px 20px", borderRadius:5, fontWeight:"bold"}}>
          Click on the map to add a waypoint
        </div>}

      <MapContainer center={[27.5, 79]} zoom={6} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {getRedZonePolygons()}
        {route && <Polyline positions={route} color={unsafeRoute ? "red" : "blue"} weight={5} />}
        {start && <Marker position={start.split(",").map(Number)} />}
        {end && <Marker position={end.split(",").map(Number)} />}
        {waypoints.map((wp, idx) => <Marker key={idx} position={wp.split(",").map(Number)} />)}
        
        {selecting && <ClickHandler onClick={(point) => {
            if (selecting === 'start') setStart(point);
            if (selecting === 'end') setEnd(point);
            setSelecting(null);
        }} />}
        
        {addingWaypoint && <ClickHandler onClick={addWaypoint} />}
      </MapContainer>

      <div style={{position:"absolute", top:10, left:50, zIndex:1000, background:"white", padding:10, borderRadius:5}}>
        <button onClick={handleGetRouteClick} style={{width:"100%", padding:8, background:"#007bff", color:"white", border:"none"}}>
          {isLoading ? "Calculating..." : "Get Route"}
        </button>
        <div style={{marginTop:10}}>
          <button onClick={() => setSelecting("start")} style={{marginRight:5}}>Set Start</button>
          <button onClick={() => setSelecting("end")} style={{marginRight:5}}>Set End</button>
        </div>
      </div>
    </div>
  );
}

export default MapComponent;