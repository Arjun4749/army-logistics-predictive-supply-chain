
import random
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

# Reproducible synthetic data
random.seed(42)

# Save CSV in the project's root data folder
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

rows = []

# Fictional units and environments, not real military locations
units = [
    {"unit_id": "SIM-UNIT-01", "personnel": 100, "environment": "Plains"},
    {"unit_id": "SIM-UNIT-02", "personnel": 150, "environment": "Hills"},
    {"unit_id": "SIM-UNIT-03", "personnel": 80, "environment": "Snow"},
]

today = date.today()

for unit in units:
    recent_consumption = []

    for day_offset in range(179, -1, -1):
        current_date = today - timedelta(days=day_offset)

        if unit["environment"] == "Plains":
            temperature = random.uniform(18, 42)
        elif unit["environment"] == "Hills":
            temperature = random.uniform(5, 28)
        else:
            temperature = random.uniform(-15, 8)

        # Illustrative food requirement per person
        base_demand = unit["personnel"] * 1.8

        # Small simulated variation in daily demand
        weather_factor = 1.0
        if temperature < 0:
            weather_factor = 1.12
        elif temperature > 35:
            weather_factor = 1.05

        actual_consumption = round(
            base_demand * weather_factor
            * random.uniform(0.90, 1.10), 2
        )

        recent_consumption.append(actual_consumption)
        recent_consumption = recent_consumption[-7:]

        avg_7day = round(
            sum(recent_consumption) / len(recent_consumption), 2
        )

        stock = round(
            actual_consumption * random.uniform(1, 8), 2
        )

        delay = random.choices(
            [0, 1, 2, 3],
            weights=[65, 20, 10, 5],
            k=1
        )[0]

        # Synthetic next-day target for model training
        next_day_demand = round(
            base_demand * weather_factor
            * random.uniform(0.90, 1.10), 2
        )

        rows.append({
            "date": current_date.isoformat(),
            "unit_id": unit["unit_id"],
            "environment": unit["environment"],
            "personnel_count": unit["personnel"],
            "food_stock_kg": stock,
            "previous_day_consumption_kg": actual_consumption,
            "avg_7day_consumption_kg": avg_7day,
            "temperature_c": round(temperature, 2),
            "delivery_delay_days": delay,
            "food_demand_next_day_kg": next_day_demand,
        })

df = pd.DataFrame(rows)

output_file = DATA_DIR / "multi_category_inventory.csv"
df.to_csv(output_file, index=False)

print("Synthetic dataset generated successfully!")
print(f"File saved at: {output_file}")
print(f"Total records: {len(df)}")
print("\nFirst 5 records:")
print(df.head())
