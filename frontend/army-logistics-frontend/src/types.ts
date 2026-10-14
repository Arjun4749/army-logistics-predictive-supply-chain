export type Status = "Pending" | "Approved" | "Rejected" | "Dispatched" | "In Transit" | "Delivered" | "Received" | "Delayed";
export type Priority = "Low" | "Medium" | "High";

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  location: string;
  expiry?: string;
}

export interface SupplyRequest {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  priority: Priority;
  status: Status;
  requestedBy: string;
  createdAt: string;
  notes?: string;
  shipmentId?: string;
}

export interface Shipment {
  id: string;
  requestId: string;
  itemName: string;
  quantity: number;
  status: Status;
  origin: string;
  destination: string;
  eta: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  title: string;
  description: string;
  time: string;
  kind: "success" | "warning" | "info";
}