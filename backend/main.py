from pathlib import Path

import json

import os

import threading

from datetime import datetime, timedelta, timezone



import joblib

import jwt

import pandas as pd

from dotenv import load_dotenv

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from fastapi.middleware.cors import CORSMiddleware

from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from pwdlib import PasswordHash



# ---------------------------------------------------------

# App and configuration

# ---------------------------------------------------------



BASE_DIR = Path(__file__).resolve().parent

PROJECT_ROOT = BASE_DIR.parent



# Load backend/.env explicitly, independent of the terminal's current folder.

load_dotenv(BASE_DIR / ".env")



app = FastAPI(

    title="Army Logistics Prediction System",

    description="Synthetic-data prototype for supply planning",

    version="0.2.0",

)



JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

ACCESS_TOKEN_EXPIRE_MINUTES = int(

    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")

)

DEMO_USERNAME = os.getenv("DEMO_USERNAME", "demo_admin")

DEMO_LOGIN_PASSWORD = os.getenv("DEMO_LOGIN_PASSWORD")



if not JWT_SECRET_KEY:

    raise RuntimeError("JWT_SECRET_KEY is missing from backend/.env")



if not DEMO_LOGIN_PASSWORD:

    raise RuntimeError("DEMO_LOGIN_PASSWORD is missing from backend/.env")



if ACCESS_TOKEN_EXPIRE_MINUTES <= 0:

    raise RuntimeError("ACCESS_TOKEN_EXPIRE_MINUTES must be greater than 0")



password_hash = PasswordHash.recommended()

# Hash the configured demo password once at startup.

DEMO_PASSWORD_HASH = password_hash.hash(DEMO_LOGIN_PASSWORD)



oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")



app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



DATA_FILE = PROJECT_ROOT / "data" / "logistics_data.csv"

MODEL_FILE = BASE_DIR / "demand_model.joblib"

WORKFLOW_FILE = BASE_DIR / "replenishment_workflow.json"

WORKFLOW_LOCK = threading.Lock()

CATALOG_WORKFLOW_FILE = BASE_DIR / "catalog_replenishment_workflow.json"





def read_workflow_store() -> dict:

    """Read persistent replenishment workflow state from a local JSON file."""

    if not WORKFLOW_FILE.exists():

        return {}

    try:

        with WORKFLOW_FILE.open("r", encoding="utf-8") as file:

            data = json.load(file)

        if not isinstance(data, dict):

            raise ValueError("Workflow store must contain a JSON object.")

        return data

    except (OSError, json.JSONDecodeError, ValueError) as exc:

        raise HTTPException(

            status_code=500,

            detail="Could not read replenishment workflow storage.",

        ) from exc





def write_workflow_store(data: dict) -> None:

    """Atomically persist workflow state so refreshes do not erase actions."""

    temporary_file = WORKFLOW_FILE.with_suffix(".tmp")

    try:

        with temporary_file.open("w", encoding="utf-8") as file:

            json.dump(data, file, indent=2, ensure_ascii=False)

        temporary_file.replace(WORKFLOW_FILE)

    except OSError as exc:

        raise HTTPException(

            status_code=500,

            detail="Could not save replenishment workflow state.",

        ) from exc





def authenticated_user(token: str = Depends(oauth2_scheme)) -> dict:

    """Validate a JWT for workflow-changing actions."""

    try:

        payload = jwt.decode(

            token,

            JWT_SECRET_KEY,

            algorithms=["HS256"],

        )

        username = payload.get("sub")

        role = payload.get("role")

        if not username or not role:

            raise HTTPException(

                status_code=401,

                detail="Invalid token payload",

                headers={"WWW-Authenticate": "Bearer"},

            )

        return {"username": username, "role": role}

    except jwt.InvalidTokenError as exc:

        raise HTTPException(

            status_code=401,

            detail="Invalid or expired token",

            headers={"WWW-Authenticate": "Bearer"},

        ) from exc







@app.middleware("http")
async def require_authentication_for_api_data(request: Request, call_next):
    """Allow read-only data and CORS preflight; protect write requests with JWT."""
    path = request.url.path
    method = request.method.upper()

    # CORS preflight must run without authentication.
    if method == "OPTIONS":
        return await call_next(request)

    # Health check and login remain public.
    if path in {"/api/health", "/api/auth/login"}:
        return await call_next(request)

    # Dashboard data is read-only; workflow changes remain protected.
    if method in {"GET", "HEAD"}:
        return await call_next(request)

    # Require a valid JWT for other API write requests.
    if path.startswith("/api/"):
        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")

        if scheme.lower() != "bearer" or not token.strip():
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            payload = jwt.decode(
                token.strip(),
                JWT_SECRET_KEY,
                algorithms=["HS256"],
            )
            if not payload.get("sub") or not payload.get("role"):
                raise jwt.InvalidTokenError("Missing token claims")
        except jwt.InvalidTokenError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

    return await call_next(request)



def ensure_recommendation_exists(unit_id: str) -> None:

    result = get_replenishment_recommendations()

    existing = {

        str(item.get("unit_id"))

        for item in result.get("recommendations", [])

    }

    if unit_id not in existing:

        raise HTTPException(

            status_code=404,

            detail=f"No replenishment recommendation found for unit '{unit_id}'.",

        )





def update_workflow(unit_id: str, expected_status: str, next_status: str, user: dict) -> dict:

    """Apply a legal workflow transition and save it to disk."""

    ensure_recommendation_exists(unit_id)

    now = datetime.now(timezone.utc).isoformat()

    with WORKFLOW_LOCK:

        store = read_workflow_store()

        current = store.get(unit_id, {

            "status": "PENDING",

            "created_at": now,

        })

        current_status = current.get("status", "PENDING")



        # Repeating the same action is safe and returns the current state.

        if current_status == next_status:

            return {"unit_id": unit_id, **current}



        if current_status != expected_status:

            raise HTTPException(

                status_code=409,

                detail=(

                    f"Cannot change status from {current_status} to {next_status}. "

                    f"Expected current status: {expected_status}."

                ),

            )



        current["status"] = next_status

        current["updated_at"] = now

        if next_status == "REVIEWED":

            current["reviewed_by"] = user["username"]

            current["reviewed_at"] = now

        elif next_status == "APPROVED":

            current["approved_by"] = user["username"]

            current["approved_at"] = now

        elif next_status == "DISPATCHED":

            current["dispatched_by"] = user["username"]

            current["dispatched_at"] = now



        store[unit_id] = current

        write_workflow_store(store)

        return {"unit_id": unit_id, **current}





# ---------------------------------------------------------

# Data helpers

# ---------------------------------------------------------



def load_data() -> pd.DataFrame:

    if not DATA_FILE.exists():

        raise HTTPException(

            status_code=500,

            detail=f"Dataset not found at {DATA_FILE}. Generate the CSV first.",

        )



    try:

        df = pd.read_csv(DATA_FILE)

    except (OSError, ValueError, pd.errors.ParserError) as exc:

        raise HTTPException(

            status_code=500,

            detail=f"Could not read dataset: {exc}",

        ) from exc



    required = {

        "date",

        "unit_id",

        "personnel_count",

        "food_stock_kg",

        "avg_7day_consumption_kg",

        "temperature_c",

        "delivery_delay_days",

    }



    missing = sorted(required - set(df.columns))

    if missing:

        raise HTTPException(

            status_code=500,

            detail=f"Dataset is missing required columns: {missing}",

        )



    return df





