
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, root_mean_squared_error, r2_score

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = PROJECT_ROOT / "data" / "logistics_data.csv"
MODEL_FILE = Path(__file__).resolve().parent / "demand_model.joblib"

FEATURES = [
    "personnel_count",
    "avg_7day_consumption_kg",
    "temperature_c",
    "delivery_delay_days",
]

TARGET = "food_demand_next_day_kg"


def main():
    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Dataset not found: {DATA_FILE}. "
            "Run generate_data.py first."
        )

    df = pd.read_csv(DATA_FILE)
    df = df.dropna(subset=FEATURES + [TARGET])
    df = df.sort_values("date").reset_index(drop=True)

    if len(df) < 20:
        raise ValueError("Not enough records to train and evaluate.")

    # Chronological split: train on earlier dates, test on later dates
    split_index = int(len(df) * 0.8)
    train = df.iloc[:split_index]
    test = df.iloc[split_index:]

    X_train = train[FEATURES]
    y_train = train[TARGET]
    X_test = test[FEATURES]
    y_test = test[TARGET]

    model = RandomForestRegressor(
        n_estimators=150,
        max_depth=10,
        random_state=42,
        n_jobs=-1,
    )

    model.fit(X_train, y_train)

    predictions = model.predict(X_test)

    mae = mean_absolute_error(y_test, predictions)
    rmse = root_mean_squared_error(y_test, predictions)
    r2 = r2_score(y_test, predictions)

    joblib.dump(
        {"model": model, "features": FEATURES},
        MODEL_FILE,
    )

    print("Model training completed!")
    print(f"Training records: {len(train)}")
    print(f"Testing records: {len(test)}")
    print(f"MAE: {mae:.2f} kg")
    print(f"RMSE: {rmse:.2f} kg")
    print(f"R2 score: {r2:.3f}")
    print(f"Model saved to: {MODEL_FILE}")

    results = test[["date", "unit_id", TARGET]].copy()
    results["predicted_demand_kg"] = predictions.round(2)

    print("\nSample predictions:")
    print(results.head(10).to_string(index=False))


if __name__ == "__main__":
    main()
