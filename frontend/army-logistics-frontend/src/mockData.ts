import type { Activity, InventoryItem, Shipment, SupplyRequest } from "./types";

export const initialInventory: InventoryItem[] = [
  { id: "INV-1001", name: "Meal Supply Pack", category: "Rations", quantity: 840, unit: "packs", reorderLevel: 250, location: "Cedar Hub", expiry: "2027-06-30" },
  { id: "INV-1002", name: "First Aid Kit", category: "Medical", quantity: 126, unit: "kits", reorderLevel: 150, location: "Maple Hub", expiry: "2028-02-15" },
  { id: "INV-1003", name: "Portable Power Pack", category: "Equipment", quantity: 310, unit: "units", reorderLevel: 100, location: "Cedar Hub" },
  { id: "INV-1004", name: "Water Supply Canister", category: "Utilities", quantity: 92, unit: "units", reorderLevel: 120, location: "Pine Hub" },
  { id: "INV-1005", name: "Maintenance Kit", category: "Spare Parts", quantity: 74, unit: "kits", reorderLevel: 50, location: "Maple Hub" },
  { id: "INV-1006", name: "Utility Supply Kit", category: "Fuel", quantity: 215, unit: "units", reorderLevel: 100, location: "Pine Hub" },
  { id: "INV-1007", name: "Thermal Blanket", category: "Rations", quantity: 420, unit: "units", reorderLevel: 180, location: "Cedar Hub" },
  { id: "INV-1008", name: "Medical Gloves", category: "Medical", quantity: 65, unit: "boxes", reorderLevel: 100, location: "Maple Hub", expiry: "2027-01-12" }
];

export const initialRequests: SupplyRequest[] = [
  { id: "REQ-2041", itemId: "INV-1002", itemName: "First Aid Kit", quantity: 40, priority: "High", status: "Pending", requestedBy: "Demo Team North", createdAt: "2026-10-12", notes: "Routine replenishment" },
  { id: "REQ-2040", itemId: "INV-1001", itemName: "Meal Supply Pack", quantity: 120, priority: "Medium", status: "Approved", requestedBy: "Demo Team West", createdAt: "2026-10-11", notes: "Scheduled supply" },
  { id: "REQ-2039", itemId: "INV-1003", itemName: "Portable Power Pack", quantity: 24, priority: "Low", status: "Dispatched", requestedBy: "Demo Team Central", createdAt: "2026-10-10", notes: "Equipment replenishment", shipmentId: "SHP-8812" },
  { id: "REQ-2038", itemId: "INV-1004", itemName: "Water Supply Canister", quantity: 20, priority: "High", status: "Received", requestedBy: "Demo Team East", createdAt: "2026-10-09", notes: "Routine replenishment", shipmentId: "SHP-8810" }
];

export const initialShipments: Shipment[] = [
  { id: "SHP-8812", requestId: "REQ-2039", itemName: "Portable Power Pack", quantity: 24, status: "In Transit", origin: "Cedar Hub", destination: "Demo Team Central", eta: "2026-10-13", createdAt: "2026-10-10" },
  { id: "SHP-8810", requestId: "REQ-2038", itemName: "Water Supply Canister", quantity: 20, status: "Delivered", origin: "Pine Hub", destination: "Demo Team East", eta: "2026-10-10", createdAt: "2026-10-09" },
  { id: "SHP-8808", requestId: "REQ-2035", itemName: "Meal Supply Pack", quantity: 80, status: "Delayed", origin: "Cedar Hub", destination: "Demo Team South", eta: "2026-10-11", createdAt: "2026-10-08" }
];

export const initialActivity: Activity[] = [
  { id: "ACT-01", title: "Inventory audit completed", description: "Demo stock records synchronised", time: "10 min ago", kind: "success" },
  { id: "ACT-02", title: "Low stock detected", description: "First Aid Kit is below its demo reorder threshold", time: "32 min ago", kind: "warning" },
  { id: "ACT-03", title: "Shipment in transit", description: "SHP-8812 status updated", time: "1 hour ago", kind: "info" },
  { id: "ACT-04", title: "Request awaiting approval", description: "REQ-2041 requires review", time: "2 hours ago", kind: "warning" }
];