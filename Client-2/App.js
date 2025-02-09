import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

function App() {
  const [data, setData] = useState([]);
  const [totalSales, setTotalSales] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null); // Track errors
  const [uiReady, setUiReady] = useState(false); // Ensure UI loads first

  useEffect(() => {
    // Fake loading delay for smooth UI transition
    setTimeout(() => {
      setUiReady(true);
    }, 800);
  }, []);

  const handleFileUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
  
      console.log("📂 Selected file:", file);
      setLoading(true);
      setError(null);
  
      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const fileContent = e.target.result;
  
          // Send file to main process for processing
          window.electronAPI.processFile({
            name: file.name,
            content: Array.from(new Uint8Array(fileContent)), // Convert to array
          });
  
          // Listen for processed data
          window.electronAPI.onProcessedData((processedData) => {
            setLoading(false);
            if (processedData.error) {
              setError(processedData.error);
              console.error("❌ Error from Python:", processedData.error);
              return;
            }
  
            setTotalSales(processedData.total_sales || 0);
            setData(processedData.aggregated_data || []);
          });
        };
        reader.readAsArrayBuffer(file);
      } catch (err) {
        setLoading(false);
        setError("An error occurred while reading the file.");
        console.error("🚨 File read error:", err);
      }
    };
    input.click();
  };

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"];

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      {!uiReady ? (
        <div style={{ fontSize: "24px", fontWeight: "bold", color: "#007bff" }}>
          Initializing UI... ⏳
        </div>
      ) : (
        <>
          <h1>Client 2: Welcome to your dashboard</h1>
          <button
            onClick={handleFileUpload}
            style={{
              padding: "10px 20px",
              fontSize: "16px",
              borderRadius: "10px",
              backgroundColor: "red",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            Select File
          </button>

          {/* Show Loading Spinner */}
          {loading && (
            <div style={{ marginTop: "20px", fontSize: "18px", color: "#007bff" }}>
              Processing file... ⏳
            </div>
          )}

          {/* Display Error Message */}
          {error && (
            <div
              style={{
                marginTop: "20px",
                fontSize: "18px",
                color: "red",
              }}
            >
              ❌ Error: {error}
            </div>
          )}

          {/* Display Total Sales as a KPI */}
          {totalSales !== null && !loading && !error && (
            <div
              style={{
                margin: "20px auto",
                padding: "15px",
                backgroundColor: "#f0f8ff",
                border: "2px solid #007bff",
                borderRadius: "10px",
                width: "300px",
                display: "inline-block",
              }}
            >
              <h2>Total Sales</h2>
              <p style={{ fontSize: "24px", fontWeight: "bold" }}>
                ${totalSales.toLocaleString()}
              </p>
            </div>
          )}

          {/* Show Charts Only When Data is Available */}
          {data.length > 0 && !loading && !error && (
            <>
              <h2>Bar Chart</h2>
              <BarChart
                width={600}
                height={300}
                data={data}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#8884d8" />
              </BarChart>
              <h2>Pie Chart</h2>
              <PieChart width={400} height={400}>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
