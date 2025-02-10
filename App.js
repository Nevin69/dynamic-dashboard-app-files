import React, { useState, useEffect, useCallback } from "react";
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
import FileUpload from "./FileUpload";

function App() {
  const [data, setData] = useState([]);
  const [totalSales, setTotalSales] = useState(null);
  const [uiReady, setUiReady] = useState(false);
  const [lastUploadedFiles, setLastUploadedFiles] = useState(() => {
    const savedFiles = localStorage.getItem("uploadedFiles");
    return savedFiles ? JSON.parse(savedFiles) : [];
  });

  useEffect(() => {
    setTimeout(() => {
      setUiReady(true);
    }, 800);
  }, []);

  const handleDataProcessed = (processedData) => {
    setTotalSales(processedData.totalSales);
    setData(processedData.data);
  };

  const updateFiles = useCallback((files) => {
    setLastUploadedFiles(files);
    localStorage.setItem("uploadedFiles", JSON.stringify(files));
  
    // ✅ If all files are cleared, reset UI & stop auto-refresh
    if (files.every((file) => file === null)) {
      console.log("🧹 Files cleared! Resetting data...");
      setTotalSales(null);
      setData([]);
    }
  }, []);

  useEffect(() => {
    if (lastUploadedFiles.every((file) => file)) {
      console.log("🔄 Refreshing Data (No Reprocessing)...");

      const refreshData = () => {
        console.log("Fetching updated data...");
        window.electronAPI.processFiles([...lastUploadedFiles]);
      };

      refreshData();
      const interval = setInterval(refreshData, 30000);

      return () => clearInterval(interval);
    }
  }, [lastUploadedFiles]);

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      {!uiReady ? (
        <div style={{ fontSize: "24px", fontWeight: "bold", color: "#007bff" }}>
          Initializing UI... ⏳
        </div>
      ) : (
        <>
          <h1>Data Aggregation and Visualization</h1>

          <FileUpload 
            numFiles={2} 
            buttonLabels={["Upload Data 1", "Upload Data 2"]} 
            buttonStyles={[
              { backgroundColor: "#3d3a4e", color: "white" }, 
              { backgroundColor: "#3d3a4e", color: "white" }, 
            ]}
            onDataProcessed={handleDataProcessed}
            onFilesUpdated={updateFiles} // ✅ Pass callback to FileUpload.js
          />

          {totalSales !== null && (
            <div style={{ margin: "20px auto", padding: "15px", backgroundColor: "#f0f8ff", border: "2px solid #007bff", borderRadius: "10px", width: "300px", display: "inline-block" }}>
              <h2>Total Sales</h2>
              <p style={{ fontSize: "24px", fontWeight: "bold" }}>${totalSales.toLocaleString()}</p>
            </div>
          )}

          {data.length > 0 && (
            <>
              <h2>Bar Chart</h2>
              <BarChart width={600} height={300} data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
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
                    <Cell key={`cell-${index}`} fill={["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"][index % 5]} />
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
