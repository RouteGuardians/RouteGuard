import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from 'leaflet';

// --- Helper Components & Functions ---

// Fix for default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

function ClickHandler({ setPoint, label, onPointSelected }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      setPoint(`${lng.toFixed(6)},${lat.toFixed(6)}`);
      onPointSelected();
    }
  });
  return null;
}

// Simple Modal Component
function RerouteModal({ onReroute, onCancel }) {
  const modalStyle = {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    zIndex: 2000, background: 'white', padding: '20px', borderRadius: '8px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.2)', textAlign: 'center'
  };
  const buttonStyle = { margin: '0 10px', padding: '10px 20px', border: 'none', borderRadius: '5px', cursor: 'pointer' };

  return (
    <div style={modalStyle}>
      <h4>Unsafe Route Detected</h4>
      <p>The suggested path passes through a restricted zone.</p>
      <div>
        <button onClick={onReroute} style={{...buttonStyle, background: '#28a745', color: 'white'}}>Find Safe Route</button>
        <button onClick={onCancel} style={{...buttonStyle, background: '#dc3545', color: 'white'}}>Cancel</button>
      </div>
    </div>
  );
}

// Main Map Component
function MapComponent() {
  const [redZones, setRedZones] = useState([]);
  const [safeRoute, setSafeRoute] = useState(null);
  const [unsafeRoute, setUnsafeRoute] = useState(null);
  const [start, setStart] = useState("77.2090,28.6139");
  const [end, setEnd] = useState("80.9462,26.8467");
  const [selecting, setSelecting] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("http://localhost:5000/api/redzones")
      .then(res => res.json())
      .then(data => setRedZones(data));
  }, []);
  
  const formatCoords = (routeData) => {
    return routeData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
  }

  const getRoute = async () => {
    setSafeRoute(null);
    setUnsafeRoute(null);
    setIsLoading(true);

    const res = await fetch(`http://localhost:5000/api/route?start=${start}&end=${end}`);
    const data = await res.json();
    
    setIsLoading(false);

    if (data.status === "safe") {
      setSafeRoute(formatCoords(data.route));
    } else if (data.status === "unsafe") {
      setUnsafeRoute(formatCoords(data.route));
      setShowModal(true);
    } else {
      alert(data.message || "An error occurred.");
    }
  };

  const handleReroute = async () => {
    setShowModal(false);
    setIsLoading(true);

    const res = await fetch(`http://localhost:5000/api/reroute?start=${start}&end=${end}`);
    const data = await res.json();
    
    setIsLoading(false);

    if (data.status === "safe") {
      setUnsafeRoute(null); // Clear the old unsafe route
      setSafeRoute(formatCoords(data.route));
    } else if (data.status === "no_safe_alternatives_found") {
      alert("Could not find a safe alternative route. Please try different start or end points.");
    } else {
      alert(data.message || "An error occurred while rerouting.");
    }
  };

  const startCoords = start.split(",").map(Number);
  const endCoords = end.split(",").map(Number);
  const polylineForBounds = safeRoute || unsafeRoute;
  const bounds = polylineForBounds ? L.latLngBounds(polylineForBounds) : null;

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
        {isLoading && <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 1999, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><h2>Loading...</h2></div>}
        {showModal && <RerouteModal onReroute={handleReroute} onCancel={() => setShowModal(false)} />}
        
      <MapContainer center={[27.5, 79]} zoom={6} style={{ height: "100%", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {redZones.map((zone, idx) => (
          <Circle key={idx} center={zone.coordinates} radius={zone.radius} color="red" fillColor="#f03" fillOpacity={0.4} />
        ))}
        
        {/* Draw unsafe route in red, safe route in blue */}
        {unsafeRoute && <Polyline positions={unsafeRoute} color="red" weight={5} opacity={0.8} />}
        {safeRoute && <Polyline positions={safeRoute} color="blue" weight={5} />}

        <Marker position={[startCoords[1], startCoords[0]]} />
        <Marker position={[endCoords[1], endCoords[0]]} />

        {selecting && <ClickHandler 
            setPoint={selecting === 'start' ? setStart : setEnd} 
            label={selecting === 'start' ? 'Start' : 'End'}
            onPointSelected={() => setSelecting(null)}
        />}

        {bounds && <FitBounds bounds={bounds} />}
      </MapContainer>

      <div style={{ position: "absolute", top: 10, left: 50, zIndex: 1000, background: "white", padding: "10px", borderRadius: "5px", border: "1px solid #ccc" }}>
          <button onClick={getRoute} style={{ width: "100%", padding: "8px 10px", cursor: "pointer", background: '#007bff', color: 'white', border: 'none' }}>
            {isLoading ? "Calculating..." : "Get Route"}
          </button>
          <div style={{marginTop: '10px'}}>
            <button onClick={() => setSelecting("start")} style={{ marginRight: '5px' }}>Set Start</button>
            <button onClick={() => setSelecting("end")}>Set End</button>
          </div>
      </div>
    </div>
  );
}

export default MapComponent;