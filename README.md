# Prime Logistics — Integrated SIH Prototype

This package contains the existing React frontend and FastAPI backend. The frontend theme, CSS, logo intro/loading animation, and animated background have been preserved; the integration change adds a small API service and loads the backend's `/api/inventory` data into the existing inventory state when available. If the API is unavailable, the frontend keeps using its saved/local demo data.

## 1. Backend setup

Requirements: Python 3.10+ recommended.

From the project root:

```bash
cd backend
python -m venv .venv
# macOS/Linux:
source .venv/bin/activate
# Windows PowerShell:
# .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` and replace `JWT_SECRET_KEY` and `DEMO_LOGIN_PASSWORD`. Do not commit `.env` or share it publicly.

Generate the included synthetic logistics dataset if needed:

```bash
python generate_data.py
```

This creates `data/logistics_data.csv` in the project root. Start the backend from the `backend` directory:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Check `http://127.0.0.1:8000/api/health`.

## 2. Frontend setup

Open another terminal:

```bash
cd frontend/army-logistics-frontend
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL shown in the terminal (usually `http://localhost:5173`). `VITE_API_BASE_URL` should point to the FastAPI URL, normally `http://127.0.0.1:8000`.

## Current integration scope and limitations

- The frontend reads synthetic inventory records from `GET /api/inventory` and maps them to the existing inventory model.
- The existing request and shipment UI workflows remain frontend-local because the backend does not expose matching general-purpose request/shipment CRUD endpoints. Replenishment workflows in the backend are separate and should not be represented as identical to the frontend request lifecycle without further mapping.
- The frontend falls back to its existing local demo records if the backend is unreachable or returns an error.
- The backend has additional catalog-based endpoints that require `data/multi_category_inventory.csv`; that catalog is not supplied in the backend ZIP, so those endpoints may return a 503 until a compatible catalog dataset is generated and added.
- The frontend's current API connection is a read-only inventory integration; it does not yet submit inventory mutations or request/shipment actions to the backend.
- No real military systems, operational locations, or live logistics data are connected. Use synthetic demo data only.

## API endpoint

The frontend integration uses `GET /api/inventory`, whose current backend response includes `unit_id`, `food_stock_kg`, `avg_7day_consumption_kg`, and related fields.