def latest_inventory() -> pd.DataFrame:

    df = load_data()

    df["date"] = pd.to_datetime(df["date"], errors="coerce")

    df = df.dropna(subset=["date"])



    if df.empty:

        raise HTTPException(

            status_code=500,

            detail="Dataset contains no valid dates.",

        )



    latest = (

        df.sort_values("date")

        .groupby("unit_id", as_index=False)

        .tail(1)

        .copy()

    )



    consumption = pd.to_numeric(

        latest["avg_7day_consumption_kg"], errors="coerce"

    ).clip(lower=0.01)



    stock = pd.to_numeric(latest["food_stock_kg"], errors="coerce")

    latest["days_remaining"] = (stock / consumption).round(2)

    latest = latest.dropna(subset=["days_remaining"])



    return latest





# ---------------------------------------------------------

# Basic endpoints

# ---------------------------------------------------------



@app.get("/")

def home():

    return {

        "success": True,

        "message": "Army Logistics Prototype API is running",

    }





@app.get("/api/health")

def health_check():

    return {

        "success": True,

        "status": "healthy",

    }





# ---------------------------------------------------------

# Inventory and alerts

# ---------------------------------------------------------



@app.get("/api/inventory")

def get_inventory():

    latest = latest_inventory()



    records = latest[

        [

            "unit_id",

            "personnel_count",

            "food_stock_kg",

            "avg_7day_consumption_kg",

            "days_remaining",

        ]

    ].to_dict(orient="records")



    return {

        "success": True,

        "count": len(records),

        "inventory": records,

    }





# ---------------------------------------------------------

# Multi-category inventory catalog (synthetic demo dataset)

# ---------------------------------------------------------



CATALOG_FILE = PROJECT_ROOT / "data" / "multi_category_inventory.csv"





def load_catalog() -> pd.DataFrame:

    if not CATALOG_FILE.exists():

        raise HTTPException(

            status_code=503,

            detail=f"Multi-category catalog not found at {CATALOG_FILE}. Run generate_multicategory_data.py first.",

        )

    try:

        frame = pd.read_csv(CATALOG_FILE)

    except (OSError, ValueError, pd.errors.ParserError) as exc:

        raise HTTPException(

            status_code=500,

            detail="Could not read multi-category inventory catalog.",

        ) from exc



    required = {

        "date", "unit_id", "location", "item_id", "item_name", "category",

        "quantity", "unit", "daily_consumption", "lead_time_days", "data_source",

    }

    missing = sorted(required - set(frame.columns))

    if missing:

        raise HTTPException(

            status_code=500,

            detail=f"Multi-category catalog is missing columns: {missing}",

        )

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")

    frame = frame.dropna(subset=["date"])

    if frame.empty:

        raise HTTPException(status_code=500, detail="Multi-category catalog has no valid dated records.")

    return frame





@app.get("/api/inventory/catalog")

def get_inventory_catalog(category: str | None = None, unit_id: str | None = None):

    frame = load_catalog()

    if category:

        frame = frame[frame["category"].str.casefold() == category.casefold()]

    if unit_id:

        frame = frame[frame["unit_id"].astype(str).str.casefold() == unit_id.casefold()]



    latest = (

        frame.sort_values("date")

        .groupby(["unit_id", "item_id"], as_index=False)

        .tail(1)

        .copy()

    )

    latest["quantity"] = pd.to_numeric(latest["quantity"], errors="coerce").fillna(0).clip(lower=0)

    latest["daily_consumption"] = pd.to_numeric(latest["daily_consumption"], errors="coerce").fillna(0).clip(lower=0)

    latest["days_remaining"] = latest.apply(

        lambda row: round(float(row["quantity"]) / float(row["daily_consumption"]), 2)

        if float(row["daily_consumption"]) > 0 else None,

        axis=1,

    )

    latest["risk_level"] = latest["days_remaining"].apply(

        lambda days: "UNKNOWN" if pd.isna(days) else "CRITICAL" if days <= 2

        else "WARNING" if days <= 5 else "NORMAL"

    )

    latest["date"] = latest["date"].dt.strftime("%Y-%m-%d")

    latest = latest.sort_values(["category", "item_name", "unit_id"])

    record_columns = [

        "date", "unit_id", "location", "item_id", "item_name", "category",

        "quantity", "unit", "daily_consumption", "days_remaining", "risk_level",

        "lead_time_days", "expiry_date", "delivery_delay_days", "data_source",

    ]

    # pandas to_json converts NaN/NaT values to JSON null, which FastAPI can serialize.

    records = json.loads(latest[record_columns].to_json(orient="records"))

    return {

        "success": True,

        "data_source": "SYNTHETIC_DEMO",

        "count": len(records),

        "categories": sorted(latest["category"].dropna().unique().tolist()),

        "inventory": records,

    }





@app.get("/api/analytics/categories")

def get_category_analytics():

    frame = load_catalog()

    latest = (

        frame.sort_values("date")

        .groupby(["unit_id", "item_id"], as_index=False)

        .tail(1)

        .copy()

    )

    latest["quantity"] = pd.to_numeric(latest["quantity"], errors="coerce").fillna(0).clip(lower=0)

    latest["daily_consumption"] = pd.to_numeric(latest["daily_consumption"], errors="coerce").fillna(0).clip(lower=0)

    latest["days_remaining"] = latest.apply(

        lambda row: float(row["quantity"]) / float(row["daily_consumption"])

        if float(row["daily_consumption"]) > 0 else None,

        axis=1,

    )

    grouped = latest.groupby("category", as_index=False).agg(

        item_records=("item_id", "count"),

        total_quantity=("quantity", "sum"),

        average_daily_consumption=("daily_consumption", "mean"),

    )

    risk_counts = latest.assign(

        risk=latest["days_remaining"].apply(

            lambda days: "UNKNOWN" if pd.isna(days) else "CRITICAL" if days <= 2

            else "WARNING" if days <= 5 else "NORMAL"

        )

    ).groupby(["category", "risk"]).size().unstack(fill_value=0)

    result = []

    for _, row in grouped.iterrows():

        category = row["category"]

        risks = risk_counts.loc[category].to_dict() if category in risk_counts.index else {}

        result.append({

            "category": category,

            "item_records": int(row["item_records"]),

            "total_quantity": round(float(row["total_quantity"]), 2),

            "average_daily_consumption": round(float(row["average_daily_consumption"]), 2),

            "critical_records": int(risks.get("CRITICAL", 0)),

            "warning_records": int(risks.get("WARNING", 0)),

            "normal_records": int(risks.get("NORMAL", 0)),

            "unknown_records": int(risks.get("UNKNOWN", 0)),

        })

    return {

        "success": True,

        "data_source": "SYNTHETIC_DEMO",

        "category_count": len(result),

        "categories": result,

    }







@app.get("/api/shortage-alerts")

def get_shortage_alerts():

    latest = latest_inventory()

    alerts = []



    for _, row in latest.iterrows():

        days = float(row["days_remaining"])



        if days <= 2:

            level = "CRITICAL"

        elif days <= 4:

            level = "WARNING"

        else:

            continue



        alerts.append(

            {

                "unit_id": row["unit_id"],

                "stock_kg": round(float(row["food_stock_kg"]), 2),

                "daily_consumption_kg": round(

                    float(row["avg_7day_consumption_kg"]), 2

                ),

                "days_remaining": days,

                "risk_level": level,

                "message": f"Simulated stock may last {days} days.",

            }

        )



    return {

        "success": True,

        "alert_count": len(alerts),

        "alerts": alerts,

    }







# ---------------------------------------------------------

# Multi-category demand forecasts and historical trends

# ---------------------------------------------------------



