import type { InventoryItem } from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

type ApiInventoryRecord = {
  unit_id: string;
  personnel_count: number;
  food_stock_kg: number;
  avg_7day_consumption_kg: number;
  days_remaining: number;
};

type ApiInventoryResponse = {
  success: boolean;
  count: number;
  inventory: ApiInventoryRecord[];
};

export type BackendConnectionResult = {
  connected: boolean;
  source: "backend" | "local";
  message: string;
  inventory?: InventoryItem[];
};

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${response.statusText}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Reads synthetic food-stock records from the existing FastAPI endpoint. */
export async function fetchBackendInventory(): Promise<BackendConnectionResult> {
  try {
    const payload = await getJson<ApiInventoryResponse>("/api/inventory");
    if (!payload.success || !Array.isArray(payload.inventory)) {
      throw new Error("The inventory endpoint returned an unexpected response.");
    }
    const inventory: InventoryItem[] = payload.inventory.map((row, index) => ({
      id: `API-${row.unit_id || index + 1}`,
      name: `Food stock — ${row.unit_id}`,
      category: "Food & Rations",
      quantity: Math.max(0, Number(row.food_stock_kg) || 0),
      unit: "kg",
      reorderLevel: Math.max(0, (Number(row.avg_7day_consumption_kg) || 0) * 3),
      location: row.unit_id || "Simulated unit",
    }));
    return {
      connected: true,
      source: "backend",
      message: `Loaded ${inventory.length} synthetic inventory records from FastAPI.`,
      inventory,
    };
  } catch (error) {
    return {
      connected: false,
      source: "local",
      message: error instanceof Error ? error.message : "Unable to reach the FastAPI backend.",
      inventory: [],
    };
  }
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}
export type ReplenishmentRecommendation = {
  unit_id: string;
  current_stock_kg: number;
  daily_consumption_kg: number;
  days_remaining: number;
  recommended_replenishment_kg: number;
  priority: string;
  reason: string;
  workflow_status: string;
};

type ReplenishmentResponse = {
  success: boolean;
  recommendations: ReplenishmentRecommendation[];
};

export async function fetchBackendReplenishment(token?: string): Promise<ReplenishmentRecommendation[]> {
  const response = await fetch(`${API_BASE_URL}/api/replenishment`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${response.statusText}`);
  const payload = await response.json() as ReplenishmentResponse;

  if (!payload.success || !Array.isArray(payload.recommendations)) {
    throw new Error("Unexpected replenishment API response.");
  }

  return payload.recommendations;
}

export type CatalogForecast = {
  date: string;
  unit_id: string;
  location: string;
  item_id: string;
  item_name: string;
  category: string;
  unit: string;
  current_stock: number;
  estimated_daily_demand: number;
  horizon_days: number;
  estimated_horizon_demand: number;
  estimated_stock_after_horizon: number;
  days_of_cover: number;
  lead_time_days: number;
  delivery_delay_days: number;
  risk_level: string;
  method: string;
  data_source: string;
};

type CatalogForecastResponse = {
  success: boolean;
  data_source: string;
  method: string;
  horizon_days: number;
  count: number;
  forecasts: CatalogForecast[];
};

export async function fetchCatalogForecasts(): Promise<CatalogForecastResponse> {
  const payload = await getJson<CatalogForecastResponse>(
    "/api/forecast/catalog?horizon_days=7"
  );

  if (!payload.success || !Array.isArray(payload.forecasts)) {
    throw new Error("Unexpected catalog forecast API response.");
  }

  return payload;
}


/** 90-day deterministic synthetic historical inventory and demand records. */
export type SyntheticHistoryRecord = {
  date: string;
  unit_id: string;
  location: string;
  item_id: string;
  item_name: string;
  category: string;
  quantity: number;
  unit: string;
  daily_consumption: number;
  simulated_receipt_quantity: number;
  simulated_shortage: boolean;
  days_remaining: number | null;
  lead_time_days: number;
  delivery_delay_days: number;
  data_source: "SYNTHETIC_DEMO" | string;
  history_generated: boolean;
};

export type SyntheticHistoryResponse = {
  success: boolean;
  data_source: string;
  history_days: number;
  item_unit_series?: number;
  count: number;
  records: SyntheticHistoryRecord[];
  notice?: string;
};

export async function fetchSyntheticHistory(options: {
  days?: number;
  category?: string;
  unitId?: string;
  itemId?: string;
} = {}): Promise<SyntheticHistoryResponse> {
  const params = new URLSearchParams({ days: String(options.days ?? 90) });
  if (options.category) params.set("category", options.category);
  if (options.unitId) params.set("unit_id", options.unitId);
  if (options.itemId) params.set("item_id", options.itemId);
  const payload = await getJson<SyntheticHistoryResponse>(`/api/history/catalog?${params.toString()}`);
  if (!payload.success || !Array.isArray(payload.records)) {
    throw new Error("Unexpected synthetic history API response.");
  }
  return payload;
}

export type SyntheticDeliveryRecord = {
  delivery_id: string;
  date: string;
  unit_id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  status: string;
  data_source: string;
};

export async function fetchSyntheticDeliveryHistory(days = 90, unitId?: string): Promise<SyntheticDeliveryRecord[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (unitId) params.set("unit_id", unitId);
  const payload = await getJson<{ success: boolean; deliveries: SyntheticDeliveryRecord[] }>(
    `/api/history/deliveries?${params.toString()}`
  );
  if (!payload.success || !Array.isArray(payload.deliveries)) {
    throw new Error("Unexpected synthetic delivery history response.");
  }
  return payload.deliveries;
}

export type SyntheticShortageRecord = {
  date: string;
  unit_id: string;
  item_id: string;
  item_name: string;
  category: string;
  stock: number;
  daily_demand: number;
  risk_level: string;
  data_source: string;
};

export async function fetchSyntheticShortageHistory(days = 90, unitId?: string): Promise<SyntheticShortageRecord[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (unitId) params.set("unit_id", unitId);
  const payload = await getJson<{ success: boolean; shortages: SyntheticShortageRecord[] }>(
    `/api/history/shortages?${params.toString()}`
  );
  if (!payload.success || !Array.isArray(payload.shortages)) {
    throw new Error("Unexpected synthetic shortage history response.");
  }
  return payload.shortages;
}


/** Authenticate a demo officer against the FastAPI backend. */
export async function loginDemoOfficer(
  username: string,
  password: string
): Promise<{ access_token: string; token_type: string; expires_in_minutes: number }> {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);

  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Login failed. Check your credentials.");
  }
  return response.json();
}
