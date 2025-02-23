import os
import json
import pandas as pd
import shutil
import tempfile
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, Query, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Any  # Added Any for **filter_values
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from urllib.parse import urlparse
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

datasets = {}
temp_files = []

FILTER_CONFIG = [
    {"id": "category", "column": "Category", "type": "top-level"},
    {"id": "subcategory", "column": "SubCategory", "type": "dependent", "depends_on": ["category"]},
    {"id": "item", "column": "Item", "type": "dependent", "depends_on": ["category", "subcategory"]}
]

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

@app.post("/upload-files/")
async def upload_files(files: List[UploadFile] = File(...)):
    global datasets, temp_files
    try:
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.unlink(temp_file)
        temp_files = []

        for i, file in enumerate(files, 1):
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx").name
            with open(temp_file, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            df = pd.read_excel(temp_file, engine="openpyxl")
            datasets[f"excelsheet{i}"] = df
            temp_files.append(temp_file)
            print(f"Stored excelsheet{i} with {len(df)} rows")

        return {"success": True, "message": f"{len(files)} files uploaded successfully"}
    except Exception as e:
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
        range_str = f"{sheet_name}!A:Z"
        result = service.spreadsheets().values().get(spreadsheetId=sheet_id, range=range_str).execute()
        values = result.get("values", [])
        
        if not values:
            return {"success": False, "error": "No data found in the sheet"}
        
        header = values[0]
        data_rows = values[1:]
        
        if not header:
            return {"success": False, "error": "No header row found in the sheet"}
        if "Category" not in header or "Value" not in header:
            return {"success": False, "error": "Sheet header must include 'Category' and 'Value'"}
        
        df = pd.DataFrame(data_rows, columns=header)
        if "Value" in df.columns:
            df["Value"] = pd.to_numeric(df["Value"], errors="coerce").fillna(0)
        
        dataset_name = f"googlesheet{sheet_index}"
        datasets[dataset_name] = df
        
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

def get_filtered_dataframe(df: pd.DataFrame, filter_values: dict[str, str]) -> pd.DataFrame:
    """
    Filter dataframe based on provided filter values
    """
    filtered_df = df.copy()
    filters_applied = False
    
    for filter_config in FILTER_CONFIG:
        column = filter_config["column"]
        if column in filter_values and filter_values[column] and filter_values[column] != "All":
            filtered_df = filtered_df[filtered_df[column] == filter_values[column]]
            filters_applied = True
            
    return filtered_df

def get_filter_options(df: pd.DataFrame, filter_values: dict[str, str]) -> dict[str, list[str]]:
    """
    Get available options for each filter based on the current filter state
    """
    filter_options = {}
    temp_df = df.copy()
    
    for filter_config in FILTER_CONFIG:
        current_df = temp_df.copy()
        column = filter_config["column"]
        
        # For dependent filters, apply parent filters first
        if filter_config.get("depends_on"):
            for dep_id in filter_config["depends_on"]:
                dep_column = next(f["column"] for f in FILTER_CONFIG if f["id"] == dep_id)
                if (dep_column in filter_values and 
                    filter_values[dep_column] and 
                    filter_values[dep_column] != "All"):
                    current_df = current_df[current_df[dep_column] == filter_values[dep_column]]
        
        # Get unique values for this filter
        if column in current_df.columns:
            filter_options[f"{column.lower()}_options"] = sorted(current_df[column].dropna().unique().tolist())
    
    return filter_options


def get_filter_params(request: Request) -> dict[str, str]:
    # Extract query parameters based on FILTER_CONFIG
    params = {}
    for config in FILTER_CONFIG:
        column = config["column"]
        params[column] = request.query_params.get(column, None)  # Get value or None
    return params



@app.get("/get-data/")
async def get_data(filter_values: dict[str, str] = Depends(get_filter_params)):
    global datasets
    try:
        print("Received filter_values:", filter_values)
        if not datasets:
            return {
                "success": False, 
                "error": "No datasets available. Please upload files or provide a Google Sheet URL."
            }
        combined_df = pd.concat([df for df in datasets.values()], ignore_index=True)
        print(f"Processing combined dataset with {len(combined_df)} rows")

        filter_columns = {key: value for key, value in filter_values.items() if value is not None}
        filtered_df = get_filtered_dataframe(combined_df, filter_columns)
        filter_options = get_filter_options(combined_df, filter_columns)

        
        total_sales = float(filtered_df["Value"].sum()) if "Value" in filtered_df.columns else 0
        
# Safely calculate filtered googlesheet3_sum if googlesheet3 exists
        googlesheet3_sum = 0  # Default to 0 if not available
        if "googlesheet3" in datasets:
            googlesheet3_df = datasets["googlesheet3"]
            filtered_googlesheet3_df = get_filtered_dataframe(googlesheet3_df, filter_columns)
            googlesheet3_sum = float(filtered_googlesheet3_df["Value"].sum()) if "Value" in filtered_googlesheet3_df.columns else 0
            print("Filtered sum of Value for googlesheet3:", googlesheet3_sum)
        
        aggregated_data = (
            filtered_df.groupby("Category")["Value"]
            .sum()
            .reset_index()
            .rename(columns={"Value": "value"})
            .to_dict(orient="records")
        )
        return {
            "success": True,
            "total_sales": total_sales,
            "googlesheet3_sum": googlesheet3_sum,  # Add the filtered sum to the response
            "aggregated_data": aggregated_data,
            **filter_options
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    uvicorn.run("api_server:app", host="127.0.0.1", port=port, log_level="info")