def _generate_90_day_synthetic_history(frame: pd.DataFrame) -> pd.DataFrame:
    """Build a deterministic 90-calendar-day synthetic series from each latest catalog snapshot.

    This is generated demo history, not recovered real history. The final day's quantity
    matches the current catalog snapshot; prior stock levels are reconstructed backwards
    from simulated consumption and replenishment events.
    """
    if frame.empty:
        return frame.copy()

    source = frame.copy()
    source["date"] = pd.to_datetime(source["date"], errors="coerce")
    source = source.dropna(subset=["date"])
    if source.empty:
        return source

    latest_rows = source.sort_values("date").groupby(["unit_id", "item_id"], as_index=False).tail(1)
    end_date = pd.Timestamp(datetime.now(timezone.utc).date())
    dates = pd.date_range(end=end_date, periods=90, freq="D")
    records = []

    for _, base in latest_rows.iterrows():
        item_id = str(base.get("item_id", "ITEM"))
        unit_id = str(base.get("unit_id", "SIM-UNIT"))
        seed = sum((idx + 1) * ord(char) for idx, char in enumerate(f"{unit_id}:{item_id}"))
        stock_end = max(0.0, float(pd.to_numeric(pd.Series([base.get("quantity", 0)]), errors="coerce").fillna(0).iloc[0]))
        base_demand = max(0.0, float(pd.to_numeric(pd.Series([base.get("daily_consumption", 0)]), errors="coerce").fillna(0).iloc[0]))
        lead_time = max(0, int(pd.to_numeric(pd.Series([base.get("lead_time_days", 0)]), errors="coerce").fillna(0).iloc[0]))
        base_delay = max(0, int(pd.to_numeric(pd.Series([base.get("delivery_delay_days", 0)]), errors="coerce").fillna(0).iloc[0]))

        demands = []
        receipts = []
        for i, day in enumerate(dates):
            # Repeatable mild weekly seasonality and item-specific variation.
            wave = 1.0 + 0.12 * __import__("math").sin((i + seed % 11) * 2 * __import__("math").pi / 7)
            variation = 0.88 + ((seed + i * 17) % 25) / 100.0
            demand = round(base_demand * wave * variation, 2)
            receipt = 0.0
            # Simulated replenishment every 14-20 days; deterministic per item.
            interval = 14 + (seed % 7)
            if i > 0 and (i + seed % interval) % interval == 0:
                receipt = round(max(base_demand * 5, stock_end * 0.22, 1.0), 2)
            demands.append(demand)
            receipts.append(receipt)

        # Reverse-reconstruct prior balances so the latest date agrees with current stock.
        stocks = [0.0] * len(dates)
        stocks[-1] = round(stock_end, 2)
        for i in range(len(dates) - 1, 0, -1):
            stocks[i - 1] = round(max(0.0, stocks[i] + demands[i] - receipts[i]), 2)

        for i, day in enumerate(dates):
            row = base.to_dict()
            row.update({
                "date": day,
                "quantity": stocks[i],
                "daily_consumption": demands[i],
                "lead_time_days": lead_time,
                "delivery_delay_days": base_delay if i == len(dates) - 1 else int((seed + i) % 3),
                "data_source": "SYNTHETIC_DEMO",
                "history_generated": True,
                "simulated_receipt_quantity": receipts[i],
                "simulated_shortage": bool(demands[i] > 0 and stocks[i] <= 0),
            })
            records.append(row)

    history = pd.DataFrame(records)
    history["date"] = pd.to_datetime(history["date"], errors="coerce")
    return history.sort_values(["date", "unit_id", "item_id"]).reset_index(drop=True)


def _filtered_catalog(category: str | None = None, unit_id: str | None = None, item_id: str | None = None) -> pd.DataFrame:
    # All analytics use the same deterministic 90-day synthetic time series.
    frame = _generate_90_day_synthetic_history(load_catalog())

    if category:
        frame = frame[frame["category"].astype(str).str.casefold() == category.casefold()]
    if unit_id:
        frame = frame[frame["unit_id"].astype(str).str.casefold() == unit_id.casefold()]
    if item_id:
        frame = frame[frame["item_id"].astype(str).str.casefold() == item_id.casefold()]

    frame["daily_consumption"] = pd.to_numeric(frame["daily_consumption"], errors="coerce")
    frame["quantity"] = pd.to_numeric(frame["quantity"], errors="coerce")
    frame = frame.dropna(subset=["date", "daily_consumption", "quantity"]).sort_values("date")
    return frame


@app.get("/api/history/catalog")
def get_catalog_history(
    category: str | None = None,
    unit_id: str | None = None,
    item_id: str | None = None,
    days: int = 90,
):
    """Return dated synthetic inventory, demand, receipt, and shortage history."""
    if days < 1 or days > 90:
        raise HTTPException(status_code=422, detail="days must be between 1 and 90.")
    frame = _filtered_catalog(category=category, unit_id=unit_id, item_id=item_id)
    if frame.empty:
        return {"success": True, "data_source": "SYNTHETIC_DEMO", "history_days": days, "count": 0, "records": []}
    cutoff = frame["date"].max() - pd.Timedelta(days=days - 1)
    frame = frame[frame["date"] >= cutoff].copy()
    frame["days_remaining"] = frame.apply(
        lambda row: round(float(row["quantity"]) / float(row["daily_consumption"]), 2)
        if float(row["daily_consumption"]) > 0 else None, axis=1
    )
    columns = ["date", "unit_id", "location", "item_id", "item_name", "category", "quantity", "unit",
               "daily_consumption", "simulated_receipt_quantity", "simulated_shortage", "days_remaining",
               "lead_time_days", "delivery_delay_days", "data_source", "history_generated"]
    records = json.loads(frame[columns].assign(date=frame["date"].dt.strftime("%Y-%m-%d")).to_json(orient="records"))
    return {"success": True, "data_source": "SYNTHETIC_DEMO", "history_days": days,
            "item_unit_series": int(frame.groupby(["unit_id", "item_id"]).ngroups),
            "count": len(records), "records": records,
            "notice": "All historical values are deterministic synthetic demo data, not actual Army logistics records."}


@app.get("/api/history/deliveries")
def get_synthetic_delivery_history(days: int = 90, unit_id: str | None = None):
    if days < 1 or days > 90:
        raise HTTPException(status_code=422, detail="days must be between 1 and 90.")
    frame = _filtered_catalog(unit_id=unit_id)
    if frame.empty:
        return {"success": True, "data_source": "SYNTHETIC_DEMO", "count": 0, "deliveries": []}
    cutoff = frame["date"].max() - pd.Timedelta(days=days - 1)
    frame = frame[(frame["date"] >= cutoff) & (frame["simulated_receipt_quantity"] > 0)]
    deliveries = []
    for idx, (_, row) in enumerate(frame.iterrows(), start=1):
        deliveries.append({"delivery_id": f"SIM-DEL-{idx:05d}", "date": row["date"].strftime("%Y-%m-%d"),
                          "unit_id": str(row["unit_id"]), "item_id": str(row["item_id"]),
                          "item_name": str(row["item_name"]), "quantity": float(row["simulated_receipt_quantity"]),
                          "unit": str(row["unit"]), "status": "RECEIVED" if idx % 4 else "DELAYED",
                          "data_source": "SYNTHETIC_DEMO"})
    return {"success": True, "data_source": "SYNTHETIC_DEMO", "count": len(deliveries), "deliveries": deliveries}


