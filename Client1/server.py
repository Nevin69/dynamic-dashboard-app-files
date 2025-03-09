

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

datasets = {}
CHUNK_SIZE = 10000

# Global FILTER_CONFIG to override the hardcoded one
FILTER_CONFIG = []


SCOPES = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
CREDENTIALS_FILE = 'google_credentials.json'

def setup_google_sheets():
    try:
        credentials = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_FILE, SCOPES)
        return gspread.authorize(credentials)
    except Exception as e:
        print(f"Error setting up Google Sheets: {e}")
        return None

def get_sheet_id_from_url(url):
    try:
        parsed = urlparse(url)
        if parsed.path.startswith('/spreadsheets/d/'):
            return parsed.path.split('/')[3]
    except:
        pass
    return None


@app.post("/set-filter-config/")
async def set_filter_config(data: dict = Body(...)):
    global FILTER_CONFIG
    try:
        FILTER_CONFIG = json.loads(data["filterConfig"])  # Parse JSON string
        # Convert "dependsOn" to "depends_on" for backend compatibility
        for config in FILTER_CONFIG:
            if "dependsOn" in config:
                config["depends_on"] = config.pop("dependsOn")
        return {"success": True, "message": "Filter config set successfully"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/get-sheet-names/")
async def get_sheet_names(sheet_url: str = Form(...), auth_token: str = Form(...)):
    try:
        sheet_id = get_sheet_id_from_url(sheet_url)
        if not sheet_id:
            return {"success": False, "error": "Invalid Google Sheet URL"}
        creds = Credentials(token=auth_token)
        service = build("sheets", "v4", credentials=creds)
        spreadsheet = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        sheets = spreadsheet.get("sheets", [])
        sheet_names = [sheet["properties"]["title"] for sheet in sheets if "title" in sheet["properties"]]
        return {"success": True, "sheet_names": sheet_names}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# New endpoint for fetching Excel sheet names
@app.post("/get-excel-sheet-names/")
async def get_excel_sheet_names(file: UploadFile = File(...)):
    temp_file = None
    try:
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
        with open(temp_file.name, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        xl = pd.ExcelFile(temp_file.name, engine="openpyxl")
        sheet_names = xl.sheet_names
        xl.close()
        print(f"Excel sheet names: {sheet_names}")
        return {"success": True, "sheet_names": sheet_names}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.unlink(temp_file.name)
            except Exception as e:
                print(f"Warning: Failed to delete temp file {temp_file.name}: {str(e)}")


@app.post("/upload-files/")
async def upload_files(
    files: List[UploadFile] = File(...),
    sheet_names: List[Optional[str]] = Form(default_factory=lambda: [])
):
    global datasets
    try:
        for i, file in enumerate(files, 1):
            # Use BytesIO for in-memory streaming
            content = await file.read()  # Read the entire file into memory
            excel_file = BytesIO(content)
            
            # Read Excel file using openpyxl
            chunks = []
            xl = pd.ExcelFile(excel_file, engine="openpyxl")
            sheet_name = sheet_names[i-1] if i-1 < len(sheet_names) and sheet_names[i-1] else None
            available_sheets = xl.sheet_names
            
            # Process each sheet (up to 4-5, or as specified)
            for sheet in [sheet_name] if sheet_name else available_sheets[:5]:  # Limit to 5 sheets for safety
                df = pd.read_excel(
                    excel_file,
                    sheet_name=sheet,
                    engine="openpyxl",
                    dtype_backend='numpy_nullable'  # Faster type inference for large datasets
                )
                chunks.append(df)  # Keep full data, no aggregation
            
            # Combine all sheets into a single full DataFrame (if multiple sheets)
            final_df = pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
            
            # Store full (unaggregated) DataFrame in datasets
            datasets[f"excelsheet{i}"] = final_df
            print(f"Stored excelsheet{i} with {len(final_df)} rows from sheet(s): {sheet_name or ', '.join(available_sheets[:5])}")
        
        return {"success": True, "message": f"{len(files)} files uploaded and processed successfully"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/process-google-sheet/")
async def process_google_sheet(
    sheet_url: str = Form(...),
    auth_token: str = Form(...),
    sheet_name: str = Form("Sheet1"),
    sheet_index: int = Form(1)
):
    global datasets
    try:
        sheet_id = get_sheet_id_from_url(sheet_url)
        if not sheet_id:
            return {"success": False, "error": "Invalid Google Sheet URL"}
        
        creds = Credentials(token=auth_token)
        service = build("sheets", "v4", credentials=creds)

        # Get sheet dimensions to optimize range
        sheet_properties = service.spreadsheets().get(spreadsheetId=sheet_id).execute()["sheets"][0]["properties"]
        grid_properties = sheet_properties.get("gridProperties", {})
        row_count = grid_properties.get("rowCount", 1000000)  # Default to 1M if not specified
        col_count = grid_properties.get("columnCount", 26)    # Default to 26 (Z) if not specified

        # Estimate data range (e.g., A1 to the last used column/row, capped at 500,000 cells per request)
        max_cells = 500000  # Google Sheets API limit per request
        rows_per_request = min(row_count, max_cells // col_count)
        if rows_per_request <= 0:
            rows_per_request = 1000  # Fallback for small sheets

        chunks = []
        for start_row in range(0, row_count, rows_per_request):
            end_row = min(start_row + rows_per_request, row_count)
            range_str = f"{sheet_name}!A{start_row + 1}:Z{end_row}"
            result = service.spreadsheets().values().get(spreadsheetId=sheet_id, range=range_str).execute()
            values = result.get("values", [])
            
            if not values:
                continue
            
            if not chunks:  # First chunk provides headers
                header = values[0] if values else ["default_column"]
                chunks.append(pd.DataFrame(values[1:], columns=header))
            else:
                chunks.append(pd.DataFrame(values, columns=header))

        # Combine chunks into a single full (unaggregated) DataFrame
        final_df = pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
        # Store full (unaggregated) DataFrame in datasets
        dataset_name = f"googlesheet{sheet_index}"
        datasets[dataset_name] = final_df
        print(f"Stored {dataset_name} with {len(final_df)} rows from sheet: {sheet_name}")
        
        return {"success": True, "message": "Google Sheet processed successfully", "dataset_name": dataset_name}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/clear-dataset/")
async def clear_dataset(dataset_name: str = Form(...)):
    global datasets
    try:
        if dataset_name in datasets:
            del datasets[dataset_name]
            return {"success": True, "message": f"Cleared dataset {dataset_name}"}
        else:
            return {"success": False, "error": f"Dataset {dataset_name} not found"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def get_filtered_dataframe(df: pd.DataFrame, filter_values: dict[str, Any]) -> pd.DataFrame:
    filtered_df = df
    for filter_config in FILTER_CONFIG:
        column = filter_config["column"]
        if column in filter_values and filter_values[column] and filter_values[column] != "All" and column in df.columns:
            values = filter_values[column]
            if isinstance(values, list):  # Handle checkbox multi-selection with OR logic
                filtered_df = filtered_df[filtered_df[column].isin(values)]
            else:  # Handle single-selection or unexpected strings
                filtered_df = filtered_df[filtered_df[column] == str(values)]
    return filtered_df

def get_filter_options(df: pd.DataFrame, filter_values: dict[str, Any]) -> dict[str, list[str]]:
    filter_options = {}
    temp_df = df
    for filter_config in FILTER_CONFIG:
        current_df = temp_df
        column = filter_config["column"]
        if filter_config.get("depends_on"):
            for dep_id in filter_config["depends_on"]:
                dep_column = next(f["column"] for f in FILTER_CONFIG if f["id"] == dep_id)
                if dep_column in filter_values and filter_values[dep_column] and filter_values[dep_column] != "All" and dep_column in df.columns:
                    values = filter_values[dep_column]
                    if isinstance(values, list):
                        current_df = current_df[current_df[dep_column].isin(values)]
                    else:
                        current_df = current_df[current_df[dep_column] == str(values)]
        if column in current_df.columns:
            filter_options[f"{column.lower()}_options"] = sorted(current_df[column].dropna().unique().tolist())
    return filter_options

def get_filter_params(request: Request) -> dict[str, Any]:
    params = {}
    # Parse query params or body for arrays (assuming JSON-encoded arrays in query or body)
    for config in FILTER_CONFIG:
        column = config["column"]
        value = request.query_params.get(column, None)
        if value:
            try:
                # Attempt to parse as JSON array or split comma-separated string
                if value.startswith('[') and value.endswith(']'):
                    params[column] = json.loads(value)  # Parse JSON array
                elif ',' in value:
                    params[column] = [v.strip() for v in value.split(',')]  # Split comma-separated string
                else:
                    params[column] = value  # Single value as string
            except json.JSONDecodeError:
                params[column] = value  # Fallback to string
    return params

@app.get("/get-data/")
async def get_data(filter_values: dict[str, str] = Depends(get_filter_params)):
    global datasets  # Access the global datasets dictionary where all uploaded data is stored
    try:
        # Log the filter values received from the frontend (e.g., {"Category": "Electronics"})
        print("Received filter_values:", filter_values)


        # Check if any data has been uploaded
        if not datasets:
            return {"success": False, "error": "No datasets available. Please upload files or provide a Google Sheet URL."}

        # Combine all datasets (Excel and Google Sheets) into one DataFrame
        # combined_df = pd.concat([df for df in datasets.values()], ignore_index=True)
        # print(f"Processing combined dataset with {len(combined_df)} rows")

        # # Ensure "Value" column is numeric, converting non-numeric to 0
        # if "Value" in combined_df.columns:
        #     combined_df["Value"] = pd.to_numeric(combined_df["Value"], errors="coerce").fillna(0)

        # Prepare filter columns from filter_values, ignoring None values

        month_order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        Price_trends = datasets["googlesheet1"]

        print("------------", Price_trends)
        if "Gold Price" in Price_trends.columns:
            # First, clean commas from the values
            Price_trends["Gold Price"] = Price_trends["Gold Price"].astype(str).str.replace(',', '')
            # Then convert to numeric
            Price_trends["Gold Price"] = pd.to_numeric(Price_trends["Gold Price"], errors="coerce").fillna(0)


        if "Housing Price" in Price_trends.columns:
            Price_trends["Housing Price"] = pd.to_numeric(Price_trends["Housing Price"], errors="coerce").fillna(0)
        
        if "Date" in Price_trends.columns:
            Price_trends["Date"] = pd.to_datetime(Price_trends["Date"], errors="coerce")
            # Extract year and month, handling NaN cleanly
            Price_trends["Year"] = Price_trends["Date"].dt.year.apply(lambda x: str(int(x)) if pd.notna(x) else "")
            Price_trends["Month"] = Price_trends["Date"].dt.strftime('%b').fillna("")
        print("------------Price_trends----------------", Price_trends)
    

        


        Price_trends_Clean = Price_trends[(Price_trends["Year"] != "") & (Price_trends["Year"] != "nan") & Price_trends["Gold Price"].notna()]
        print("----++++++++++++++++++------Price_trends_Clean----------------", Price_trends)

        filter_columns = {key: value for key, value in filter_values.items() if value is not None and value != "All"}

        # Apply filters
        filtered_df = get_filtered_dataframe(Price_trends_Clean, filter_columns)
        filtered_df["Month"] = pd.Categorical(filtered_df["Month"], categories=month_order, ordered=True)

        # Get filter options
        price_trends_filter_options = get_filter_options(Price_trends, filter_columns)

        # if filter_values["Year"] != "":
        #     aggregated_data = filtered_df.groupby("Month")["Gold Price"].sum().reset_index().rename(columns={"Gold Price": "value"}).to_dict(orient="records")
        #     aggregated_housing_price = (
        #         filtered_df.groupby("Month")["Housing Price"]
        #         .mean()
        #         .pct_change()
        #         .mul(100)
        #         .round(2)                
        #         .fillna(0)  # Avoid NaN in the first row
        #         .reset_index()
        #         .rename(columns={"Housing Price": "housing"})
        #         .to_dict(orient="records")
                
        #     )
        # else:
        aggregated_data = filtered_df.groupby("Year")["Gold Price"].sum().reset_index().rename(columns={"Gold Price": "value"}).to_dict(orient="records")
        aggregated_housing_price = (
            filtered_df.groupby("Year")["Housing Price"]
            .mean()
            .pct_change()
            .mul(100)
            .round(2)
            .fillna(0)  # Avoid NaN in the first row
            .reset_index()
            .rename(columns={"Housing Price": "housing"})
            .to_dict(orient="records")
        )

        
        
        price_trends = {
            "aggregated_data": aggregated_data,
            "aggregated_housing_price": aggregated_housing_price,
            "date": Price_trends["Date"],
            **price_trends_filter_options
        }

        sp500_Data = datasets.get("googlesheet2")
        stocks = datasets.get("googlesheet3")

        if sp500_Data is None or stocks is None:
            return {"success": False, "error": "S&P500 or Stock data not available."}

        # Convert all column names to lowercase for consistency
        sp500_Data.columns = sp500_Data.columns.str.lower()
        stocks.columns = stocks.columns.str.lower()

        print("sp500_Data columns:", sp500_Data.columns.tolist())
        print("stocks columns:", stocks.columns.tolist())

        # Process excelsheet2 (Market Cap data)
        if "market cap" in sp500_Data.columns:
            sp500_Data["market cap"] = pd.to_numeric(sp500_Data["market cap"], errors="coerce").fillna(0)

        if "% stock weight" in stocks.columns:
            # Clean percentage strings (e.g., '3.45%' -> 0.0345)
            stocks["% stock weight"] = stocks["% stock weight"].astype(str).str.replace('%', '').str.strip()
            stocks["% stock weight"] = pd.to_numeric(stocks["% stock weight"], errors="coerce") / 100  # Convert to decimal (e.g., 3.45 -> 0.0345)
            stocks["% stock weight"] = stocks["% stock weight"].fillna(0)  # Handle any NaN values
        
        # Join datasets on lowercase "sector" and "sym", with suffixes to avoid conflicts
        joined_df = pd.merge(sp500_Data, stocks, on=["sector", "sym"], how="inner", suffixes=('_sp500', '_stocks'))
        print("Joined DataFrame columns:", joined_df.columns.tolist())

        # Use "market cap" from excelsheet2 (sp500_Data) and "% stock weight" from excelsheet3 (stocks)
        joined_df = joined_df.rename(columns={"market cap_sp500": "market cap"})  # Rename to original lowercase
        print("Renamed Joined DataFrame columns:", joined_df.columns.tolist())

        filter_columns = {key: value for key, value in filter_values.items() if value is not None}

        filtered_joined_df = get_filtered_dataframe(joined_df, filter_columns)
        print("Filtered joined columns:", filtered_joined_df.columns.tolist())

        filter_options_sp500 = get_filter_options(joined_df, filter_columns)
        print("Filter options:", filter_options_sp500)

        # Group by sector and sum the market capitalization (from excelsheet2)
        sector_marketcap = filtered_joined_df.groupby("sector")["market cap"].sum().reset_index()

        # Calculate the total market capitalization
        total_market_cap = sector_marketcap["market cap"].sum()

        # Add a percentage column for each sector
        sector_marketcap["percentage"] = (sector_marketcap["market cap"] / total_market_cap) * 100

        # Rename 'market cap' to 'marketcap' for consistency
        sector_marketcap = sector_marketcap.round(1).rename(columns={"market cap": "marketcap"})

        # Convert to a list of dictionaries
        sp500_sector_aggregated = sector_marketcap.head(5).to_dict(orient="records")

        # Return full filtered data for excelsheet3 (unaggregated) for heatmap
        stock_data = filtered_joined_df[["sym", "% stock weight"]].to_dict(orient="records")

        sp500_data = {
            "aggregated_data": sp500_sector_aggregated,
            "stock_data": stock_data,
            **filter_options_sp500
        }


        # Return the response with calculated data
        return {
            "success": True,
            "price_trends": price_trends,
            "sp500_data" : sp500_data    
        }
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    
    
if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
