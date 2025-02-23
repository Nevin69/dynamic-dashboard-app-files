import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from "recharts";
import FileUpload from "./FileUpload";
import EnhancedFilters from './EnhancedFilters';
import GoogleSheetsManager from "./GoogleSheetsManager";

const FILTER_CONFIG = [
  { id: 'category', label: 'Filter by Category', column: 'Category', type: 'top-level', options: [] },
  { id: 'subcategory', label: 'Filter by SubCategory', column: 'SubCategory', type: 'dependent', dependsOn: ['category'], options: [] },
  { id: 'item', label: 'Filter by Item', column: 'Item', type: 'dependent', dependsOn: ['category', 'subcategory'], options: [] }
];

function App() {
  const [processedData, setProcessedData] = useState(null);  // Single state for all /get-data/ response
  const [uiReady, setUiReady] = useState(false);
  const [lastUploadedFiles, setLastUploadedFiles] = useState(() => {
    const savedFiles = localStorage.getItem("uploadedFiles");
    return savedFiles ? JSON.parse(savedFiles) : [];
  });
  const [sheetEntries, setSheetEntries] = useState(() => {
    const savedSheets = localStorage.getItem("sheetEntries");
    return savedSheets ? JSON.parse(savedSheets) : Array.from({ length: 3 }, (_, index) => ({
      id: Date.now() + index,
      url: "",
      availableSheetNames: [],
      selectedSheet: "",
      datasetName: `googlesheet${index + 1}`,
    }));
  });
  const [authToken, setAuthToken] = useState(null);
  const [filterStates, setFilterStates] = useState(() => {
    return FILTER_CONFIG.reduce((acc, filter) => {
      acc[filter.id] = { options: [], selected: "" };
      return acc;
    }, {});
  });
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState("upload");

  useEffect(() => {
    setTimeout(() => setUiReady(true), 800);
  }, []);

  useEffect(() => {
    localStorage.setItem("sheetEntries", JSON.stringify(sheetEntries));
    localStorage.setItem("uploadedFiles", JSON.stringify(lastUploadedFiles));
  }, [sheetEntries, lastUploadedFiles]);

  useEffect(() => {
    const shouldFetchData = lastUploadedFiles.some(file => file) || sheetEntries.some(entry => entry.url);
    if (shouldFetchData) {
      const filterValues = Object.entries(filterStates).reduce((acc, [key, state]) => {
        acc[FILTER_CONFIG.find(f => f.id === key).column] = state.selected;
        return acc;
      }, {});
      const timeoutId = setTimeout(() => {
        setIsLoading(true);
        fetchData(filterValues).finally(() => requestAnimationFrame(() => setIsLoading(false)));
      }, 300);
      return () => clearTimeout(timeoutId);
    } else {
      setProcessedData(null);  // Reset all data when no files/sheets
      setFilterStates(prevState => {
        const newState = { ...prevState };
        Object.keys(newState).forEach(key => newState[key] = { options: [], selected: "" });
        return newState;
      });
    }
  }, [JSON.stringify(filterStates)]);

  const handleDataProcessed = (processedData) => {
    if (!processedData || typeof processedData !== "object" || !processedData.success) {
      console.error("❌ Invalid data format or failed response:", processedData);
      return;
    }
    setProcessedData(processedData);  // Store entire JSON response
    setFilterStates(prevState => {
      const newState = { ...prevState };
      FILTER_CONFIG.forEach(filter => {
        const optionsKey = `${filter.column.toLowerCase()}_options`;
        if (processedData[optionsKey]) {
          newState[filter.id] = { ...newState[filter.id], options: processedData[optionsKey] };
        }
      });
      return newState;
    });
  };

  const updateFiles = useCallback((files) => {
    setLastUploadedFiles(files);
  }, []);

  const handleFilterChange = useCallback((filterId, value) => {
    requestAnimationFrame(() => {
      setFilterStates(prevState => {
        const newState = { ...prevState };
        newState[filterId] = { ...newState[filterId], selected: value };
        const currentFilter = FILTER_CONFIG.find(f => f.id === filterId);
        FILTER_CONFIG.forEach(filter => {
          if (filter.dependsOn?.includes(currentFilter.id)) {
            newState[filter.id] = { ...newState[filter.id], selected: "" };
          }
        });
        return newState;
      });
    });
  }, []);

  const fetchData = async (filterValues = {}) => {
    if (!lastUploadedFiles.some(file => file) && !sheetEntries.some(entry => entry.url)) return;
    setIsLoading(true);
    try {
      console.log("Fetching data with:", filterValues);
      const response = await window.electronAPI.fetchData(filterValues);
      console.log("Data response:", response);
      if (response.success) {
        handleDataProcessed(response);
      } else {
        console.error("❌ Error fetching data:", response.error, "Full response:", response);
      }
    } catch (error) {
      console.error("❌ Failed to fetch data:", error.response?.data || error.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDataCleared = async () => {
    try {
      await fetchData(); // Fetch unfiltered data after clearing
    } catch (error) {
      console.error("❌ Error refreshing data after clearing:", error);
    }
  };

  const processAllData = async () => {
    if (!lastUploadedFiles.some(file => file) && !sheetEntries.some(entry => entry.url)) {
      console.error("No files or sheets to process.");
      return;
    }

    setIsLoading(true);
    try {
      console.log("Sheet entries before processing:", sheetEntries);
      if (lastUploadedFiles.some(file => file)) {
        const excelResponse = await window.electronAPI.uploadFiles(lastUploadedFiles.filter(file => file));
        if (!excelResponse.success) {
          throw new Error(excelResponse.error || "Failed to upload Excel files");
        }
        console.log("Excel files processed:", excelResponse);
      }

      if (sheetEntries.some(entry => entry.url && entry.selectedSheet)) {
        for (let index = 0; index < sheetEntries.length; index++) {
          const entry = sheetEntries[index];
          if (entry.url && entry.selectedSheet) {
            console.log(`Processing sheet ${index + 1}: ${entry.selectedSheet}`);
            const response = await window.electronAPI.processGoogleSheet(
              entry.url,
              authToken,
              entry.selectedSheet,
              index + 1
            );
            if (!response.success) {
              throw new Error(response.error || `Failed to process sheet ${entry.selectedSheet}`);
            }
            setSheetEntries((prev) =>
              prev.map((item) =>
                item.id === entry.id ? { ...item, datasetName: response.dataset_name } : item
              )
            );
            console.log(`Processed sheet ${index + 1}: ${response.dataset_name}`);
          }
        }
      }

      await fetchData(); // Fetch unfiltered data after processing
      setViewMode("dashboard");
    } catch (error) {
      console.error("❌ Error processing all data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const switchToUpload = () => {
    setViewMode("upload");
  };

  return (
    <div className="app-container">
      {!uiReady ? (
        <div className="loading-state">Initializing UI... ⏳</div>
      ) : viewMode === "upload" ? (
        <>
          <h1 className="app-title">Data Aggregation and Visualization</h1>
          <section className="app-section">
            <FileUpload
              numFiles={3}
              buttonLabels={["Upload Data 1", "Upload Data 2", "Upload Data 3"]}
              buttonStyles={[{ backgroundColor: "#4CAF50", color: "white" }, { backgroundColor: "#4CAF50", color: "white" }, { backgroundColor: "#4CAF50", color: "white" }]}
              onDataProcessed={() => {}}
              onFilesUpdated={updateFiles}
            />
          </section>
          <section className="app-section">
            <h2>Add Google Sheets</h2>
            <GoogleSheetsManager
              authToken={authToken}
              onAuthChange={setAuthToken}
              onSheetsUpdate={setSheetEntries}
              numSheets={3}
              onDataCleared={handleDataCleared}
              sheetEntries={sheetEntries}
            />
          </section>
          <section className="app-section">
            <button onClick={processAllData} className="process-all-button" disabled={isLoading}>
              {isLoading ? "Processing..." : "Process All Data"}
            </button>
          </section>
        </>
      ) : (
        <div className="dashboard-container">
          <button 
            onClick={switchToUpload} 
            className="edit-data-button" 
            style={{ position: "absolute", top: "10px", right: "10px", padding: "10px 20px", backgroundColor: "#4CAF50", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
          >
            Edit Data
          </button>
          {/* Filters */}
          {processedData?.aggregated_data?.length > 0 && (
            <section className="app-section">
              <EnhancedFilters filterConfig={FILTER_CONFIG} filterStates={filterStates} onFilterChange={handleFilterChange} isLoading={isLoading} />
            </section>
          )}
          {/* Total Sales Card */}
          {processedData?.total_sales !== null && processedData?.total_sales !== undefined && !isNaN(processedData?.total_sales) && (
            <div className="total-sales-card">
              <h2 className="total-sales-title">Total Sales</h2>
              <p className="total-sales-amount">${processedData.total_sales.toLocaleString()}</p>
            </div>
          )}
          {/* Googlesheet3 Sum Card */}
          {processedData?.googlesheet3_sum !== null && processedData?.googlesheet3_sum !== undefined && !isNaN(processedData?.googlesheet3_sum) && (
            <div className="googlesheet3-sum-card">
              <h2 className="googlesheet3-sum-title">Googlesheet3 Sum</h2>
              <p className="googlesheet3-sum-amount">${processedData.googlesheet3_sum.toLocaleString()}</p>
            </div>
          )}
          {/* Charts */}
          {processedData?.aggregated_data?.length > 0 && (
            <div className="charts-layout">
              <div className="chart-container">
                <h2>Bar Chart</h2>
                <BarChart width={600} height={300} data={processedData.aggregated_data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="Category" />  {/* Dynamic: Could change based on /get-data/ response */}
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#8884d8" /> 
                </BarChart>
              </div>
              <div className="chart-container">
                <h2 className="chart-title">Pie Chart</h2>
                <PieChart width={800} height={400}>
                  <Pie
                    data={processedData.aggregated_data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ Category, value }) => `${Category}: ${value}`}
                    outerRadius={120}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {processedData.aggregated_data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"][index % 5]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