@app.get("/api/history/shortages")
def get_synthetic_shortage_history(days: int = 90, category: str | None = None, unit_id: str | None = None):
    if days < 1 or days > 90:
        raise HTTPException(status_code=422, detail="days must be between 1 and 90.")
    frame = _filtered_catalog(category=category, unit_id=unit_id)
    if frame.empty:
        return {"success": True, "data_source": "SYNTHETIC_DEMO", "count": 0, "shortages": []}
    cutoff = frame["date"].max() - pd.Timedelta(days=days - 1)
    frame = frame[(frame["date"] >= cutoff) & (frame["simulated_shortage"] == True)]
    shortages = [{"date": row["date"].strftime("%Y-%m-%d"), "unit_id": str(row["unit_id"]),
                  "item_id": str(row["item_id"]), "item_name": str(row["item_name"]),
                  "category": str(row["category"]), "stock": float(row["quantity"]),
                  "daily_demand": float(row["daily_consumption"]), "risk_level": "CRITICAL",
                  "data_source": "SYNTHETIC_DEMO"} for _, row in frame.iterrows()]
    return {"success": True, "data_source": "SYNTHETIC_DEMO", "count": len(shortages), "shortages": shortages}





@app.get("/api/shortage-risks/catalog")

def get_catalog_shortage_risks(category: str | None = None, unit_id: str | None = None):

    """Category-aware stockout risk based on recent consumption and replenishment lead time.



    This is a transparent rule-based demo estimate, not an operational military forecast.

    """

    frame = _filtered_catalog(category=category, unit_id=unit_id)

    if frame.empty:

        return {

            "success": True,

            "data_source": "SYNTHETIC_DEMO",

            "method": "7-day trailing mean + lead-time rule",

            "count": 0,

            "alerts": [],

            "summary": {"critical": 0, "warning": 0, "normal": 0, "unknown": 0},

        }



    alerts = []

    for (unit, item), series in frame.groupby(["unit_id", "item_id"], sort=True):

        series = series.sort_values("date")

        latest = series.iloc[-1]

        recent = series.tail(7)

        stock = max(0.0, float(latest["quantity"]))

        daily_demand = max(0.0, float(recent["daily_consumption"].mean()))



        lead_values = pd.to_numeric(series.get("lead_time_days", pd.Series(dtype=float)), errors="coerce").dropna()

        delay_values = pd.to_numeric(series.get("delivery_delay_days", pd.Series(dtype=float)), errors="coerce").dropna()

        lead_time = max(0, int(lead_values.iloc[-1])) if not lead_values.empty else 0

        delay_days = max(0, int(delay_values.iloc[-1])) if not delay_values.empty else 0

        effective_lead = lead_time + delay_days

        days_cover = stock / daily_demand if daily_demand > 0 else None



        if days_cover is None:

            risk = "UNKNOWN"

            message = "Consumption is zero or unavailable; review the item manually."

            stockout_date = None

        else:

            if days_cover <= effective_lead:

                risk = "CRITICAL"

                message = f"Estimated stock coverage ({days_cover:.1f} days) does not cover replenishment lead time ({effective_lead} days)."

            elif days_cover <= effective_lead + 3:

                risk = "WARNING"

                message = f"Estimated stock coverage ({days_cover:.1f} days) is close to replenishment lead time ({effective_lead} days)."

            else:

                risk = "NORMAL"

                message = f"Estimated stock coverage is {days_cover:.1f} days; lead time including delay is {effective_lead} days."

            stockout_date = (latest["date"] + pd.Timedelta(days=days_cover)).strftime("%Y-%m-%d")



        alerts.append({

            "unit_id": str(unit),

            "location": str(latest.get("location", "Unknown")),

            "item_id": str(item),

            "item_name": str(latest.get("item_name", item)),

            "category": str(latest.get("category", "Uncategorized")),

            "current_stock": round(stock, 2),

            "unit": str(latest.get("unit", "units")),

            "estimated_daily_demand": round(daily_demand, 2),

            "days_remaining": round(days_cover, 2) if days_cover is not None else None,

            "estimated_stockout_date": stockout_date,

            "lead_time_days": lead_time,

            "delivery_delay_days": delay_days,

            "effective_lead_time_days": effective_lead,

            "risk_level": risk,

            "message": message,

            "method": "7-day trailing mean + lead-time rule",

            "data_source": "SYNTHETIC_DEMO",

        })



    priority = {"CRITICAL": 0, "WARNING": 1, "UNKNOWN": 2, "NORMAL": 3}

    alerts.sort(key=lambda row: (priority.get(row["risk_level"], 4), row["category"], row["item_name"], row["unit_id"]))

    summary = {

        "critical": sum(row["risk_level"] == "CRITICAL" for row in alerts),

        "warning": sum(row["risk_level"] == "WARNING" for row in alerts),

        "normal": sum(row["risk_level"] == "NORMAL" for row in alerts),

        "unknown": sum(row["risk_level"] == "UNKNOWN" for row in alerts),

    }

    return {

        "success": True,

        "data_source": "SYNTHETIC_DEMO",

        "method": "7-day trailing mean + lead-time rule",

        "count": len(alerts),

        "summary": summary,

        "alerts": alerts,

    }





@app.get("/api/forecast/catalog")

def get_catalog_forecasts(category: str | None = None, unit_id: str | None = None, horizon_days: int = 7):

    """Estimate demand from the previous 7 days for each item/unit time series."""

    if horizon_days < 1 or horizon_days > 30:

        raise HTTPException(status_code=422, detail="horizon_days must be between 1 and 30.")

    frame = _filtered_catalog(category=category, unit_id=unit_id)

    if frame.empty:

        return {"success": True, "data_source": "SYNTHETIC_DEMO", "method": "7-day trailing mean baseline", "horizon_days": horizon_days, "count": 0, "forecasts": []}



    rows = []

    for (unit, item), series in frame.groupby(["unit_id", "item_id"], sort=True):

        series = series.sort_values("date")

        latest = series.iloc[-1]

        recent = series.tail(7)

        baseline = max(0.0, float(recent["daily_consumption"].mean()))

        current_stock = max(0.0, float(latest["quantity"]))

        coverage = current_stock / baseline if baseline > 0 else None

        lead_time = max(0, int(pd.to_numeric(series["lead_time_days"], errors="coerce").dropna().iloc[-1])) if "lead_time_days" in series and pd.to_numeric(series["lead_time_days"], errors="coerce").notna().any() else 0

        delay = max(0, int(pd.to_numeric(series["delivery_delay_days"], errors="coerce").dropna().iloc[-1])) if "delivery_delay_days" in series and pd.to_numeric(series["delivery_delay_days"], errors="coerce").notna().any() else 0

        coverage_days = coverage

        risk = "UNKNOWN" if coverage_days is None else "CRITICAL" if coverage_days <= lead_time + delay else "WARNING" if coverage_days <= lead_time + delay + 3 else "NORMAL"

        rows.append({

            "date": latest["date"].strftime("%Y-%m-%d"), "unit_id": str(unit), "location": str(latest["location"]),

            "item_id": str(item), "item_name": str(latest["item_name"]), "category": str(latest["category"]),

            "unit": str(latest["unit"]), "current_stock": round(current_stock, 2),

            "estimated_daily_demand": round(baseline, 2), "horizon_days": horizon_days,

            "estimated_horizon_demand": round(baseline * horizon_days, 2),

            "estimated_stock_after_horizon": round(current_stock - baseline * horizon_days, 2),

            "days_of_cover": round(coverage, 2) if coverage is not None else None,

            "lead_time_days": lead_time, "delivery_delay_days": delay, "risk_level": risk,

            "method": "7-day trailing mean baseline", "data_source": "SYNTHETIC_DEMO",

        })

    rows.sort(key=lambda row: (0 if row["risk_level"] == "CRITICAL" else 1 if row["risk_level"] == "WARNING" else 2, row["category"], row["item_name"], row["unit_id"]))



    # Time-ordered holdout evaluation: each of the final 14 days is predicted

    # using only the 7 observations before it. This is a baseline check, not a

    # claim of production model accuracy.

    evaluation = {"holdout_days": 0, "mae": None, "wape_percent": None, "method": "7-day trailing mean baseline", "note": "Time-ordered holdout on synthetic demo consumption; not a production accuracy claim."}

    actual_values, absolute_errors = [], []

    for _, series in frame.groupby(["unit_id", "item_id"]):

        vals = series.sort_values("date")["daily_consumption"].astype(float).tolist()

        start = max(7, len(vals) - 14)

        for idx in range(start, len(vals)):

            predicted = sum(vals[idx-7:idx]) / 7

            actual_values.append(vals[idx])

            absolute_errors.append(abs(vals[idx] - predicted))

    if absolute_errors:

        total_actual = sum(abs(value) for value in actual_values)

        evaluation["holdout_days"] = len(absolute_errors)

        evaluation["mae"] = round(sum(absolute_errors) / len(absolute_errors), 3)

        evaluation["wape_percent"] = round(sum(absolute_errors) / total_actual * 100, 2) if total_actual else None

    return {"success": True, "data_source": "SYNTHETIC_DEMO", "method": "7-day trailing mean baseline", "horizon_days": horizon_days, "count": len(rows), "evaluation": evaluation, "forecasts": rows}





