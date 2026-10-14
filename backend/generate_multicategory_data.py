
from pathlib import Path
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_FILE = DATA_DIR / "multi_category_inventory.csv"

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    units = [
        ("SIM-UNIT-01", "Forward Base Alpha", "Plains"),
        ("SIM-UNIT-02", "Forward Base Bravo", "Desert"),
        ("SIM-UNIT-03", "Forward Base Charlie", "Mountain"),
    ]

    items = [
        ("ITEM-001", "Rice", "Food & Rations", 800, 120, 2),
        ("ITEM-002", "Drinking Water", "Water", 1200, 180, 1),
        ("ITEM-003", "Medical Kits", "Medical", 150, 8, 3),
        ("ITEM-004", "Fuel", "Fuel", 600, 70, 4),
        ("ITEM-005", "Blankets", "Equipment", 250, 5, 5),
    ]

    records = []

    dates = pd.date_range(end=pd.Timestamp.today().normalize(), periods=14)

    for unit_id, location, environment in units:
        for item_id, item_name, category, stock, consumption, lead_time in items:
            for day_index, date in enumerate(dates):
                daily_consumption = round(
                    consumption * (1 + 0.05 * ((day_index % 3) - 1)), 2
                )
                quantity = max(
                    round(stock - consumption * day_index * 0.35, 2), 0
                )

                records.append({
                    "date": date,
                    "unit_id": unit_id,
                    "location": location,
                    "item_id": item_id,
                    "item_name": item_name,
                    "category": category,
                    "quantity": quantity,
                    "unit": "kg" if category in ("Food & Rations", "Fuel") else "units",
                    "daily_consumption": daily_consumption,
                    "lead_time_days": lead_time,
                    "data_source": "SYNTHETIC_DEMO",
                })

    pd.DataFrame(records).to_csv(OUTPUT_FILE, index=False)
    print("Synthetic multi-category catalog generated successfully!")
    print(f"File saved at: {OUTPUT_FILE}")
    print(f"Total records: {len(records)}")

if __name__ == "__main__":
    main()
