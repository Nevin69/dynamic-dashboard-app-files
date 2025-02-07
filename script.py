import pandas as pd
import json

def process_file(file_path):
    try:
        # Read the Excel file
        df = pd.read_excel(file_path, engine="openpyxl")
        
        # Validate required columns
        if "Category" not in df.columns or "Value" not in df.columns:
            raise ValueError("The Excel file must contain 'Category' and 'Value' columns.")
        
        # Aggregate data by Category and sum the Value column
        aggregated_data = (
            df.groupby("Category")["Value"]
            .sum()
            .reset_index()
            .rename(columns={"Value": "value"})
            .to_dict(orient="records")
        )
        
        # Calculate total sales
        total_sales = df["Value"].sum()
        
        # Convert all int64/float64 values to native Python types
        def convert_to_native_types(data):
            if isinstance(data, list):
                return [convert_to_native_types(item) for item in data]
            elif isinstance(data, dict):
                return {k: convert_to_native_types(v) for k, v in data.items()}
            elif hasattr(data, 'item'):  # For NumPy types like int64, float64
                return data.item()
            else:
                return data
        
        # Prepare the result
        result = {
            "total_sales": total_sales,
            "aggregated_data": [{"name": row["Category"], "value": row["value"]} for row in aggregated_data],
        }
        
        # Convert to native Python types
        result = convert_to_native_types(result)
        
        # Return the result as JSON
        return json.dumps(result)
    
    except Exception as e:
        return json.dumps({"error": str(e)})

# Entry point for the script
if __name__ == "__main__":
    # In Pyodide, this block will not execute
    print(json.dumps({"error": "This script is intended to run in Pyodide."}))