@app.get("/api/analytics/trends")

def get_catalog_trends(category: str = "Food & Rations", item_id: str | None = None, unit_id: str | None = None, days: int = 30):

    """Return one item time-series so plotted values never mix incompatible units."""

    if days < 7 or days > 120:

        raise HTTPException(status_code=422, detail="days must be between 7 and 120.")

    frame = _filtered_catalog(category=category, unit_id=unit_id, item_id=item_id)

    if frame.empty:

        return {"success": True, "data_source": "SYNTHETIC_DEMO", "category": category, "item": None, "points": []}

    if item_id is None:

        chosen = (frame.groupby(["item_id", "item_name"])["daily_consumption"].mean().sort_values(ascending=False))

        selected_id = str(chosen.index[0][0])

        frame = frame[frame["item_id"].astype(str) == selected_id]

    latest_date = frame["date"].max()

    frame = frame[frame["date"] >= latest_date - pd.Timedelta(days=days-1)]

    grouped = frame.groupby("date", as_index=False).agg(average_daily_consumption=("daily_consumption", "mean"), average_stock=("quantity", "mean"))

    grouped = grouped.sort_values("date")

    first = frame.iloc[-1]

    points = [{"date": row["date"].strftime("%Y-%m-%d"), "average_daily_consumption": round(float(row["average_daily_consumption"]), 2), "average_stock": round(float(row["average_stock"]), 2)} for _, row in grouped.iterrows()]

    return {"success": True, "data_source": "SYNTHETIC_DEMO", "category": str(first["category"]), "item_id": str(first["item_id"]), "item_name": str(first["item_name"]), "unit": str(first["unit"]), "unit_id": unit_id, "days_requested": days, "count": len(points), "points": points}



# ---------------------------------------------------------

# Demand forecast

# ---------------------------------------------------------



@app.get("/api/forecast")

def get_forecast():

    if not MODEL_FILE.exists():

        raise HTTPException(

            status_code=503,

            detail=f"Model file not found at {MODEL_FILE}.",

        )



    latest = latest_inventory()



    try:

        saved_model = joblib.load(MODEL_FILE)

        model = saved_model["model"]

        features = saved_model["features"]

    except (OSError, ValueError, KeyError, TypeError) as exc:

        raise HTTPException(

            status_code=500,

            detail=f"Could not load demand model: {exc}",

        ) from exc



    missing = [col for col in features if col not in latest.columns]

    if missing:

        raise HTTPException(

            status_code=500,

            detail=f"Missing model features in latest inventory data: {missing}",

        )



    try:

        predictions = model.predict(latest[features])

    except Exception as exc:

        raise HTTPException(

            status_code=500,

            detail=f"Demand prediction failed: {exc}",

        ) from exc



    forecasts = []

    for (_, row), prediction in zip(latest.iterrows(), predictions):

        forecasts.append(

            {

                "unit_id": str(row["unit_id"]),

                "forecast_demand_kg": round(float(prediction), 2),

                "method": "Random Forest ML model",

            }

        )



    return {

        "success": True,

        "forecast_type": "machine_learning",

        "forecasts": forecasts,

    }





# ---------------------------------------------------------

# Replenishment recommendations

# ---------------------------------------------------------



@app.get("/api/replenishment")

def get_replenishment_recommendations():

    df = load_data()



    required_columns = [

        "date",

        "unit_id",

        "food_stock_kg",

        "avg_7day_consumption_kg",

    ]

    missing = [col for col in required_columns if col not in df.columns]

    if missing:

        raise HTTPException(

            status_code=500,

            detail=f"Missing dataset columns: {missing}",

        )



    df["date"] = pd.to_datetime(df["date"], errors="coerce")

    df = df.dropna(subset=["date"])

    latest = (

        df.sort_values("date")

        .groupby("unit_id")

        .tail(1)

        .copy()

    )



    recommendations = []



    for _, row in latest.iterrows():

        stock = float(row["food_stock_kg"])

        daily_use = float(row["avg_7day_consumption_kg"])



        if daily_use <= 0:

            continue



        days_remaining = stock / daily_use

        # Illustrative demo policy: target 7 days of stock.

        target_stock = daily_use * 7

        recommended_qty = max(0, target_stock - stock)



        if days_remaining < 3:

            priority = "HIGH"

        elif days_remaining < 5:

            priority = "MEDIUM"

        else:

            priority = "LOW"



        recommendations.append(

            {

                "unit_id": row["unit_id"],

                "current_stock_kg": round(stock, 2),

                "daily_consumption_kg": round(daily_use, 2),

                "days_remaining": round(days_remaining, 2),

                "recommended_replenishment_kg": round(recommended_qty, 2),

                "priority": priority,

                "reason": (

                    f"Stock covers {days_remaining:.1f} days; "

                    "demo target is 7 days of consumption."

                ),

            }

        )



    recommendations.sort(key=lambda item: item["days_remaining"])



    workflow_store = read_workflow_store()

    for item in recommendations:

        state = workflow_store.get(str(item["unit_id"]), {})

        item["workflow_status"] = state.get("status", "PENDING")

        item["workflow_updated_at"] = state.get("updated_at")

        item["reviewed_by"] = state.get("reviewed_by")

        item["approved_by"] = state.get("approved_by")

        item["dispatched_by"] = state.get("dispatched_by")

        item["reviewed_at"] = state.get("reviewed_at")

        item["approved_at"] = state.get("approved_at")

        item["dispatched_at"] = state.get("dispatched_at")



    return {

        "success": True,

        "policy": "Illustrative 7-day stock target for synthetic demo data",

        "count": len(recommendations),

        "recommendations": recommendations,

    }





@app.post("/api/replenishment/{unit_id}/review")

def review_replenishment(unit_id: str, user: dict = Depends(authenticated_user)):

    state = update_workflow(unit_id, "PENDING", "REVIEWED", user)

    return {"success": True, "message": "Recommendation marked as reviewed.", "workflow": state}





@app.post("/api/replenishment/{unit_id}/approve")

def approve_replenishment(unit_id: str, user: dict = Depends(authenticated_user)):

    if user.get("role") != "admin":

        raise HTTPException(status_code=403, detail="Admin role is required to approve.")

    state = update_workflow(unit_id, "REVIEWED", "APPROVED", user)

    return {"success": True, "message": "Replenishment approved.", "workflow": state}





@app.post("/api/replenishment/{unit_id}/dispatch")

