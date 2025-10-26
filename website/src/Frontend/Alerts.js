import React, { useState, useEffect } from "react";

function AlertsTable() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        const apiUrl = isLocal ? "http://localhost:5000" : "https://routeguard.onrender.com";

        const response = await fetch(`${apiUrl}/alerts`);
        const data = await response.json();
        setAlerts(data);
      } catch (err) {
        console.error("Failed to fetch alerts:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
  }, []);

  if (loading) return <p>Loading alerts...</p>;

  return (
    <div>
      <h2>Loitering Alerts</h2>
      <table border="1" cellPadding="5" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Loitering Detected</th>
            <th>Total Persons</th>
            <th>Standing Count</th>
            <th>Loitering Report</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert._id}>
              <td>{alert.timestamp}</td>
              <td>{alert.loitering_detected.toString()}</td>
              <td>{alert.total_person}</td>
              <td>{alert.standing_count}</td>
              <td>
                {alert.loitering_report
                  ? Object.values(alert.loitering_report).join(", ")
                  : "N/A"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AlertsTable;
