import pandas as pd
import json
import sys

def process_files(file_path1, file_path2):
    try:
        # Read both Excel files
        df1 = pd.read_excel(file_path1)
        df2 = pd.read_excel(file_path2)

        # Validate required columns
        if "Value" not in df1.columns:
            return json.dumps({"error": "Both files must contain a 'Value' column."})

        if "Category" not in df1.columns:
            return json.dumps({"error": "File 1 must contain a 'Category' column."})

        # Calculate total sales from both files
        total_sales = df1["Value"].sum() + df2["Value"].sum()

        # Aggregate data only from file 1
        aggregated_data = (
            df1.groupby("Category")["Value"]
            .sum()
            .reset_index()
            .rename(columns={"Value": "value"})
            .to_dict(orient="records")
        )

        # Convert to JSON-friendly format
        result = {
            "total_sales": float(total_sales),  # Convert to float for JSON
            "aggregated_data": [{"name": row["Category"], "value": float(row["value"])} for row in aggregated_data]
        }

        return json.dumps(result)

    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    if len(sys.argv) != 3:  # Expecting exactly 2 files
        print(json.dumps({"error": "Usage: script.py <file_path1> <file_path2>"}))
        sys.exit(1)

    file_path1, file_path2= sys.argv[1], sys.argv[2]


    print(process_files(file_path1, file_path2))