def dispatch_replenishment(unit_id: str, user: dict = Depends(authenticated_user)):

    if user.get("role") != "admin":

        raise HTTPException(status_code=403, detail="Admin role is required to dispatch.")

    state = update_workflow(unit_id, "APPROVED", "DISPATCHED", user)

    return {"success": True, "message": "Replenishment marked as dispatched.", "workflow": state}





# ---------------------------------------------------------

# Illustrative weather and delivery endpoints

# ---------------------------------------------------------



@app.get("/api/weather-impact")

def get_weather_impact():

    # Illustrative scenarios for synthetic demo data only.

    scenarios = [

        {

            "unit_id": "SIM-UNIT-01",

            "weather_condition": "Heavy Snow",

            "temperature_c": -8,

            "impact_level": "HIGH",

            "estimated_delay_days": 3,

            "recommendation": (

                "Review buffer stock and consider an alternative "

                "delivery window in this simulated scenario."

            ),

        },

        {

            "unit_id": "SIM-UNIT-02",

            "weather_condition": "Cloudy",

            "temperature_c": 18,

            "impact_level": "LOW",

            "estimated_delay_days": 0,

            "recommendation": (

                "Continue routine monitoring in this simulated scenario."

            ),

        },

        {

            "unit_id": "SIM-UNIT-03",

            "weather_condition": "Heavy Rain",

            "temperature_c": 12,

            "impact_level": "MEDIUM",

            "estimated_delay_days": 1,

            "recommendation": (

                "Review possible delivery delays and stock coverage."

            ),

        },

    ]



    return {

        "success": True,

        "demo_mode": True,

        "message": (

            "Illustrative weather scenarios only; "

            "not a real forecast or operational assessment."

        ),

        "count": len(scenarios),

        "weather_impacts": scenarios,

    }





@app.get("/api/delivery-status")

def get_delivery_status():

    # Fictional delivery records for prototype demonstration.

    deliveries = [

        {

            "delivery_id": "DEMO-DEL-001",

            "unit_id": "SIM-UNIT-01",

            "item": "Food Supplies",

            "status": "DELAYED",

            "estimated_delay_days": 2,

            "priority": "HIGH",

            "message": "Simulated delay; review stock coverage.",

        },

        {

            "delivery_id": "DEMO-DEL-002",

            "unit_id": "SIM-UNIT-02",

            "item": "Food Supplies",

            "status": "IN_TRANSIT",

            "estimated_delay_days": 0,

            "priority": "MEDIUM",

            "message": "Simulated delivery is in transit.",

        },

        {

            "delivery_id": "DEMO-DEL-003",

            "unit_id": "SIM-UNIT-03",

            "item": "Food Supplies",

            "status": "DELIVERED",

            "estimated_delay_days": 0,

            "priority": "LOW",

            "message": "Simulated delivery completed.",

        },

    ]



    return {

        "success": True,

        "demo_mode": True,

        "count": len(deliveries),

        "deliveries": deliveries,

    }





# ---------------------------------------------------------

# Authentication

# ---------------------------------------------------------



@app.post("/api/auth/login")

def login(form_data: OAuth2PasswordRequestForm = Depends()):

    # OAuth2PasswordRequestForm expects form fields named username/password.

    if form_data.username != DEMO_USERNAME:

        raise HTTPException(

            status_code=401,

            detail="Invalid username or password",

            headers={"WWW-Authenticate": "Bearer"},

        )



    try:

        password_is_valid = password_hash.verify(

            form_data.password,

            DEMO_PASSWORD_HASH,

        )

    except Exception as exc:

        # Do not return secrets or password data to the client.

        raise HTTPException(

            status_code=500,

            detail="Password verification failed. Check backend logs.",

        ) from exc



    if not password_is_valid:

        raise HTTPException(

            status_code=401,

            detail="Invalid username or password",

            headers={"WWW-Authenticate": "Bearer"},

        )



    expires_at = datetime.now(timezone.utc) + timedelta(

        minutes=ACCESS_TOKEN_EXPIRE_MINUTES

    )



    token = jwt.encode(

        {

            "sub": DEMO_USERNAME,

            "role": "admin",

            "exp": expires_at,

        },

        JWT_SECRET_KEY,

        algorithm="HS256",

    )



    return {

        "access_token": token,

        "token_type": "bearer",

        "expires_in_minutes": ACCESS_TOKEN_EXPIRE_MINUTES,

    }





@app.get("/api/auth/me")

def get_current_user(user: dict = Depends(authenticated_user)):

    return {

        "authenticated": True,

        "username": user["username"],

        "role": user["role"],

    }





# ---------------------------------------------------------

# Category-aware smart replenishment recommendations

# ---------------------------------------------------------



@app.get("/api/replenishment/catalog")

def get_catalog_replenishment_recommendations(

    category: str | None = None,

    unit_id: str | None = None,

    priority: str | None = None,

    target_buffer_days: int = 3,

):

    """Create transparent replenishment quantities from recent item-level demand.



    Policy: cover the greater of a 7-day planning horizon or effective lead time

    plus a configurable safety buffer. This is a synthetic-data demo recommendation,

    not an operational order.

    """

    if target_buffer_days < 0 or target_buffer_days > 14:

        raise HTTPException(status_code=422, detail="target_buffer_days must be between 0 and 14.")



    frame = _filtered_catalog(category=category, unit_id=unit_id)

    recommendations = []

    if not frame.empty:

        for (unit, item), series in frame.groupby(["unit_id", "item_id"], sort=True):

            series = series.sort_values("date")

            latest = series.iloc[-1]

            recent = series.tail(7)

            stock = max(0.0, float(latest["quantity"]))

            daily_demand = max(0.0, float(recent["daily_consumption"].mean()))



            lead_values = pd.to_numeric(series.get("lead_time_days", pd.Series(dtype=float)), errors="coerce").dropna()

            delay_values = pd.to_numeric(series.get("delivery_delay_days", pd.Series(dtype=float)), errors="coerce").dropna()

            lead = max(0, int(lead_values.iloc[-1])) if not lead_values.empty else 0

            delay = max(0, int(delay_values.iloc[-1])) if not delay_values.empty else 0

            effective_lead = lead + delay

            days_cover = stock / daily_demand if daily_demand > 0 else None

            target_days = max(7, effective_lead + target_buffer_days)



            if daily_demand <= 0:

                recommended = 0.0

                risk = "UNKNOWN"

                reason = "Recent consumption is zero or unavailable; manual review is required before replenishment."

                priority_value = "REVIEW"

            else:

                target_stock = daily_demand * target_days

                recommended = max(0.0, target_stock - stock)

                if days_cover is not None and days_cover <= effective_lead:

                    risk = "CRITICAL"

                    priority_value = "HIGH"

                    reason = f"Coverage is {days_cover:.1f} days versus {effective_lead} days effective lead time."

                elif days_cover is not None and days_cover <= effective_lead + 3:

                    risk = "WARNING"

                    priority_value = "MEDIUM"

                    reason = f"Coverage is close to effective lead time ({effective_lead} days)."

                else:

                    risk = "NORMAL"

                    priority_value = "LOW"

                    reason = f"Recommendation targets {target_days} days of demand, including lead time and buffer."



            recommendations.append({

                "unit_id": str(unit),

                "location": str(latest.get("location", "Unknown")),

                "item_id": str(item),

                "item_name": str(latest.get("item_name", item)),

                "category": str(latest.get("category", "Uncategorized")),

                "current_stock": round(stock, 2),

                "unit": str(latest.get("unit", "units")),

                "estimated_daily_demand": round(daily_demand, 2),

                "days_remaining": round(days_cover, 2) if days_cover is not None else None,

                "lead_time_days": lead,

                "delivery_delay_days": delay,

                "effective_lead_time_days": effective_lead,

                "target_coverage_days": target_days,

                "target_stock": round(daily_demand * target_days, 2),

                "recommended_quantity": round(recommended, 2),

                "priority": priority_value,

                "risk_level": risk,

                "reason": reason,

                "policy": "max(7 days, effective lead time + safety buffer)",

                "data_source": "SYNTHETIC_DEMO",

                "workflow_status": "RECOMMENDATION_ONLY",

            })



    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "REVIEW": 3}

    recommendations.sort(key=lambda row: (

        order.get(row["priority"], 4),

        -row["recommended_quantity"],

        row["category"], row["item_name"], row["unit_id"]

    ))

    if priority:

        recommendations = [row for row in recommendations if row["priority"].casefold() == priority.casefold()]



    return {

        "success": True,

        "data_source": "SYNTHETIC_DEMO",

        "method": "7-day trailing mean + lead-time-aware target stock",

        "target_buffer_days": target_buffer_days,

        "count": len(recommendations),

        "summary": {

            "high": sum(row["priority"] == "HIGH" for row in recommendations),

            "medium": sum(row["priority"] == "MEDIUM" for row in recommendations),

            "low": sum(row["priority"] == "LOW" for row in recommendations),

            "review": sum(row["priority"] == "REVIEW" for row in recommendations),

            "items_to_replenish": sum(row["recommended_quantity"] > 0 for row in recommendations),

        },

        "recommendations": recommendations,

    }





