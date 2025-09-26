import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from 'leaflet';

// Fix for default marker icon issue with webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Helper function to calculate distance between two lat/lng points in meters
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

  return R * c; // in meters
}


// Fit map to route
function FitBounds({ route }) {
  const map = useMap();
  useEffect(() => {
    if (route && route.length > 0) {
        const bounds = L.latLngBounds(route);
        map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [route, map]);
  return null;
}

// Component to capture clicks on the map
function ClickHandler({ setPoint, label, onPointSelected }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      setPoint(`${lng.toFixed(6)},${lat.toFixed(6)}`);
      alert(`${label} set at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      onPointSelected(); // Callback to reset selection mode
    }
  });
  return null;
}

function MapComponent() {
  const [redZones, setRedZones] = useState([]);
  const [route, setRoute] = useState(null);
  const [start, setStart] = useState("77.2090,28.6139"); // Default Delhi
  const [end, setEnd] = useState("80.9462,26.8467");     // Default Lucknow
  const [selecting, setSelecting] = useState(null);       // "start" or "end"

  useEffect(() => {
    fetch("http://localhost:5000/api/redzones")
      .then(res => res.json())
      .then(data => setRedZones(data));
  }, []);

  // Correctly checks if a point is inside any red zone using its specific radius
  const isInsideRedZone = (lat, lng) => {
    return redZones.some(zone => {
      const distance = haversineDistance(lat, lng, zone.coordinates[0], zone.coordinates[1]);
      return distance < zone.radius; // Compare distance in meters to radius in meters
    });
  };

  const getRoute = async () => {
    // Clear previous route
    setRoute(null);

    const [startLng, startLat] = start.split(",").map(Number);
    const [endLng, endLat] = end.split(",").map(Number);

    // Prevent API call if start or end is in a restricted area
    if (isInsideRedZone(startLat, startLng)) {
      alert("Error: Your starting point is inside a restricted red zone. Please select a different location.");
      return; // Stop the function
    }
    if (isInsideRedZone(endLat, endLng)) {
      alert("Error: Your destination is inside a restricted red zone. Please select a different location.");
      return; // Stop the function
    }

    try {
        const res = await fetch(`http://localhost:5000/api/route?start=${start}&end=${end}`);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || "Failed to fetch route");
        }
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
            // OSRM returns [lng, lat], Leaflet needs [lat, lng], so we swap them
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            setRoute(coords);
        } else {
            alert("Could not find a route. Please try different locations.");
        }
    } catch (error) {
        console.error("Routing error:", error);
        alert(`An error occurred: ${error.message}`);
    }
  };
  
  // Parse coordinates safely
  const startCoords = start ? start.split(",").map(Number) : [77.2090, 28.6139];
  const endCoords = end ? end.split(",").map(Number) : [80.9462, 26.8467];

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <MapContainer center={[27.5, 79]} zoom={6} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {redZones.map((zone, idx) => (
          <Circle
            key={idx}
            center={[zone.coordinates[0], zone.coordinates[1]]} // [lat, lng]
            radius={zone.radius} // in meters
            color="red"
            fillColor="#f03"
            fillOpacity={0.5}
          />
        ))}

        {route && <Polyline positions={route} color="blue" weight={5}/>}
        
        {/* Leaflet expects [lat, lng] */}
        <Marker position={[startCoords[1], startCoords[0]]} />
        <Marker position={[endCoords[1], endCoords[0]]} />

        {/* Click handler for map */}
        {selecting && <ClickHandler 
            setPoint={selecting === 'start' ? setStart : setEnd} 
            label={selecting === 'start' ? 'Start' : 'End'}
            onPointSelected={() => setSelecting(null)} // Deactivate selection mode after click
        />}

        {route && <FitBounds route={route} />}
      </MapContainer>

      <div style={{ position: "absolute", top: 10, left: 50, zIndex: 1000, background: "white", padding: "10px", borderRadius: "5px", border: "1px solid #ccc", boxShadow: "0 2px 5px rgba(0,0,0,0.2)" }}>
        <div style={{ marginBottom: '10px' }}>
          <label>Start (lng,lat): </label>
          <input value={start} readOnly style={{ border: '1px solid #ddd', padding: '2px' }}/>
          <button onClick={() => setSelecting("start")} style={{ marginLeft: "5px" }}>Set on Map</button>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label>End (lng,lat): </label>
          <input value={end} readOnly style={{ border: '1px solid #ddd', padding: '2px' }}/>
          <button onClick={() => setSelecting("end")} style={{ marginLeft: "5px" }}>Set on Map</button>
        </div>
        <button onClick={getRoute} style={{ marginTop: "10px", width: "100%", padding: "8px 10px", cursor: "pointer", background: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>Get Safe Route</button>
      </div>
    </div>
  );
}

export default MapComponent;