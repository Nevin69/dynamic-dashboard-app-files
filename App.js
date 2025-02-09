import React, { useState } from "react";
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
import FileUpload from "./FileUpload"; // Import the new component

function App() {
  const [data, setData] = useState([]);
  const [totalSales, setTotalSales] = useState(null);

  const handleDataProcessed = (processedData) => {
    setTotalSales(processedData.totalSales);
    setData(processedData.data);
  };

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"];

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h1>Client 1 Data Aggregation and Visualization</h1>

      {/* Upload Component */}
      <FileUpload onDataProcessed={handleDataProcessed} />

      {/* Total Sales KPI */}
      {totalSales !== null && (
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
          <p style={{ fontSize: "24px", fontWeight: "bold" }}>${totalSales.toLocaleString()}</p>
        </div>
      )}

      {/* Charts */}
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
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </>
      )}
    </div>
  );
}

export default App;