# ---------------------------------------------------------

# Persistent item-level review / approval / dispatch workflow

# ---------------------------------------------------------



def read_catalog_workflow() -> dict:

    if not CATALOG_WORKFLOW_FILE.exists():

        return {}

    try:

        with CATALOG_WORKFLOW_FILE.open("r", encoding="utf-8") as file:

            data = json.load(file)

        if not isinstance(data, dict):

            raise ValueError("Catalog workflow store must be a JSON object.")

        return data

    except (OSError, json.JSONDecodeError, ValueError) as exc:

        raise HTTPException(status_code=500, detail="Could not read item-level workflow storage.") from exc





def write_catalog_workflow(data: dict) -> None:

    temporary_file = CATALOG_WORKFLOW_FILE.with_suffix(".tmp")

    try:

        with temporary_file.open("w", encoding="utf-8") as file:

            json.dump(data, file, indent=2, ensure_ascii=False)

        temporary_file.replace(CATALOG_WORKFLOW_FILE)

    except OSError as exc:

        raise HTTPException(status_code=500, detail="Could not save item-level workflow storage.") from exc





def catalog_workflow_key(unit_id: str, item_id: str) -> str:

    return f"{unit_id}::{item_id}"





def get_catalog_recommendation(unit_id: str, item_id: str) -> dict:

    result = get_catalog_replenishment_recommendations(unit_id=unit_id)

    for item in result.get("recommendations", []):

        if str(item.get("item_id")) == item_id:

            return item

    raise HTTPException(status_code=404, detail="No catalog replenishment recommendation found for this unit and item.")





@app.get("/api/replenishment/catalog/workflow")

def list_catalog_replenishment_workflow(

    category: str | None = None,

    unit_id: str | None = None,

):

    result = get_catalog_replenishment_recommendations(category=category, unit_id=unit_id)

    with WORKFLOW_LOCK:

        store = read_catalog_workflow()

    items = []

    for recommendation in result.get("recommendations", []):

        key = catalog_workflow_key(recommendation["unit_id"], recommendation["item_id"])

        state = store.get(key, {})

        items.append({

            **recommendation,

            "workflow_status": state.get("status", "PENDING"),

            "workflow_updated_at": state.get("updated_at"),

            "workflow_updated_by": state.get("updated_by"),

            "reviewed_at": state.get("reviewed_at"),

            "approved_at": state.get("approved_at"),

            "rejected_at": state.get("rejected_at"),

            "dispatched_at": state.get("dispatched_at"),

            "workflow_note": state.get("note"),

        })

    return {

        "success": True,

        "data_source": "SYNTHETIC_DEMO",

        "count": len(items),

        "summary": {

            "pending": sum(item["workflow_status"] == "PENDING" for item in items),

            "reviewed": sum(item["workflow_status"] == "REVIEWED" for item in items),

            "approved": sum(item["workflow_status"] == "APPROVED" for item in items),

            "rejected": sum(item["workflow_status"] == "REJECTED" for item in items),

            "dispatched": sum(item["workflow_status"] == "DISPATCHED" for item in items),

        },

        "recommendations": items,

    }





def update_catalog_workflow(unit_id: str, item_id: str, action: str, user: dict, note: str | None = None) -> dict:

    recommendation = get_catalog_recommendation(unit_id, item_id)

    key = catalog_workflow_key(unit_id, item_id)

    now = datetime.now(timezone.utc).isoformat()

    transitions = {

        "review": ("PENDING", "REVIEWED"),

        "approve": ("REVIEWED", "APPROVED"),

        "reject": (("PENDING", "REVIEWED"), "REJECTED"),

        "dispatch": ("APPROVED", "DISPATCHED"),

    }

    if action not in transitions:

        raise HTTPException(status_code=404, detail="Unknown workflow action.")

    expected, next_status = transitions[action]



    with WORKFLOW_LOCK:

        store = read_catalog_workflow()

        current = store.get(key, {"status": "PENDING", "created_at": now})

        current_status = current.get("status", "PENDING")

        if current_status == next_status:

            return {"success": True, "message": f"Already {next_status.lower()}.", "workflow": {"unit_id": unit_id, "item_id": item_id, **current}}

        valid = current_status in expected if isinstance(expected, tuple) else current_status == expected

        if not valid:

            expected_text = " or ".join(expected) if isinstance(expected, tuple) else expected

            raise HTTPException(status_code=409, detail=f"Cannot {action} an item in {current_status} status; expected {expected_text}.")

        current.update({

            "status": next_status,

            "updated_at": now,

            "updated_by": user["username"],

            "note": (note or "").strip()[:300] or None,

        })

        if action == "review":

            current["reviewed_at"] = now

        elif action == "approve":

            current["approved_at"] = now

        elif action == "reject":

            current["rejected_at"] = now

        elif action == "dispatch":

            current["dispatched_at"] = now

        store[key] = current

        write_catalog_workflow(store)



    return {

        "success": True,

        "message": f"Item recommendation {next_status.lower()}.",

        "workflow": {"unit_id": unit_id, "item_id": item_id, **current},

        "recommendation": recommendation,

    }

@app.post("/api/replenishment/catalog/{unit_id}/{item_id}/review")

def review_catalog_replenishment(unit_id: str, item_id: str, user: dict = Depends(authenticated_user)):

    return update_catalog_workflow(unit_id, item_id, "review", user)





@app.post("/api/replenishment/catalog/{unit_id}/{item_id}/approve")

def approve_catalog_replenishment(unit_id: str, item_id: str, user: dict = Depends(authenticated_user)):

    if user.get("role") != "admin":

        raise HTTPException(status_code=403, detail="Admin role is required to approve.")

    return update_catalog_workflow(unit_id, item_id, "approve", user)





@app.post("/api/replenishment/catalog/{unit_id}/{item_id}/reject")

def reject_catalog_replenishment(unit_id: str, item_id: str, user: dict = Depends(authenticated_user)):

    if user.get("role") != "admin":

        raise HTTPException(status_code=403, detail="Admin role is required to reject.")

    return update_catalog_workflow(unit_id, item_id, "reject", user)





@app.post("/api/replenishment/catalog/{unit_id}/{item_id}/dispatch")

