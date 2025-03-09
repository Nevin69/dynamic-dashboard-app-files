import React, { useState, useEffect, useCallback } from "react";
import FileUpload from "../../FileUpload";
import EnhancedFilters from "../../EnhancedFilters";
import GoogleSheetsManager from "../../GoogleSheetsManager";
import CustomTreemap from "../../components/CustomTreemap";
import "./Client1App.css";
import CustomPieChart from "../../components/CustomPieChart";
import CustomLineChart from "../../components/CustomLineChart";
import CustomHorizontalBarChart from "../../components/CustomHorizontalBarChart";

const FILTER_CONFIG = [
  { id: 'year', label: 'Filter by Year', column: 'Year', type: 'top-level', options: [], isCheckbox: true },
  { id: 'sector', label: 'Filter by Sector', column: "sector", type: 'top-level', options: [], isCheckbox: true },
  { id: 'sym', label: 'Filter by sym', column: 'sym', type: 'dependent', dependsOn: ['sector'], options: [], isCheckbox: false }
];

function Client1App() {
  const [error, setError] = useState(null);
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
      acc[filter.id] = { 
        options: [], 
        selected: filter.isCheckbox ? [] : "" // Arrays for checkboxes, strings for dropdowns
      };
      return acc;
    }, {});
  });
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState("upload");
  const [refreshInterval, setRefreshInterval] = useState(10); // Default to 10 minutes in minutes
  const [lastRefresh, setLastRefresh] = useState({ timestamp: null, formatted: null }); // Store timestamp and formatted string

  useEffect(() => {
    setTimeout(() => setUiReady(true), 800);
  }, []);


  const getFilterValues = useCallback(() => {
    console.log("Deriving filterValues from filterStates:", filterStates);
    return Object.entries(filterStates).reduce((acc, [key, state]) => {
      const filter = FILTER_CONFIG.find(f => f.id === key);
      if (filter && state.selected !== undefined && state.selected.length > 0) {
        acc[filter.column] = filter.isCheckbox ? JSON.stringify(state.selected) : String(state.selected); // JSON strings for checkboxes, strings for dropdowns
      }
      return acc;
    }, {});
  }, [filterStates]);


  useEffect(() => {
    const sendFilterConfig = async () => {
      try {
        await window.electronAPI.setFilterConfig(FILTER_CONFIG);
        console.log("Sent FILTER_CONFIG to backend:", FILTER_CONFIG);
      } catch (error) {
        console.error("Failed to send FILTER_CONFIG:", error);
      }
    };
    sendFilterConfig();
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
    console.log(processedData.price_trends.aggregated_data)
    setFilterStates(prevState => {
      const newState = { ...prevState };
      FILTER_CONFIG.forEach(filter => {
        const optionsKey = `${filter.column.toLowerCase()}_options`;
        const options = processedData.price_trends?.[optionsKey] || processedData.sp500_data?.[optionsKey] || [];  // Options are back at root level
        if (options.length > 0) {
          newState[filter.id] = { ...newState[filter.id], options };
        }
      });
      return newState;
    });
  };

  const updateFiles = useCallback((filesWithSheets) => {
    setLastUploadedFiles(filesWithSheets);
  }, []);

  const handleFilterChange = useCallback((filterId, value, isAll = false) => {
    requestAnimationFrame(() => {
      setFilterStates(prevState => {
        const newState = { ...prevState };
        const filter = FILTER_CONFIG.find(f => f.id === filterId);
        if (filter.isCheckbox) {
          const currentSelected = newState[filterId].selected || [];
          if (isAll) {
            newState[filterId] = { ...newState[filterId], selected: [] };
          } else if (value === "toggleAll") {
            if (currentSelected.length === newState[filterId].options.length) {
              newState[filterId] = { ...newState[filterId], selected: [] }; // Deselect All
            } else {
              newState[filterId] = { ...newState[filterId], selected: [...newState[filterId].options] }; // Select All
            }
          } else {
            if (currentSelected.includes(value)) {
              newState[filterId] = { ...newState[filterId], selected: currentSelected.filter(v => v !== value) };
            } else {
              newState[filterId] = { ...newState[filterId], selected: [...currentSelected, value] };
            }
          }
        } else {
          newState[filterId] = { ...newState[filterId], selected: value === "" ? "" : value }; // "" for "All"
        }
        const currentFilter = FILTER_CONFIG.find(f => f.id === filterId);
        FILTER_CONFIG.forEach(filter => {
          if (filter.dependsOn?.includes(currentFilter.id)) {
            newState[filter.id] = { ...newState[filter.id], selected: filter.isCheckbox ? [] : "" };
          }
        });
        return newState;
      });
    });
  }, [FILTER_CONFIG]);

  const fetchData = async (filterValues = {}) => {
    if (!lastUploadedFiles.some(file => file.path) && !sheetEntries.some(entry => entry.url)) return;
  
    // Use filterValues directly from getFilterValues (already JSON strings for arrays)
    const sanitizedFilterValues = getFilterValues();
  
    setIsLoading(true);
    try {
      console.log("Fetching data with:", sanitizedFilterValues);
      const response = await window.electronAPI.filterData(sanitizedFilterValues);
      console.log("Data response:", response);
      if (response.success) {
        handleDataProcessed(response);
      } else {
        console.error("❌ Error fetching data:", response.error, "Full response:", response);
        setProcessedData(null); // Clear on fetch failure
        setError(response.error || "Failed to fetch data");
      }
    } catch (error) {
      console.error("❌ Failed to fetch data:", error.response?.data || error.message);
      setProcessedData(null); // Clear on exception
      setError(error.message || "Failed to fetch data");
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

  const processAllData = async (filterValues = {}) => {
    const sanitizedFilterValues = getFilterValues();
  
    console.log("Raw filterValues received in processAllData:", filterValues, "Type:", typeof filterValues);
    console.log("Sanitized filterValues in processAllData:", sanitizedFilterValues);
  
    const hasFiles = lastUploadedFiles.some(file => file.path);
    const hasSheets = sheetEntries.some(entry => entry.url && entry.selectedSheet);
  
    if (!hasFiles && !hasSheets) {
      console.error("No files or sheets to process.");
      setProcessedData(null); // Clear dashboard if no data
      return;
    }
  
    setIsLoading(true);
    try {
      console.log("Sheet entries before processing:", sheetEntries);
      if (hasFiles) {
        const excelResponse = await window.electronAPI.uploadFiles(lastUploadedFiles.filter(file => file.path));
        if (!excelResponse.success) {
          throw new Error(excelResponse.error || "Failed to upload Excel files");
        }
        console.log("Excel files processed:", excelResponse);
      }
  
      if (hasSheets) {
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
  
      await fetchData(sanitizedFilterValues);
      setViewMode("dashboard");
    } catch (error) {
      console.error("❌ Error processing all data:", error);
      setProcessedData(null); // Clear dashboard on error
      setError(error.message || "Failed to refresh data");
    } finally {
      setIsLoading(false);
    }
  };
  

  useEffect(() => {
    if (!lastUploadedFiles.some(file => file.path) && !sheetEntries.some(entry => entry.url)) return;
  
    const intervalId = setInterval(() => {
      const filterValues = getFilterValues(); // Use getFilterValues for JSON strings
      processAllData(filterValues).then(() => {
        setLastRefresh({ timestamp: Date.now(), formatted: formatLastRefresh(Date.now()) }); // Update timestamp and initial format
      }).catch(error => {
        console.error("❌ Error updating last refresh time:", error);
      });
    }, refreshInterval * 60 * 1000); // Convert minutes to milliseconds
  
    return () => clearInterval(intervalId); // Cleanup on unmount
  }, [refreshInterval, lastUploadedFiles, sheetEntries, getFilterValues]);




  const switchToUpload = () => {
    setViewMode("upload");
  };


  const handleRefresh = useCallback(() => {
    let timeoutId;
    const debounce = (callback, delay) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        callback();
      }, delay);
    };
  
    debounce(async () => {
      setIsLoading(true);
      try {
        const filterValues = getFilterValues(); // Use getFilterValues for JSON strings
        await processAllData(filterValues); // Pass current filters to processAllData
        setLastRefresh({ timestamp: Date.now(), formatted: formatLastRefresh(Date.now()) }); // Update timestamp and initial format
      } catch (error) {
        console.error("❌ Error refreshing data:", error);
        setError(error.message || "Failed to refresh data");
      } finally {
        setIsLoading(false);
      }
    }, 300); // 300ms debounce to prevent rapid clicks
  }, [getFilterValues]);




  

  // Utility to format time with increments in 10-second steps for seconds
// Utility to format time with increments in 10-second steps for seconds
  function formatLastRefresh(timestamp) {
    if (!timestamp) return null;
    
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Format the exact time (e.g., 5:29 AM)
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: true 
    });

    // Format "X Time Ago" with 10-second increments for seconds (up to 59 seconds)
    if (diffSeconds < 60) {
      const roundedSeconds = Math.floor(diffSeconds / 10) * 10; // Round to nearest 10 seconds
      return roundedSeconds > 0 ? `( ${timeStr}, ${roundedSeconds} Sec${roundedSeconds !== 10 ? 's' : ''} Ago )` : `( ${timeStr}, Just Now )`;
    }
    if (diffMinutes < 60) return `( ${timeStr}, ${diffMinutes} Minute${diffMinutes !== 1 ? 's' : ''} Ago )`;
    if (diffHours < 24) return `( ${timeStr}, ${diffHours} Hour${diffHours !== 1 ? 's' : ''} Ago )`;
    return `( ${timeStr}, ${diffDays} Day${diffDays !== 1 ? 's' : ''} Ago )`;
  }


  useEffect(() => {
    let intervalId;
    if (lastRefresh.timestamp) {
      intervalId = setInterval(() => {
        setLastRefresh(prev => ({
          ...prev,
          formatted: formatLastRefresh(prev.timestamp)
        }));
      }, 1000); // Update every second to reflect real-time elapsed time
    }
    return () => clearInterval(intervalId); // Cleanup on unmount or when timestamp changes
  }, [lastRefresh.timestamp]); // Only re-run when the timestamp changes


  const handleClearFilters = useCallback(() => {
    requestAnimationFrame(() => {
      setFilterStates(prevState => {
        const newState = { ...prevState };
        Object.keys(newState).forEach(key => {
          const filter = FILTER_CONFIG.find(f => f.id === key);
          newState[key] = { ...newState[key], selected: filter.isCheckbox ? [] : "" };
        });
        return newState;
      });
      // Fetch unfiltered data after clearing
      fetchData().catch(error => {
        console.error("❌ Error clearing filters and fetching data:", error);
        setError(error.message || "Failed to clear filters and refresh data");
      });
    });
  }, [FILTER_CONFIG]);


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
            initialFilesWithSheets={lastUploadedFiles} // Pass full objects with path and sheet
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
            <button onClick={() => processAllData(getFilterValues())} className="process-all-button" disabled={isLoading}>
              {isLoading ? "Processing..." : "Process All Data"}
            </button>
          </section>
        </>
      ) : (


        <div className="dashboard-container">
          <div className="absolute">
            <div className="absolute inset-0 justify-center">
                <div className="bg-shapel bg-teal opacity-50 bg-blur"></div>
                <div className="bg-shape2 bg-primary opacity-50 bg-blur"></div>
                <div className="bg-shapel bg-primary opacity-50 bg-blur"></div>
            </div>
          </div>
          
          <h1 className="dashboard-title">Finance Dashboard</h1>
          <button 
            onClick={switchToUpload} 
            className="edit-data-button" 
            style={{ position: "absolute", top: "10px", right: "20px", padding: "10px 20px", backgroundColor: "#4CAF50", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
          >
            Edit Data
          </button>
          <button 
            onClick={handleRefresh} 
            className="refresh-button" 
            style={{ position: "absolute", top: "10px", right: "150px", padding: "10px 20px", backgroundColor: "#2196F3", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing..." : "Refresh Data"}
          </button>

          
          {lastRefresh.formatted && (
            <div style={{ position: "absolute", top: "40px", right: "300px", color: "#fff", fontSize: "14px" }}>
              {lastRefresh.formatted}
            </div>
          )}
          <select 
            value={refreshInterval} 
            onChange={(e) => setRefreshInterval(parseInt(e.target.value, 10))} 
            style={{ position: "absolute", top: "10px", right: "300px", padding: "10px", backgroundColor: "#f5f5f5", border: "1px solid #ddd", borderRadius: "5px", cursor: "pointer" }}
            disabled={isLoading}
          >
            <option value={1}>Refresh every 1 minute</option>
            <option value={10}>Refresh every 10 minutes</option>
            <option value={15}>Refresh every 15 minutes</option>
          </select>
          {/* Filters */}
          {(processedData?.price_trends?.aggregated_data?.length > 0 || processedData?.sp500?.aggregated_data?.length > 0) && (
            <section className="app-section">
              <EnhancedFilters filterConfig={FILTER_CONFIG} filterStates={filterStates} onFilterChange={handleFilterChange} isLoading={isLoading} />
            </section>
          )}

          <button 
            onClick={handleClearFilters}
            className="clear-filters-button" 
            style={{ position: "absolute", top: "150px", right: "280px", padding: "10px 20px", backgroundColor: "#f44336", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
            disabled={isLoading}
          >
            {isLoading ? "Clearing..." : "Clear All Filters"}
          </button>

          {(processedData?.price_trends?.aggregated_data?.length > 0 || processedData?.sp500?.aggregated_data?.length > 0) && (
            <div className="charts-layout">

              <div className="chart-container linechart">
              <div className="chart-content">
                <h2 className="chart-title" style={{color : "rgba(3, 13, 58, 0.77)"}}>Avg Gold Price Trend</h2>

                  <CustomLineChart
                    data={processedData.price_trends.aggregated_data}
                    dataKey="value"
                    nameKey="Year"
                    colors={"#fff"}
                    width="100%"
                    height={300}
                    xAxisDataKey="Year"
                    tooltipFormatter={(params) => {
                      if (!params || !params.name || !params.value) return "No data";
                      return `
                        <div style="padding: 5px; border: 1px solid #ccc; background-color: #fff;">
                          <p><strong>Year:</strong> ${params.name}</p>
                          <p><strong>Value:</strong> ${params.value}</p>
                        </div>
                      `;
                    }}
                    strokeWidth={3}
                    showDots={false}
                    margin={{
                      top: 30,
                      right: 50,
                      left: 30,
                      bottom: 30
                    }}
                    isAnimationActive={true}
                    yGridLine={false}
                    AxisNames=""
                    xAxisNameGap={30}
                    axisColor="rgba(3, 13, 58, 0.77)"
                    className="linechart"
                  />
                  </div>

              </div>
            
              {processedData?.sp500_data?.aggregated_data?.length > 0 && (
                <div className="chart-container special piechart">
                  <div className="chart-content">
                  <h2 className="chart-title" style={{color: "#fff"}}>S&P 500 Market Cap</h2>
                  
                    <CustomPieChart
                      data={processedData.sp500_data.aggregated_data}
                      dataKey="percentage"
                      nameKey="sector"
                      colors = {[
                        "rgb(124, 105, 249)",
                        "rgba(115, 95, 247, 0.86)",
                        "rgb(106, 85, 243)",
                        "rgb(98, 75, 247)",
                        "rgb(96, 73, 247)"

                      ]}
                      width="100%"
                      height={300}
                      
                      tooltipFormatter={(params) => `
                        <div style="padding: 5px; border: 1px solid #ccc; background-color: #fff;">
                          <p><strong>Sector:</strong> ${params.name}</p>
                          <p><strong>Market Cap:</strong> ${params.value}</p>
                          <p><strong>Percentage:</strong> ${params.percent.toFixed(1)}%</p>
                        </div>
                      `}
                      innerRadius={0.3}
                      outerRadius={0.8}
                      stroke="#fff"
                      strokeWidth={0.6}
                      isAnimationActive={true}
                      className="piechart"
                    />
                  </div>
                </div>
              )}

              {processedData?.sp500_data?.stock_data?.length > 0 && (
                <div className="chart-container treechart">
                  <h2 className="chart-title" style={{color : "rgba(3, 13, 58, 0.77)"}}>S&P 500</h2>
                  <CustomTreemap
                    data={processedData.sp500_data.stock_data}
                    dataKey="% stock weight"
                    nameKey="sym"
                    colors={["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#AF19FF"]}
                    width="100%"
                    height={300}
                    label={{
                      show: true,
                      formatter: "{b}", // Show only sym
                      fontSize: 12,
                      position: "center"
                    }}
                    tooltipFormatter={(params) => `
                      <div style="padding: 5px; border: 1px solid #ccc; background-color: #fff;">
                        <p><strong>SYM:</strong> ${params.name}</p>
                        <p><strong>% Stock Weight:</strong> ${(params.value).toFixed(2)}%</p>
                      </div>
                    `}
                    stroke="#fff"
                    strokeWidth={1}
                    gapWidth={1}
                    visualMin={0}
                    visualMax={600} // Adjust based on max % stock weight * 100
                    isAnimationActive={true}
                  />
                </div>
              )}


<div className="chart-container barchart">
  <h2 className="chart-title" style={{color : "rgba(3, 13, 58, 0.77)"}}>Bar Chart</h2>
  <div style={{ width: "100%", height: 300 }}>
    <CustomHorizontalBarChart
      data={processedData.price_trends.aggregated_housing_price}
      dataKey="housing"
      nameKey="Year"
      colors={["#7C6CFC"]}
      width="100%"
      height={300}
      title="Bar Chart"
      xAxisDataKey="Year"    // Category for x-axis (labels)
      yAxisDataKey="housing" // Value for y-axis (bar height)
      tooltipFormatter={(params) => {
        console.log("Tooltip params in App.js:", params); // Debug
        if (!params || !params.name || !params.value) return "No data";
        return `
          <div style="padding: 5px; border: 1px solid #ccc; background-color: #fff;">
            <p><strong>Year:</strong> ${params.name}</p>
            <p><strong>Housing Price:</strong> ${params.value}</p>
          </div>
        `;
      }}
      barRadius={[2, 2, 0, 0]} // Matches Recharts' radius for top-left, top-right, bottom-right, bottom-left
      margin={{
        top: 20,
        right: 30,
        left: 20,
        bottom: 5
      }}
      isAnimationActive={true}
      xAxisName=""         // X-axis title for categories
      yAxisName="" // Y-axis title for values
      xAxisNameGap={30}        // Space between x-axis name and labels
      yAxisNameGap={20}        // Space between y-axis name and labels
      xGridLine={false}        // Hide x-axis grid lines
      yGridLine={false}        // Hide y-axis grid lines
      axisColor="rgba(3, 13, 58, 0.77)"     // Color for axis labels and ticks
      className="barchart"
    />
  </div>
</div>
            </div>
            
          )}
        </div>
      )}
      
    </div>
  );
}

export default Client1App;