def dispatch_catalog_replenishment(unit_id: str, item_id: str, user: dict = Depends(authenticated_user)):

    if user.get("role") != "admin":

        raise HTTPException(status_code=403, detail="Admin role is required to dispatch.")

    return update_catalog_workflow(unit_id, item_id, "dispatch", user)





# ---------------------------------------------------------

# Emergency demand prioritization (transparent demo scoring)

# ---------------------------------------------------------



@app.get("/api/priorities/emergency")

def get_emergency_priorities(

    scenario: str = "CLEAR",

    category: str | None = None,

    unit_id: str | None = None,

):

    """Rank catalog items using configurable demo rules, not operational doctrine."""

    valid_scenarios = {"CLEAR": 0, "RAIN": 1, "HEAVY_RAIN": 2, "SNOW": 3}

    scenario_key = str(scenario or "CLEAR").upper()

    if scenario_key not in valid_scenarios:

        raise HTTPException(status_code=400, detail="scenario must be CLEAR, RAIN, HEAVY_RAIN, or SNOW")

    result = get_weather_aware_delivery_planning(category=category, unit_id=unit_id)

    plans = [p for p in result.get("plans", []) if p.get("scenario") == scenario_key]

    # Transparent, configurable demo weights. Category weighting is a prototype assumption,

    # not an official military prioritization policy.

    critical_categories = {"medical supplies", "fuel & energy"}

    high_categories = {"food & rations", "communications & electronics", "maintenance & spares"}

    ranked = []

    for p in plans:

        demand = max(0.0, float(p.get("estimated_daily_demand") or 0))

        stock = max(0.0, float(p.get("current_stock") or 0))

        days = p.get("days_remaining")

        lead = max(0.0, float(p.get("scenario_adjusted_lead_days") or 0))

        cat = str(p.get("category") or "").strip().lower()

        category_weight = 30 if cat in critical_categories else 18 if cat in high_categories else 10

        if days is None or demand <= 0:

            urgency_score = 0

            reason = "Daily demand is unavailable; manual review is required."

        else:

            gap = max(0.0, lead - float(days))

            urgency_score = min(40.0, gap * 8.0)

            if float(days) <= lead:

                reason = f"Estimated stock cover ({float(days):.1f} days) does not exceed adjusted lead time ({lead:.1f} days)."

            elif float(days) <= lead + 3:

                reason = f"Only {float(days):.1f} days of stock cover remain against {lead:.1f} adjusted lead days."

            else:

                reason = f"Estimated stock cover is {float(days):.1f} days against {lead:.1f} adjusted lead days."

            if p.get("risk_level") == "CRITICAL":

                urgency_score += 30

            elif p.get("risk_level") == "WARNING":

                urgency_score += 15

        score = round(min(100.0, urgency_score + category_weight), 1)

        if days is None or demand <= 0:

            level = "REVIEW"

        elif score >= 70:

            level = "CRITICAL"

        elif score >= 50:

            level = "HIGH"

        elif score >= 30:

            level = "MEDIUM"

        else:

            level = "LOW"

        if cat in critical_categories:

            reason += " Category receives a higher configurable demo weight."

        ranked.append({**p, "priority_score": score, "priority_level": level,

                       "priority_reason": reason, "category_weight": category_weight,

                       "scoring_method": "Demo rule: stock-cover gap + risk level + configurable category weight"})

    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "REVIEW": 4}

    ranked.sort(key=lambda x: (order.get(x["priority_level"], 5), -x["priority_score"],

                               x.get("days_remaining") if x.get("days_remaining") is not None else 1e9,

                               x.get("unit_id", ""), x.get("item_id", "")))

    return {"success": True, "data_source": "SYNTHETIC_DEMO", "scenario": scenario_key,

            "count": len(ranked), "summary": {level: sum(1 for x in ranked if x["priority_level"] == level)

            for level in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "REVIEW"]},

            "method": "Configurable demo scoring only; not an official military policy or operational recommendation.",

            "priorities": ranked}





# ---------------------------------------------------------

# Weather-aware delivery planning (synthetic scenario rules)

# ---------------------------------------------------------



@app.get("/api/delivery-planning/weather-aware")

def get_weather_aware_delivery_planning(

    category: str | None = None,

    unit_id: str | None = None,

):

    """Estimate delivery buffer impact using illustrative, non-live weather scenarios."""

    catalog = _filtered_catalog(category=category, unit_id=unit_id)

    recommendations = get_catalog_replenishment_recommendations(category=category, unit_id=unit_id).get("recommendations", [])

    if catalog.empty:

        return {

            "success": True, "data_source": "SYNTHETIC_DEMO", "count": 0,

            "message": "No inventory records available for this filter.", "plans": []

        }



    # Demonstration scenarios only. Not live forecasts or actual route intelligence.

    weather_rules = {

        "CLEAR": {"delay_days": 0, "impact": "LOW", "note": "No additional scenario buffer."},

        "RAIN": {"delay_days": 1, "impact": "MEDIUM", "note": "Illustrative rain scenario adds one day to delivery buffer."},

        "HEAVY_RAIN": {"delay_days": 2, "impact": "HIGH", "note": "Illustrative heavy-rain scenario adds two days to delivery buffer."},

        "SNOW": {"delay_days": 3, "impact": "HIGH", "note": "Illustrative snow scenario adds three days to delivery buffer."},

    }

    latest_rows = catalog.sort_values("date").groupby(["unit_id", "item_id"], sort=True).tail(1)

    rec_map = {(str(r.get("unit_id")), str(r.get("item_id"))): r for r in recommendations}

    plans = []

    for _, row in latest_rows.iterrows():

        key = (str(row["unit_id"]), str(row["item_id"]))

        rec = rec_map.get(key, {})

        base_lead = max(0, int(rec.get("lead_time_days") or 0))

        recorded_delay = max(0, int(rec.get("delivery_delay_days") or 0))

        for scenario_name, rule in weather_rules.items():

            extra = rule["delay_days"]

            effective_lead = base_lead + recorded_delay + extra

            demand = max(0.0, float(rec.get("estimated_daily_demand") or 0))

            stock = max(0.0, float(rec.get("current_stock") or 0))

            cover = stock / demand if demand > 0 else None

            target_days = max(7, effective_lead + 3)

            target_stock = demand * target_days

            extra_qty = max(0.0, target_stock - stock)

            if demand <= 0:

                risk = "UNKNOWN"

            elif cover <= effective_lead:

                risk = "CRITICAL"

            elif cover <= effective_lead + 3:

                risk = "WARNING"

            else:

                risk = "NORMAL"

            plans.append({

                "unit_id": key[0],

                "item_id": key[1],

                "item_name": str(row.get("item_name", key[1])),

                "category": str(row.get("category", "Uncategorized")),

                "location": str(row.get("location", "Unknown")),

                "scenario": scenario_name,

                "weather_impact": rule["impact"],

                "additional_delay_days": extra,

                "base_lead_time_days": base_lead,

                "recorded_delay_days": recorded_delay,

                "scenario_adjusted_lead_days": effective_lead,

                "current_stock": round(stock, 2),

                "estimated_daily_demand": round(demand, 2),

                "days_remaining": round(cover, 2) if cover is not None else None,

                "scenario_target_days": target_days,

                "scenario_recommended_quantity": round(extra_qty, 2),

                "risk_level": risk,

                "recommendation": rule["note"],

                "data_source": "SYNTHETIC_DEMO",

            })

    return {

        "success": True,

        "data_source": "SYNTHETIC_DEMO",

        "method": "Recorded lead time + recorded delay + illustrative weather-scenario buffer",

        "count": len(plans),

        "scenario_names": list(weather_rules.keys()),

        "plans": plans,

        "notice": "Illustrative scenarios only. This endpoint does not use live weather, geographic route data, or operational Army information.",

    }
