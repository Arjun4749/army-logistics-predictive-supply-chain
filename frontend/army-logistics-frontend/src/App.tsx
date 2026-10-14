import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity as ActivityIcon, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight,
  BarChart3, Bell, Boxes, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardList,
  Clock3, Command, Download, Eye, Filter, LayoutDashboard, Map, Menu, MoreHorizontal,
  Package, PackageCheck, Plus, Search, Send, Settings, ShieldCheck, Sparkles, Truck,
  X, Zap
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { initialActivity, initialInventory, initialRequests, initialShipments } from "./mockData";
import {
  fetchBackendInventory,
  fetchBackendReplenishment,
  loginDemoOfficer,
  fetchCatalogForecasts,
  fetchSyntheticHistory,
  fetchSyntheticDeliveryHistory,
  fetchSyntheticShortageHistory,
  type BackendConnectionResult,
  type ReplenishmentRecommendation,
  type CatalogForecast,
  type SyntheticHistoryRecord,
  type SyntheticDeliveryRecord,
  type SyntheticShortageRecord,
} from "./services/api";
import type { Activity, InventoryItem, Priority, Shipment, Status, SupplyRequest } from "./types";

type Page = "Dashboard" | "Inventory" | "Supply Requests" | "Storage Alerts" | "Shipments" | "Replenishment" | "Predictive Analytics" | "Supply Network" | "Reports";

const nav = [
  { label: "Dashboard", icon: LayoutDashboard, group: "OVERVIEW" },
  { label: "Inventory", icon: Boxes, group: "OVERVIEW" },
  { label: "Supply Requests", icon: ClipboardList, group: "OPERATIONS" },
  { label: "Storage Alerts", icon: AlertTriangle, group: "OPERATIONS" },
  { label: "Shipments", icon: Truck, group: "OPERATIONS" },
  { label: "Replenishment", icon: PackageCheck, group: "OPERATIONS" },
  { label: "Predictive Analytics", icon: BarChart3, group: "INTELLIGENCE" },
  { label: "Supply Network", icon: Map, group: "INTELLIGENCE" },
  { label: "Reports", icon: ActivityIcon, group: "SYSTEM" }
] as const;

const demandData = [
  { month: "May", actual: 310, forecast: 325 },
  { month: "Jun", actual: 340, forecast: 350 },
  { month: "Jul", actual: 295, forecast: 320 },
  { month: "Aug", actual: 390, forecast: 375 },
  { month: "Sep", actual: 360, forecast: 390 },
  { month: "Oct", actual: 420, forecast: 415 },
  { month: "Nov", actual: null, forecast: 445 },
  { month: "Dec", actual: null, forecast: 470 }
];

const categoryData = [
  { name: "Rations", value: 32, color: "#91a66b" },
  { name: "Medical", value: 21, color: "#c3aa70" },
  { name: "Equipment", value: 19, color: "#6d8f80" },
  { name: "Utilities", value: 16, color: "#718096" },
  { name: "Other", value: 12, color: "#555e56" }
];

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function StatusBadge({ status }: { status: Status | string }) {
  const cls = status.toLowerCase().replace(/ /g, "-");
  return <span className={`status-badge ${cls}`}><span className="status-dot" />{status}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority ${priority.toLowerCase()}`}><span />{priority}</span>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-title-action">{action}</div>}</div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-card"><div className="modal-header"><div><div className="eyebrow">WORKSPACE ACTION</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>{children}</div></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><Package size={24} /><strong>{title}</strong><span>{detail}</span></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem("replenishment-auth-token") || "");
  const [authUsername, setAuthUsername] = useState(() => localStorage.getItem("replenishment-auth-username") || "");
  const [showIntro, setShowIntro] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>(() => readStored("army-demo-inventory", initialInventory));
  const [requests, setRequests] = useState<SupplyRequest[]>(() => readStored("army-demo-requests", initialRequests));
  const [shipments, setShipments] = useState<Shipment[]>(() => readStored("army-demo-shipments", initialShipments));
  const [activities, setActivities] = useState<Activity[]>(() => readStored("army-demo-activity", initialActivity));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState<"request" | "stock" | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");
  const [formItem, setFormItem] = useState(initialInventory[0].id);
  const [formQuantity, setFormQuantity] = useState("20");
  const [formPriority, setFormPriority] = useState<Priority>("Medium");
  const [formNotes, setFormNotes] = useState("");
  const [stockItem, setStockItem] = useState(initialInventory[0].id);
  const [stockDelta, setStockDelta] = useState("10");
  const [stockAction, setStockAction] = useState<"in" | "out">("in");
  const [backendConnection, setBackendConnection] = useState<BackendConnectionResult>({ connected: false, source: "local", message: "Backend not checked yet" });
  const [backendReplenishment, setBackendReplenishment] = useState<ReplenishmentRecommendation[]>([]);
  
  useEffect(() => { localStorage.setItem("army-demo-inventory", JSON.stringify(inventory)); }, [inventory]);
  useEffect(() => { localStorage.setItem("army-demo-requests", JSON.stringify(requests)); }, [requests]);
  useEffect(() => { localStorage.setItem("army-demo-shipments", JSON.stringify(shipments)); }, [shipments]);
  useEffect(() => { localStorage.setItem("army-demo-activity", JSON.stringify(activities)); }, [activities]);
  useEffect(() => {
    let cancelled = false;
    fetchBackendInventory().then(result => {
      if (cancelled) return;
      if (result.connected && result.inventory && result.inventory.length > 0) {
        setInventory(result.inventory);
        setBackendConnection({ connected: true, source: "backend", message: "Connected to FastAPI backend" });
        addActivity("Backend connected", `Loaded ${result.inventory.length} inventory records from the API`, "success");
      } else {
        setBackendConnection({ connected: false, source: "local", message: result.message || "Backend data unavailable; using saved demo data" });
      }
    }).catch(() => {
      if (!cancelled) setBackendConnection({ connected: false, source: "local", message: "Backend unavailable; using saved demo data" });
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!authToken) {
      setBackendReplenishment([]);
      return;
    }
    let cancelled = false;
    fetchBackendReplenishment(authToken)
      .then((recommendations) => { if (!cancelled) setBackendReplenishment(recommendations); })
      .catch((error) => {
        console.error("Failed to load protected replenishment recommendations:", error);
        if (!cancelled && String(error).includes("401")) {
          localStorage.removeItem("replenishment-auth-token");
          localStorage.removeItem("replenishment-auth-username");
          setAuthToken(""); setAuthUsername("");
        }
      });
    return () => { cancelled = true; };
  }, [authToken]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { const timer = window.setTimeout(() => setShowIntro(false), 6100); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (!actionBusy) return; const timer = window.setTimeout(() => setActionBusy(false), 520); return () => window.clearTimeout(timer); }, [actionBusy]);

  const addActivity = (title: string, description: string, kind: Activity["kind"] = "info") => {
    setActivities(prev => [{ id: `ACT-${Date.now()}`, title, description, time: "Just now", kind }, ...prev].slice(0, 30));
  };
  const notify = (message: string) => setToast(message);

  const lowStock = inventory.filter(i => i.quantity <= i.reorderLevel);
  const pendingCount = requests.filter(r => r.status === "Pending").length;
  const transitCount = shipments.filter(s => s.status === "In Transit" || s.status === "Dispatched").length;
  const delayedCount = shipments.filter(s => s.status === "Delayed").length;

  const filteredInventory = useMemo(() => inventory.filter(item => {
    const matchesSearch = `${item.name} ${item.id} ${item.category} ${item.location}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All" || (filter === "Low stock" ? item.quantity <= item.reorderLevel : item.category === filter);
    return matchesSearch && matchesFilter;
  }), [inventory, search, filter]);

  const filteredRequests = useMemo(() => requests.filter(r => {
    const matchesSearch = `${r.id} ${r.itemName} ${r.requestedBy}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (filter === "All" || r.status === filter);
  }), [requests, search, filter]);

  const filteredShipments = useMemo(() => shipments.filter(s => {
    const matchesSearch = `${s.id} ${s.itemName} ${s.destination}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (filter === "All" || s.status === filter);
  }), [shipments, search, filter]);

  const createRequest = (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(formQuantity);
    const item = inventory.find(i => i.id === formItem);
    if (!item || !Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) { notify("Enter a valid whole-number quantity."); return; }
    if (qty > item.quantity) { notify("Requested quantity exceeds demo stock. Reduce the quantity."); return; }
    const req: SupplyRequest = {
      id: `REQ-${Math.floor(2000 + Math.random() * 7000)}`,
      itemId: item.id, itemName: item.name, quantity: qty, priority: formPriority,
      status: "Pending", requestedBy: "Demo Unit", createdAt: new Date().toISOString().slice(0, 10), notes: formNotes
    };
    setRequests(prev => [req, ...prev]);
    addActivity("Supply request created", `${req.id} · ${qty} ${item.unit} of ${item.name}`, "info");
    setModal(null); setPage("Supply Requests"); setSearch(""); setFilter("All");
    notify(`Request ${req.id} created`);
  };

  const updateRequest = (id: string, status: Status) => {
    const req = requests.find((r) => r.id === id);
    if (!req) return;

    if (status === "Dispatched") {
      if (req.status !== "Approved") {
        notify("Only approved requests can be dispatched.");
        return;
      }

      // Existing requests may reference mock-data IDs that are not present in
      // the backend inventory. Use the matching mock item for the demo shipment
      // instead of blocking the workflow or changing an unrelated backend item.
      const connectedItem = inventory.find((item) => item.id === req.itemId);
      const demoItem = connectedItem
        ? undefined
        : initialInventory.find((item) => item.id === req.itemId);
      const dispatchItem = connectedItem ?? demoItem;

      if (!dispatchItem) {
        notify("This request's item was not found in connected or demo inventory.");
        return;
      }

      if (dispatchItem.quantity < req.quantity) {
        notify("Not enough inventory to dispatch this request.");
        return;
      }

      const shipmentId = `SHP-${Math.floor(8000 + Math.random() * 1999)}`;
      const shipment: Shipment = {
        id: shipmentId,
        requestId: req.id,
        itemName: req.itemName,
        quantity: req.quantity,
        status: "In Transit",
        origin: dispatchItem.location,
        destination: req.requestedBy.replace("Unit", "Demo Unit"),
        eta: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        createdAt: new Date().toISOString().slice(0, 10),
      };

      setShipments((prev) => [shipment, ...prev]);

      // Only adjust the displayed inventory when the dispatched item belongs
      // to that inventory. Mock-only requests must not alter backend stock.
      if (connectedItem) {
        setInventory((prev) =>
          prev.map((item) =>
            item.id === req.itemId
              ? { ...item, quantity: item.quantity - req.quantity }
              : item,
          ),
        );
      }

      setRequests((prev) =>
        prev.map((request) =>
          request.id === id
            ? { ...request, status: "Dispatched", shipmentId }
            : request,
        ),
      );
      addActivity(
        "Shipment dispatched",
        `${shipmentId} created for ${req.id}${demoItem ? " using demo inventory" : ""}`,
        "success",
      );
      notify(`${req.id} dispatched · ${shipmentId}`);
      return;
    }

    setRequests((prev) =>
      prev.map((request) => (request.id === id ? { ...request, status } : request)),
    );
    addActivity(
      `Request ${status.toLowerCase()}`,
      `${req.id} · ${req.itemName}`,
      status === "Rejected" ? "warning" : "success",
    );
    notify(`${req.id} marked ${status.toLowerCase()}`);
  };

  const updateShipment = (shipment: Shipment, status: Status, receivedQty?: number) => {
    if (status === "Delivered") {
      setShipments(prev => prev.map(s => s.id === shipment.id ? { ...s, status: "Delivered" } : s));
      addActivity("Shipment delivered", `${shipment.id} delivery recorded`, "success");
      notify(`${shipment.id} marked delivered`);
      return;
    }
    if (status === "Received") {
      const qty = receivedQty ?? shipment.quantity;
      if (!Number.isInteger(qty) || qty < 0 || qty > shipment.quantity) { notify("Enter a valid received quantity."); return; }
      setShipments(prev => prev.map(s => s.id === shipment.id ? { ...s, status: "Received" } : s));
      setRequests(prev => prev.map(r => r.id === shipment.requestId ? { ...r, status: "Received" } : r));
      if (qty !== shipment.quantity) addActivity("Receipt discrepancy recorded", `${shipment.id}: dispatched ${shipment.quantity}, received ${qty}`, "warning");
      else addActivity("Receipt confirmed", `${shipment.id}: ${qty} units received`, "success");
      notify(qty === shipment.quantity ? "Receipt confirmed" : "Receipt saved with discrepancy");
    }
  };

  const addStock = (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(stockDelta);
    const item = inventory.find(i => i.id === stockItem);
    if (!item || !Number.isInteger(qty) || qty <= 0) { notify("Enter a valid positive whole number."); return; }
    if (stockAction === "out" && qty > item.quantity) { notify("Cannot remove more than available stock."); return; }
    setInventory(prev => prev.map(i => i.id === stockItem ? { ...i, quantity: i.quantity + (stockAction === "in" ? qty : -qty) } : i));
    addActivity(`Stock ${stockAction === "in" ? "received" : "issued"}`, `${qty} ${item.unit} · ${item.name}`, "success");
    setModal(null); notify(`Stock ${stockAction === "in" ? "added" : "removed"} successfully`);
  };

  const resetDemo = () => {
    setInventory(initialInventory); setRequests(initialRequests); setShipments(initialShipments); setActivities(initialActivity);
    setSearch(""); setFilter("All"); notify("Demo data has been reset");
  };

  const exportCsv = () => {
    const rows = [["ID", "Item", "Category", "Quantity", "Unit", "Reorder Level", "Location"], ...inventory.map(i => [i.id, i.name, i.category, String(i.quantity), i.unit, String(i.reorderLevel), i.location])];
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "demo-inventory-report.csv"; a.click(); URL.revokeObjectURL(url);
    notify("Inventory CSV exported");
  };

  const openPage = (next: Page) => { setPage(next); setSearch(""); setFilter("All"); setMobileNav(false); };

  const handleOfficerLogin = async (username: string, password: string) => {
    const result = await loginDemoOfficer(username, password);
    localStorage.setItem("replenishment-auth-token", result.access_token);
    localStorage.setItem("replenishment-auth-username", username);
    setAuthToken(result.access_token);
    setAuthUsername(username);
    notify("Officer authorization successful");
  };

  const handleOfficerLogout = () => {
    localStorage.removeItem("replenishment-auth-token");
    localStorage.removeItem("replenishment-auth-username");
    setAuthToken(""); setAuthUsername(""); setBackendReplenishment([]);
    notify("You have been signed out of Replenishment");
  };

  return (
    <div className="app-shell" onClickCapture={e => { const target = e.target as HTMLElement; if (target.closest("button")) setActionBusy(true); }}>
      {showIntro && <div className="brand-intro" role="status" aria-label="Loading predictive logistics demo">
        <div className="intro-grid" aria-hidden="true"/><div className="intro-radar" aria-hidden="true"/>
        <div className="intro-corners" aria-hidden="true"><i/><i/><i/><i/></div>
        <div className="intro-content">
          <div className="intro-overline"><span>SIMULATED LOGISTICS ENVIRONMENT</span></div>
          <div className="intro-wordmark"><span className="word-indian">INDI</span><span className="word-gold-a">A</span><span className="word-army">N ARMY</span></div>
          <div className="intro-tricolor"><i/><i/><i/></div>
          <div className="intro-subtitle">PREDICTIVE LOGISTICS <b>&</b> FORWARD SUPPLY CHAIN</div>
          <div className="intro-microcopy">SUPPLY NETWORK · INVENTORY INTELLIGENCE · DEMO MODE</div>
          <div className="intro-loading-track" aria-label="Loading demo interface"><span/></div>
          <div className="intro-loading-label">INITIALIZING INTERFACE <b>•</b> PLEASE WAIT</div>
        </div>
        <button className="intro-skip" onClick={() => setShowIntro(false)}>SKIP INTRO <ArrowRight size={13}/></button>
      </div>}
      {actionBusy && !showIntro && <div className="action-progress" aria-hidden="true"><span/></div>}
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark"><Command size={22} /></div><div><strong>PRIME<span>LOGISTICS</span></strong><small>SUPPLY CHAIN INTELLIGENCE</small></div><button className="mobile-close icon-button" onClick={() => setMobileNav(false)}><X size={17}/></button></div>
        <div className="workspace-switch"><div className="workspace-emblem"><ShieldCheck size={18}/></div><div><strong>Operations Centre</strong><small>Demo environment</small></div><ChevronDown size={15} className="muted-icon"/></div>
        {(["OVERVIEW", "OPERATIONS", "INTELLIGENCE", "SYSTEM"] as const).map(group => (
          <div className="nav-group" key={group}><div className="nav-label">{group}</div>{nav.filter(n => n.group === group).map(n => {
            const Icon = n.icon;
            return <button key={n.label} className={`nav-item ${page === n.label ? "active" : ""}`} onClick={() => openPage(n.label as Page)}><Icon size={17}/><span>{n.label}</span>{n.label === "Supply Requests" && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}</button>;
          })}</div>
        ))}
        <div className="sidebar-bottom"><div className="demo-notice"><span className="live-dot"/><div><strong>{backendConnection.connected ? "Backend connected" : "Demo mode active"}</strong><small>{backendConnection.connected ? "API inventory enabled" : "Using local demo data"}</small></div></div><button className="nav-item" onClick={() => notify("Settings panel is not part of this frontend demo yet")}><Settings size={17}/><span>Settings</span></button><div className="user-profile"><div className="avatar">{authToken ? "RO" : "OP"}</div><div><strong>{authToken ? authUsername || "Demo Officer" : "Demo Operator"}</strong><small>{authToken ? "Replenishment authorized" : "Logistics viewer"}</small></div>{authToken ? <button className="icon-button" title="Sign out of Replenishment" onClick={handleOfficerLogout}><ShieldCheck size={16}/></button> : <MoreHorizontal size={18} className="muted-icon"/>}</div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="icon-button menu-toggle" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>{page}</strong></div></div><div className="topbar-right"><div className="environment-pill"><span className="live-dot"/> DEMO ENVIRONMENT</div><button className="icon-button notification-button" onClick={() => { openPage("Supply Requests"); setFilter("Pending"); }} aria-label="View pending alerts"><Bell size={18}/>{pendingCount > 0 && <i/>}</button><div className="top-avatar">OP</div></div></header>

        <div className="page-content">
          {page === "Dashboard" && <Dashboard inventory={inventory} requests={requests} shipments={shipments} activities={activities} lowStock={lowStock} pendingCount={pendingCount} transitCount={transitCount} delayedCount={delayedCount} go={openPage} />}
          {page === "Inventory" && <InventoryPage inventory={filteredInventory} allInventory={inventory} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} openStock={() => setModal("stock")} exportCsv={exportCsv} />}
          {page === "Supply Requests" && <RequestsPage requests={filteredRequests} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} openRequest={() => setModal("request")} updateRequest={updateRequest} />}
          {page === "Storage Alerts" && <StorageAlertsPage inventory={inventory} lowStock={lowStock} />}
          {page === "Shipments" && <ShipmentsPage shipments={filteredShipments} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} updateShipment={updateShipment} />}
          
          {page === "Replenishment" && (
            authToken ? (
              <ReplenishmentPage
              inventory={inventory}
              backendReplenishment={backendReplenishment}
              openRequest={() => setModal("request")}
              />
            ) : (
            <ReplenishmentLogin onLogin={handleOfficerLogin} />
            ) 
          )}

          {page === "Predictive Analytics" && <AnalyticsPage inventory={inventory} lowStock={lowStock} />}
          {page === "Supply Network" && <NetworkPage shipments={shipments} inventory={inventory} />}
          {page === "Reports" && <ReportsPage inventory={inventory} requests={requests} shipments={shipments} activities={activities} exportCsv={exportCsv} resetDemo={resetDemo} />}
        </div>
        <footer className="app-footer"><span><ShieldCheck size={13}/> PRIME LOGISTICS · SIH FRONTEND PROTOTYPE</span><span>Fictional demo data · Not connected to military systems</span></footer>
      </main>

      {modal === "request" && <Modal title="Create supply request" onClose={() => setModal(null)}><form className="form-body" onSubmit={createRequest}><label>Supply item<select value={formItem} onChange={e => setFormItem(e.target.value)}>{inventory.map(i => <option key={i.id} value={i.id}>{i.name} · {i.quantity} {i.unit} available</option>)}</select></label><div className="form-grid"><label>Quantity<input type="number" min="1" step="1" required value={formQuantity} onChange={e => setFormQuantity(e.target.value)}/></label><label>Priority<select value={formPriority} onChange={e => setFormPriority(e.target.value as Priority)}><option>Low</option><option>Medium</option><option>High</option></select></label></div><label>Request notes<textarea rows={3} value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Enter a short demo note (optional)"/></label><div className="form-hint"><AlertTriangle size={14}/> Demo requests must not exceed the displayed available stock.</div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" type="submit"><Plus size={16}/> Create request</button></div></form></Modal>}

      {modal === "stock" && <Modal title="Adjust inventory" onClose={() => setModal(null)}><form className="form-body" onSubmit={addStock}><label>Inventory item<select value={stockItem} onChange={e => setStockItem(e.target.value)}>{inventory.map(i => <option key={i.id} value={i.id}>{i.name} · {i.quantity} {i.unit}</option>)}</select></label><div className="form-grid"><label>Action<select value={stockAction} onChange={e => setStockAction(e.target.value as "in" | "out")}><option value="in">Stock in</option><option value="out">Stock out</option></select></label><label>Quantity<input type="number" min="1" step="1" required value={stockDelta} onChange={e => setStockDelta(e.target.value)}/></label></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" type="submit"><Check size={16}/> Apply adjustment</button></div></form></Modal>}

      {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}<button className="icon-button" onClick={() => setToast("")}><X size={15}/></button></div>}
    </div>
  );
}

function Dashboard({ inventory, requests, shipments, activities, lowStock, pendingCount, transitCount, delayedCount, go }: {
  inventory: InventoryItem[]; requests: SupplyRequest[]; shipments: Shipment[]; activities: Activity[]; lowStock: InventoryItem[]; pendingCount: number; transitCount: number; delayedCount: number; go: (p: Page) => void
}) {
  const totalUnits = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const kpis = [
    { label: "Tracked inventory", value: inventory.length.toString().padStart(2, "0"), change: "Across demo categories", icon: Boxes, tone: "green", go: "Inventory" as Page },
    { label: "Low-stock items", value: lowStock.length.toString().padStart(2, "0"), change: "Require review", icon: AlertTriangle, tone: "gold", go: "Inventory" as Page },
    { label: "Pending requests", value: pendingCount.toString().padStart(2, "0"), change: "Awaiting approval", icon: ClipboardList, tone: "blue", go: "Supply Requests" as Page },
    { label: "In-transit shipments", value: transitCount.toString().padStart(2, "0"), change: `${delayedCount} delayed in demo`, icon: Truck, tone: "purple", go: "Shipments" as Page }
  ];
  return <>
    <PageTitle eyebrow="OVERVIEW / OPERATIONS" title="Command dashboard" description="A consolidated view of simulated supply-chain operations." action={<button className="btn btn-primary" onClick={() => go("Supply Requests")}><Plus size={16}/> New request</button>}/>
    <div className="notice-banner"><div className="notice-icon"><ShieldCheck size={19}/></div><div><strong>Prototype environment</strong><p>All records, quantities, locations and forecasts on this dashboard are fictional demonstration data.</p></div><span className="notice-tag">MOCK DATA</span></div>
    <div className="kpi-grid">{kpis.map(k => { const Icon = k.icon; return <button className="kpi-card" key={k.label} onClick={() => go(k.go)}><div className="kpi-top"><span>{k.label}</span><span className={`kpi-icon ${k.tone}`}><Icon size={17}/></span></div><div className="kpi-value">{k.value}</div><div className="kpi-foot"><span className="kpi-context">{k.change}</span><ArrowUpRight size={14}/></div></button>; })}</div>
    <div className="dashboard-grid">
      <section className="panel demand-panel"><div className="panel-heading"><div><div className="eyebrow">DEMAND PLANNING</div><h2>Demand overview</h2><p>Historical sample and simulated forecast</p></div><button className="small-select" onClick={() => go("Predictive Analytics")}>View analytics <ArrowRight size={14}/></button></div><div className="chart-legend"><span><i className="legend-dot actual"/> Historical</span><span><i className="legend-dot forecast"/> Forecast</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={demandData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}><defs><linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#91a66b" stopOpacity={0.24}/><stop offset="95%" stopColor="#91a66b" stopOpacity={0}/></linearGradient><linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c3aa70" stopOpacity={0.15}/><stop offset="95%" stopColor="#c3aa70" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#28312b" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="month" tick={{ fill: "#818b80", fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis tick={{ fill: "#818b80", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: "#171e19", border: "1px solid #344035", borderRadius: 10, color: "#e8ece6", fontSize: 12 }}/><Area type="monotone" dataKey="actual" name="Historical" stroke="#91a66b" strokeWidth={2} fill="url(#actualFill)" connectNulls={false} isAnimationActive animationBegin={250} animationDuration={1400} animationEasing="ease-out"/><Area type="monotone" dataKey="forecast" name="Simulated forecast" stroke="#c3aa70" strokeWidth={2} strokeDasharray="5 4" fill="url(#forecastFill)" isAnimationActive animationBegin={450} animationDuration={1600} animationEasing="ease-out"/></AreaChart></ResponsiveContainer></div><div className="chart-footnote"><Sparkles size={13}/> Forecast values are simulated for UI demonstration only.</div></section>
      <section className="panel stock-panel"><div className="panel-heading"><div><div className="eyebrow">STOCK DISTRIBUTION</div><h2>Inventory mix</h2><p>Share by category</p></div><button className="icon-button" onClick={() => go("Inventory")} aria-label="Open inventory"><MoreHorizontal size={18}/></button></div><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={63} outerRadius={86} paddingAngle={4} stroke="none" isAnimationActive animationBegin={250} animationDuration={1200} animationEasing="ease-out">{categoryData.map(entry => <Cell key={entry.name} fill={entry.color}/>)}</Pie><Tooltip contentStyle={{ background: "#171e19", border: "1px solid #344035", borderRadius: 10, color: "#e8ece6", fontSize: 12 }}/></PieChart></ResponsiveContainer><div className="donut-center"><strong>{totalUnits.toLocaleString()}</strong><span>total units*</span></div></div><div className="category-legend">{categoryData.map(c => <div key={c.name}><span><i style={{ background: c.color }}/>{c.name}</span><strong>{c.value}%</strong></div>)}</div><div className="chart-footnote">*Quantity total is calculated from demo inventory.</div></section>
    </div>
    <div className="lower-grid"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">ACTION REQUIRED</div><h2>Inventory alerts</h2></div><button className="text-button" onClick={() => go("Inventory")}>View all <ArrowRight size={14}/></button></div>{lowStock.length === 0 ? <EmptyState title="No low-stock items" detail="All demo inventory is above its reorder threshold."/> : <div className="alert-list">{lowStock.slice(0, 4).map(i => <div className="alert-row" key={i.id}><div className="alert-symbol"><AlertTriangle size={16}/></div><div className="alert-copy"><strong>{i.name}</strong><span>{i.location} · reorder threshold {i.reorderLevel} {i.unit}</span></div><div className="alert-quantity"><strong>{i.quantity}</strong><span>remaining</span></div></div>)}</div>}</section>
      <section className="panel"><div className="panel-heading"><div><div className="eyebrow">LATEST UPDATES</div><h2>Activity feed</h2></div><button className="text-button" onClick={() => go("Reports")}>View logs <ArrowRight size={14}/></button></div><div className="activity-list">{activities.slice(0, 4).map(a => <div className="activity-row" key={a.id}><div className={`activity-symbol ${a.kind}`}>{a.kind === "success" ? <CheckCircle2 size={15}/> : a.kind === "warning" ? <AlertTriangle size={15}/> : <ActivityIcon size={15}/>}</div><div className="activity-copy"><strong>{a.title}</strong><span>{a.description}</span><small>{a.time}</small></div></div>)}</div></section></div>
    <div className="dashboard-bottom-note"><Zap size={15}/><span><strong>Operational note:</strong> use this prototype to demonstrate request flow, stock visibility and simulated demand planning. It is not a live operational system.</span></div>
  </>;
}

function InventoryPage({ inventory, allInventory, search, setSearch, filter, setFilter, openStock, exportCsv }: {
  inventory: InventoryItem[]; allInventory: InventoryItem[]; search: string; setSearch: (s: string) => void; filter: string; setFilter: (s: string) => void; openStock: () => void; exportCsv: () => void
}) {
  const [inventoryHistory, setInventoryHistory] = useState<SyntheticHistoryRecord[]>([]);
  const [inventoryHistoryLoading, setInventoryHistoryLoading] = useState(true);
  const [inventoryHistoryError, setInventoryHistoryError] = useState("");
  const [historyItemId, setHistoryItemId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchSyntheticHistory({ days: 90 })
      .then((result) => {
        if (cancelled) return;
        setInventoryHistory(result.records);
        setInventoryHistoryError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInventoryHistoryError(error instanceof Error ? error.message : "Unable to load inventory history.");
      })
      .finally(() => { if (!cancelled) setInventoryHistoryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const historyItems = useMemo(() => {
    const unique = new globalThis.Map<string, { id: string; name: string; unit: string }>();
    inventoryHistory.forEach((record) => {
      const key = `${record.unit_id}::${record.item_id}`;
      if (!unique.has(key)) unique.set(key, { id: key, name: `${record.item_name} · ${record.location}`, unit: record.unit });
    });
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [inventoryHistory]);

  useEffect(() => {
    if (historyItems.length && !historyItems.some((item) => item.id === historyItemId)) {
      setHistoryItemId(historyItems[0].id);
    }
  }, [historyItems, historyItemId]);

  const selectedHistoryItem = historyItems.find((item) => item.id === historyItemId);
  const inventoryHistoryChart = useMemo(() => inventoryHistory
    .filter((record) => `${record.unit_id}::${record.item_id}` === historyItemId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((record) => ({ date: record.date, stock: Number(record.quantity) || 0, consumption: Number(record.daily_consumption) || 0, receipts: Number(record.simulated_receipt_quantity) || 0 })), [inventoryHistory, historyItemId]);

  return <>
    <PageTitle eyebrow="OPERATIONS / STOCK CONTROL" title="Inventory management" description="Review the current inventory snapshot and inspect 90 days of clearly labelled synthetic stock history." action={<><button className="btn btn-secondary" onClick={exportCsv}><Download size={15}/> Export CSV</button><button className="btn btn-primary" onClick={openStock}><Plus size={16}/> Adjust stock</button></>}/>
    <section className="panel demand-panel" style={{ marginBottom: 18 }}>
      <div className="panel-heading"><div><div className="eyebrow">90-DAY INVENTORY HISTORY</div><h2>Historical stock trend</h2><p>Choose an item and location to inspect its simulated daily stock levels.</p></div><span className="notice-tag">SYNTHETIC DEMO</span></div>
      {inventoryHistoryLoading ? <EmptyState title="Loading inventory history" detail="Requesting the 90-day history from the backend."/> : inventoryHistoryError ? <EmptyState title="Inventory history unavailable" detail={inventoryHistoryError}/> : inventoryHistoryChart.length ? <>
        <div className="table-toolbar" style={{ padding: "0 0 12px" }}><div className="filter-select"><Package size={14}/><select aria-label="Select historical inventory item" value={historyItemId} onChange={(event) => setHistoryItemId(event.target.value)}>{historyItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><span className="record-count">{inventoryHistoryChart.length} daily records</span></div>
        <div className="chart-wrap" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={inventoryHistoryChart} margin={{ top: 8, right: 12, left: -18, bottom: 4 }}><CartesianGrid stroke="#28312b" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tick={{ fill: "#818b80", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28}/><YAxis tick={{ fill: "#818b80", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: "#171e19", border: "1px solid #344035", borderRadius: 10, color: "#e8ece6" }}/><Area type="monotone" dataKey="stock" name={`Stock (${selectedHistoryItem?.unit ?? "units"})`} stroke="#91a66b" fill="#91a66b" fillOpacity={0.16} strokeWidth={2} isAnimationActive animationDuration={900}/></AreaChart></ResponsiveContainer></div>
        <div className="chart-footnote"><Sparkles size={13}/> Synthetic demo history generated for illustration; this is not a verified record of actual stock movements.</div>
      </> : <EmptyState title="No history records" detail="The backend returned no historical records for the selected period."/>}
    </section>
    <div className="summary-strip"><div><span>Total tracked items</span><strong>{allInventory.length}</strong></div><div><span>Low-stock items</span><strong className="text-gold">{allInventory.filter(i => i.quantity <= i.reorderLevel).length}</strong></div><div><span>Categories</span><strong>{new Set(allInventory.map(i => i.category)).size}</strong></div><div><span>Demo locations</span><strong>{new Set(allInventory.map(i => i.location)).size}</strong></div></div>
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items, IDs, locations..." /></div><div className="toolbar-actions"><div className="filter-select"><Filter size={14}/><select value={filter} onChange={e => setFilter(e.target.value)}><option>All</option><option>Low stock</option>{Array.from(new Set(allInventory.map(i => i.category))).map(c => <option key={c}>{c}</option>)}</select></div><span className="record-count">{inventory.length} records</span></div></div><div className="table-scroll"><table><thead><tr><th>ITEM / IDENTIFIER</th><th>CATEGORY</th><th>AVAILABLE STOCK</th><th>REORDER LEVEL</th><th>LOCATION</th><th>STATUS</th></tr></thead><tbody>{inventory.map(i => { const low = i.quantity <= i.reorderLevel; return <tr key={i.id}><td><div className="item-cell"><div className="item-icon"><Package size={17}/></div><div><strong>{i.name}</strong><small>{i.id}</small></div></div></td><td><span className="category-pill">{i.category}</span></td><td><strong className={low ? "text-gold" : ""}>{i.quantity.toLocaleString()}</strong><span className="unit-label"> {i.unit}</span></td><td>{i.reorderLevel} <span className="unit-label">{i.unit}</span></td><td><span className="location-label">{i.location}</span></td><td><StatusBadge status={low ? "Low stock" : "Healthy"}/></td></tr>; })}</tbody></table>{inventory.length === 0 && <EmptyState title="No matching inventory" detail="Try another search term or remove filters."/>}</div><div className="table-footer"><span>Inventory records · Changes depend on the configured data source</span><span>Showing {inventory.length} of {allInventory.length}</span></div></section>
    <div className="info-callout"><CircleHelp size={16}/><span>Stock adjustments are local demo actions. Real inventory updates must be validated and persisted by the backend.</span></div>
  </>;
}

function RequestsPage({ requests, search, setSearch, filter, setFilter, openRequest, updateRequest }: {
  requests: SupplyRequest[]; search: string; setSearch: (s: string) => void; filter: string; setFilter: (s: string) => void; openRequest: () => void; updateRequest: (id: string, status: Status) => void
}) {
  const statuses = ["All", "Pending", "Approved", "Rejected", "Dispatched", "Received"];
  return <>
    <PageTitle eyebrow="OPERATIONS / REQUISITIONS" title="Supply requests" description="Manage the request lifecycle in a simulated workflow." action={<button className="btn btn-primary" onClick={openRequest}><Plus size={16}/> Create request</button>}/>
    <div className="request-summary">{statuses.slice(1, 4).map(s => <button key={s} className={`request-stat ${filter === s ? "selected" : ""}`} onClick={() => setFilter(filter === s ? "All" : s)}><span>{s}</span><strong>{requests.filter(r => r.status === s).length}</strong></button>)}</div>
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search request ID, item or requester..." /></div><div className="toolbar-actions"><div className="filter-select"><Filter size={14}/><select value={filter} onChange={e => setFilter(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></div><span className="record-count">{requests.length} records</span></div></div><div className="table-scroll"><table><thead><tr><th>REQUEST</th><th>ITEM</th><th>QUANTITY</th><th>PRIORITY</th><th>REQUESTED BY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{requests.map(r => <tr key={r.id}><td><strong>{r.id}</strong><small className="cell-sub">{r.createdAt}</small></td><td><strong>{r.itemName}</strong><small className="cell-sub">{r.itemId}</small></td><td>{r.quantity}</td><td><PriorityBadge priority={r.priority}/></td><td>{r.requestedBy}</td><td><StatusBadge status={r.status}/></td><td><div className="row-actions">{r.status === "Pending" && <><button className="mini-action approve" title="Approve request" onClick={() => updateRequest(r.id, "Approved")}><Check size={14}/></button><button className="mini-action reject" title="Reject request" onClick={() => updateRequest(r.id, "Rejected")}><X size={14}/></button></>}{r.status === "Approved" && <button className="btn btn-mini" onClick={() => updateRequest(r.id, "Dispatched")}><Send size={13}/> Dispatch</button>}{!["Pending", "Approved"].includes(r.status) && <span className="muted-dash">—</span>}</div></td></tr>)}</tbody></table>{requests.length === 0 && <EmptyState title="No matching requests" detail="Create a request or adjust your filters."/>}</div><div className="table-footer"><span>Demo workflow · Actions update local application state</span><span>{requests.length} requests</span></div></section>
    <div className="info-callout"><AlertTriangle size={16}/><span>Dispatching an approved request creates a simulated shipment and reduces demo stock. No real supply movement occurs.</span></div>
  </>;
}

function ShipmentsPage({ shipments, search, setSearch, filter, setFilter, updateShipment }: {
  shipments: Shipment[]; search: string; setSearch: (s: string) => void; filter: string; setFilter: (s: string) => void; updateShipment: (s: Shipment, status: Status, receivedQty?: number) => void
}) {
  const statuses = ["All", "In Transit", "Delivered", "Delayed", "Received"];
  return <>
    <PageTitle eyebrow="OPERATIONS / DISTRIBUTION" title="Shipment management" description="Monitor fictional dispatches and record delivery confirmation."/>
    <div className="shipment-cards"><div className="mini-metric"><Truck size={18}/><span>In transit</span><strong>{shipments.filter(s => s.status === "In Transit").length}</strong></div><div className="mini-metric"><CheckCircle2 size={18}/><span>Delivered</span><strong>{shipments.filter(s => s.status === "Delivered" || s.status === "Received").length}</strong></div><div className="mini-metric warning"><Clock3 size={18}/><span>Delayed</span><strong>{shipments.filter(s => s.status === "Delayed").length}</strong></div></div>
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shipment, item or destination..." /></div><div className="toolbar-actions"><div className="filter-select"><Filter size={14}/><select value={filter} onChange={e => setFilter(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></div><span className="record-count">{shipments.length} records</span></div></div><div className="table-scroll"><table><thead><tr><th>SHIPMENT</th><th>SUPPLY</th><th>ROUTE (DEMO)</th><th>ETA</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{shipments.map(s => <tr key={s.id}><td><strong>{s.id}</strong><small className="cell-sub">Request {s.requestId}</small></td><td><strong>{s.itemName}</strong><small className="cell-sub">{s.quantity} units</small></td><td><div className="route-cell"><span>{s.origin}</span><ArrowRight size={13}/><span>{s.destination}</span></div></td><td>{s.eta}</td><td><StatusBadge status={s.status}/></td><td>{s.status === "In Transit" || s.status === "Delivered" ? <div className="row-actions">{s.status === "In Transit" && <button className="btn btn-mini" onClick={() => updateShipment(s, "Delivered")}><PackageCheck size={13}/> Delivered</button>}<button className="mini-action" title="Confirm receipt" onClick={() => { const raw = window.prompt(`Received quantity (dispatched: ${s.quantity})`, String(s.quantity)); if (raw !== null) { const qty = Number(raw); if (Number.isInteger(qty) && qty >= 0 && qty <= s.quantity) updateShipment(s, "Received", qty); else window.alert("Enter a whole number from 0 to the dispatched quantity."); } }}><Check size={14}/></button></div> : <span className="muted-dash">—</span>}</td></tr>)}</tbody></table>{shipments.length === 0 && <EmptyState title="No matching shipments" detail="Try another filter or search term."/>}</div><div className="table-footer"><span>Routes and destinations are fictional demonstration data.</span><span>{shipments.length} shipments</span></div></section>
    <div className="info-callout"><PackageCheck size={16}/><span>Use “Delivered” to update shipment status, or the check icon to record the received quantity and capture a discrepancy.</span></div>
  </>;
}

function StorageAlertsPage({ inventory, lowStock }: { inventory: InventoryItem[]; lowStock: InventoryItem[] }) {
  const locationAlerts = Array.from(new Set(inventory.map(item => item.location))).map(location => {
    const items = inventory.filter(item => item.location === location && item.quantity <= item.reorderLevel);
    return { location, count: items.length, total: items.reduce((sum, item) => sum + item.quantity, 0) };
  }).filter(entry => entry.count > 0);

  return <>
    <PageTitle eyebrow="OPERATIONS / STORAGE ALERTS" title="Storage alerts" description="Track low-stock, at-risk storage points, and inventory pressure across the demo network."/>
    <div className="summary-strip"><div><span>Critical alerts</span><strong className="text-gold">{lowStock.length}</strong></div><div><span>Sites affected</span><strong>{locationAlerts.length}</strong></div><div><span>At-risk volume</span><strong>{lowStock.reduce((sum, item) => sum + item.quantity, 0)}</strong></div><div><span>Demo coverage</span><strong>{Math.max(0, 100 - Math.round((lowStock.length / inventory.length) * 100))}%</strong></div></div>
    <div className="dashboard-grid">
      <section className="panel demand-panel">
        <div className="panel-heading"><div><div className="eyebrow">ALERT WATCH</div><h2>Current storage risk</h2><p>Items at or below their reorder threshold</p></div></div>
        {lowStock.length ? <div className="alert-list">{lowStock.map(item => <div className="alert-row" key={item.id}><div className="alert-symbol"><AlertTriangle size={16}/></div><div className="alert-copy"><strong>{item.name}</strong><span>{item.location} · {item.category}</span></div><div className="alert-quantity"><strong>{item.quantity}</strong><span>{item.unit} on hand</span></div></div>)}</div> : <EmptyState title="No storage alerts" detail="All tracked items are comfortably above their thresholds."/>}
      </section>
      <section className="panel stock-panel">
        <div className="panel-heading"><div><div className="eyebrow">DEPOT LEVEL</div><h2>Site pressure</h2><p>Locations with inventory below demo thresholds</p></div></div>
        {locationAlerts.length ? <div className="activity-list report-activity">{locationAlerts.map(entry => <div className="activity-row" key={entry.location}><div className="activity-symbol warning"><AlertTriangle size={15}/></div><div className="activity-copy"><strong>{entry.location}</strong><span>{entry.count} item(s) below threshold</span><small>{entry.total} units flagged</small></div></div>)}</div> : <EmptyState title="Stable sites" detail="No matches at current thresholds."/>}
      </section>
    </div>
    <div className="info-callout"><ShieldCheck size={16}/><span>Storage alerts are UX notifications for demonstration review only and do not trigger live operational actions.</span></div>
  </>;
}

function ReplenishmentLogin({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onLogin(username.trim(), password); }
    catch { setError("Authorization failed. Check your officer credentials and try again."); }
    finally { setBusy(false); }
  };
  return <div style={{ maxWidth: 620, margin: "5vh auto", padding: 28 }}>
    <section className="panel" style={{ padding: 30, border: "1px solid rgba(195,170,112,.35)", background: "linear-gradient(145deg, rgba(29,39,28,.96), rgba(13,18,14,.98))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div style={{ width: 54, height: 54, borderRadius: 14, display: "grid", placeItems: "center", color: "#c3aa70", background: "rgba(195,170,112,.12)" }}><ShieldCheck size={28}/></div>
        <div><div className="eyebrow">RESTRICTED OPERATIONS</div><h2 style={{ margin: "5px 0" }}>Officer authorization</h2><p style={{ margin: 0, color: "#9ca99a" }}>Sign in to access replenishment planning.</p></div>
      </div>
      <div className="info-callout" style={{ marginBottom: 22 }}><ShieldCheck size={16}/><span>Access is limited to the configured demo officer account. This prototype uses backend authentication and does not require a user database.</span></div>
      <form className="form-body" onSubmit={submit}>
        <label>Officer username<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter authorized username"/></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password"/></label>
        {error && <div role="alert" style={{ color: "#ef9b91", fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}><ShieldCheck size={16}/>{busy ? "Verifying credentials…" : "Authorize access"}</button>
      </form>
      <p style={{ margin: "18px 0 0", color: "#788477", fontSize: 11, textAlign: "center", letterSpacing: ".08em" }}>DEMO ENVIRONMENT · SYNTHETIC LOGISTICS DATA</p>
    </section>
  </div>;
}

function ReplenishmentPage({
  inventory,
  backendReplenishment,
  openRequest,
}: {
  inventory: InventoryItem[];
  backendReplenishment: ReplenishmentRecommendation[];
  openRequest: () => void;
}) {
 const replenishmentPlan: (InventoryItem & { suggestedQty: number; deficit: number })[] =
  backendReplenishment.length > 0
    ? backendReplenishment.map((item) => {
        const inventoryItem = inventory.find(
          (entry) => entry.location === item.unit_id
        );

        return {
          ...(inventoryItem ?? {
            id: item.unit_id,
            name: `Food stock - ${item.unit_id}`,
            category: "Food & Rations",
            quantity: item.current_stock_kg,
            unit: "kg",
            reorderLevel: item.daily_consumption_kg * 3,
            location: item.unit_id,
          }),
          suggestedQty: item.recommended_replenishment_kg,
          deficit: Math.max(
            item.recommended_replenishment_kg,
            0
          ),
        };
      })
        .filter((item) => item.suggestedQty > 0)
        .sort((a, b) => b.suggestedQty - a.suggestedQty)
    : inventory
        .map((item) => ({
          ...item,
          suggestedQty: Math.max(
            item.reorderLevel * 2 - item.quantity,
            0
          ),
          deficit: Math.max(
            item.reorderLevel - item.quantity,
            0
          ),
        }))
        .filter((item) => item.suggestedQty > 0)
        .sort((a, b) => b.suggestedQty - a.suggestedQty);
  const totalRecommended = replenishmentPlan.reduce(
    (sum, item) => sum + item.suggestedQty,
    0
  );

  return (
    <>
      <PageTitle
        eyebrow="OPERATIONS / REPLENISHMENT"
        title="Replenishment"
        description="Review suggested restock volumes based on current stock levels."
      />
      <div className="summary-strip">
        <div>
          <span>Items to reorder</span>
          <strong className="text-gold">{replenishmentPlan.length}</strong>
        </div>
        <div>
          <span>Recommended units</span>
          <strong>{totalRecommended.toLocaleString()}</strong>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">REPLENISHMENT PLAN</div>
            <h2>Suggested restock by item</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th>Current stock</th>
                <th>Suggested quantity</th>
              </tr>
            </thead>
            <tbody>
              {replenishmentPlan.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.location}</td>
                  <td>{item.quantity} {item.unit}</td>
                  <td>{item.suggestedQty} {item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AnalyticsPage({ inventory, lowStock }: { inventory: InventoryItem[]; lowStock: InventoryItem[] }) {
  const [historyRecords, setHistoryRecords] = useState<SyntheticHistoryRecord[]>([]);
  const [deliveryRecords, setDeliveryRecords] = useState<SyntheticDeliveryRecord[]>([]);
  const [shortageRecords, setShortageRecords] = useState<SyntheticShortageRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSyntheticHistory({ days: 90 }),
      fetchSyntheticDeliveryHistory(90),
      fetchSyntheticShortageHistory(90),
    ]).then(([history, deliveries, shortages]) => {
      if (cancelled) return;
      setHistoryRecords(history.records);
      setDeliveryRecords(deliveries);
      setShortageRecords(shortages);
      setHistoryError("");
    }).catch((error: unknown) => {
      if (cancelled) return;
      setHistoryError(error instanceof Error ? error.message : "Unable to load 90-day history.");
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const historyChartData = useMemo(() => {
    const days = new globalThis.Map<string, { date: string; inventoryRecords: number; shortageEvents: number; deliveryEvents: number }>();
    const getDay = (date: string) => {
      if (!days.has(date)) days.set(date, { date, inventoryRecords: 0, shortageEvents: 0, deliveryEvents: 0 });
      return days.get(date)!;
    };
    historyRecords.forEach((record) => {
      const day = getDay(record.date);
      day.inventoryRecords += 1;
    });
    shortageRecords.forEach((record) => {
      getDay(record.date).shortageEvents += 1;
    });
    deliveryRecords.forEach((record) => {
      getDay(record.date).deliveryEvents += 1;
    });
    return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [historyRecords, deliveryRecords, shortageRecords]);
  const [catalogForecasts, setCatalogForecasts] = useState<CatalogForecast[]>([]);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState("");
  const [forecastMethod, setForecastMethod] = useState("Backend forecast");
  const [forecastSource, setForecastSource] = useState("SYNTHETIC_DEMO");
  const [forecastHorizon, setForecastHorizon] = useState(7);

  useEffect(() => {
    let cancelled = false;
    setForecastLoading(true);
    fetchCatalogForecasts()
      .then((result) => {
        if (cancelled) return;
        setCatalogForecasts(result.forecasts);
        setForecastMethod(result.method || "Backend forecast");
        setForecastSource(result.data_source || "Backend");
        setForecastHorizon(result.horizon_days || 7);
        setForecastError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setForecastError(error instanceof Error ? error.message : "Unable to load forecasts.");
      })
      .finally(() => {
        if (!cancelled) setForecastLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const forecastCount = catalogForecasts.length;
  const warningCount = catalogForecasts.filter((item) => item.risk_level.toUpperCase() === "WARNING").length;
  const normalCount = catalogForecasts.filter((item) => item.risk_level.toUpperCase() === "NORMAL").length;
  const totalForecastDemand = catalogForecasts.reduce((sum, item) => sum + (Number(item.estimated_horizon_demand) || 0), 0);
  const totalCurrentStock = catalogForecasts.reduce((sum, item) => sum + (Number(item.current_stock) || 0), 0);
  const forecastChartData = catalogForecasts.map((item) => ({
    name: `${item.item_name} · ${item.unit_id.replace("SIM-UNIT-", "Unit ")}`,
    item: item.item_name,
    unit: item.unit_id,
    stock: Number(item.current_stock) || 0,
    demand: Number(item.estimated_horizon_demand) || 0,
    projectedStock: Number(item.estimated_stock_after_horizon) || 0,
    risk: item.risk_level,
  }));

  return <>
    <PageTitle eyebrow="INTELLIGENCE / PLANNING" title="Predictive analytics" description="Backend-generated demand estimates and projected stock-risk indicators for the demo dataset."/>
    <div className="notice-banner"><div className="notice-icon"><Sparkles size={18}/></div><div><strong>{forecastLoading ? "Loading backend forecasts" : forecastError ? "Forecast service unavailable" : "Backend forecast connected"}</strong><p>{forecastLoading ? "Requesting the latest catalog forecast from the FastAPI backend…" : forecastError ? `Could not load the forecast: ${forecastError}` : `Source: ${forecastSource} · Method: ${forecastMethod}. These are synthetic demo estimates, not validated operational advice.`}</p></div><span className="notice-tag">{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : "API FORECAST"}</span></div>

    <div className="kpi-grid three-kpis">
      <div className="kpi-card static"><div className="kpi-top"><span>Forecast horizon</span><span className="kpi-icon green"><BarChart3 size={17}/></span></div><div className="kpi-value">{forecastHorizon} <small>days</small></div><div className="kpi-foot"><span className="kpi-context">Backend planning window</span></div></div>
      <div className="kpi-card static"><div className="kpi-top"><span>Forecasted records</span><span className="kpi-icon gold"><ArrowUpRight size={17}/></span></div><div className="kpi-value">{forecastLoading ? "—" : forecastCount.toString().padStart(2, "0")}</div><div className="kpi-foot"><span className="kpi-context">{forecastLoading ? "Loading records" : `${warningCount} flagged · ${normalCount} normal`}</span></div></div>
      <div className="kpi-card static"><div className="kpi-top"><span>Projected demand</span><span className="kpi-icon purple"><AlertTriangle size={17}/></span></div><div className="kpi-value">{forecastLoading ? "—" : totalForecastDemand.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div><div className="kpi-foot"><span className="kpi-context">Sum of forecast units; item units may differ</span></div></div>
    </div>

    <div className="dashboard-grid">
      <section className="panel demand-panel"><div className="panel-heading"><div><div className="eyebrow">BACKEND DEMAND FORECAST</div><h2>Stock vs. forecast demand</h2><p>Current stock compared with estimated demand over {forecastHorizon} days</p></div></div>
        {forecastLoading ? <EmptyState title="Loading forecasts" detail="Waiting for the FastAPI catalog forecast endpoint."/> : forecastError ? <EmptyState title="Forecast data unavailable" detail="Check that the backend is running and /api/forecast/catalog?horizon_days=7 is responding."/> : forecastChartData.length ? <><div className="chart-legend"><span><i className="legend-dot actual"/> Current stock</span><span><i className="legend-dot forecast"/> Forecast demand</span></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={forecastChartData} margin={{ top: 10, right: 10, left: -18, bottom: 40 }}><CartesianGrid stroke="#28312b" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="name" tick={{ fill: "#818b80", fontSize: 10 }} axisLine={false} tickLine={false} angle={-28} textAnchor="end" interval={0}/><YAxis tick={{ fill: "#818b80", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: "#171e19", border: "1px solid #344035", borderRadius: 10, color: "#e8ece6" }}/><Bar dataKey="stock" name="Current stock" fill="#91a66b" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1000}/><Bar dataKey="demand" name="Forecast demand" fill="#c3aa70" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1200}/></BarChart></ResponsiveContainer></div><div className="chart-footnote"><Sparkles size={13}/> {forecastMethod} · Current stock total: {totalCurrentStock.toLocaleString(undefined, { maximumFractionDigits: 1 })} (units may differ by item).</div></> : <EmptyState title="No forecast records" detail="The backend responded, but the forecast list was empty."/>}
      </section>
      <section className="panel"><div className="panel-heading"><div><div className="eyebrow">PROJECTED STOCK RISK</div><h2>Items to review</h2><p>Based on backend projected stock after the forecast horizon</p></div></div>
        {forecastLoading ? <EmptyState title="Loading risk indicators" detail="Risk indicators appear when the forecast arrives."/> : forecastError ? <EmptyState title="Risk indicators unavailable" detail="Forecast data could not be loaded."/> : catalogForecasts.filter(item => item.risk_level.toUpperCase() !== "NORMAL" || item.estimated_stock_after_horizon < 0).length ? <div className="alert-list">{catalogForecasts.filter(item => item.risk_level.toUpperCase() !== "NORMAL" || item.estimated_stock_after_horizon < 0).slice(0, 6).map(item => <div className="alert-row" key={`${item.unit_id}-${item.item_id}`}><div className="alert-symbol"><AlertTriangle size={16}/></div><div className="alert-copy"><strong>{item.item_name}</strong><span>{item.location} · {item.risk_level} · {item.days_of_cover} days of cover</span></div><div className="alert-quantity"><strong>{item.estimated_stock_after_horizon.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><span>{item.unit} projected</span></div></div>)}</div> : <EmptyState title="No forecast risk flags" detail="The backend did not return any flagged forecast items."/>}
        <div className="chart-footnote">{lowStock.length} local inventory threshold alert(s) are also present. Backend forecast data is synthetic demonstration data.</div>
      </section>
    </div>

    <section className="panel demand-panel" style={{ marginBottom: 20 }}>
      <div className="panel-heading"><div><div className="eyebrow">90-DAY SYNTHETIC HISTORY</div><h2>Inventory, shortages & deliveries</h2><p>Daily event counts generated for demonstration; not real operational records.</p></div><span className="notice-tag">SYNTHETIC DEMO</span></div>
      {historyLoading ? <EmptyState title="Loading 90-day history" detail="Fetching inventory, delivery, and shortage records from FastAPI."/> : historyError ? <EmptyState title="History data unavailable" detail={`Check the three /api/history endpoints. ${historyError}`}/> : historyChartData.length ? <>
        <div className="chart-legend"><span><i className="legend-dot actual"/> Inventory records</span><span><i className="legend-dot forecast"/> Shortage events</span><span><i className="legend-dot" style={{ background: "#6d8f80" }}/> Delivery events</span></div>
        <div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><AreaChart data={historyChartData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#28312b" strokeDasharray="3 5" vertical={false}/>
          <XAxis dataKey="date" tick={{ fill: "#818b80", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28}/>
          <YAxis allowDecimals={false} tick={{ fill: "#818b80", fontSize: 11 }} axisLine={false} tickLine={false}/>
          <Tooltip contentStyle={{ background: "#171e19", border: "1px solid #344035", borderRadius: 10, color: "#e8ece6", fontSize: 12 }}/>
          <Area type="monotone" dataKey="inventoryRecords" name="Inventory records" stroke="#91a66b" fill="#91a66b" fillOpacity={0.13} strokeWidth={2} isAnimationActive animationDuration={900}/>
          <Area type="monotone" dataKey="shortageEvents" name="Shortage events" stroke="#c3aa70" fill="#c3aa70" fillOpacity={0.10} strokeWidth={2} isAnimationActive animationDuration={1100}/>
          <Area type="monotone" dataKey="deliveryEvents" name="Delivery events" stroke="#6d8f80" fill="#6d8f80" fillOpacity={0.10} strokeWidth={2} isAnimationActive animationDuration={1300}/>
        </AreaChart></ResponsiveContainer></div>
        <div className="summary-strip">
          <div><span>History records</span><strong>{historyRecords.length.toLocaleString()}</strong></div>
          <div><span>Simulated deliveries</span><strong>{deliveryRecords.length.toLocaleString()}</strong></div>
          <div><span>Shortage records</span><strong className="text-gold">{shortageRecords.length.toLocaleString()}</strong></div>
          <div><span>History window</span><strong>90 days</strong></div>
        </div>
      </> : <EmptyState title="No history records" detail="The history APIs returned no records for this window."/>}
      <div className="chart-footnote"><Sparkles size={13}/> All historical records and delivery events are synthetic demonstration data. Counts are events, not actual stock quantities.</div>
    </section>

    <section className="panel table-panel analytics-table"><div className="panel-heading"><div><div className="eyebrow">CATALOG FORECAST DETAILS</div><h2>Projected stock by item and unit</h2><p>Current stock, forecast demand, and expected remaining stock</p></div></div><div className="table-scroll"><table><thead><tr><th>ITEM / UNIT</th><th>CURRENT STOCK</th><th>DAILY DEMAND</th><th>{forecastHorizon}-DAY DEMAND</th><th>PROJECTED STOCK</th><th>COVER</th><th>RISK</th></tr></thead><tbody>{catalogForecasts.map(item => <tr key={`${item.unit_id}-${item.item_id}`}><td><strong>{item.item_name}</strong><small className="cell-sub">{item.location} · {item.unit_id}</small></td><td>{item.current_stock.toLocaleString()} {item.unit}</td><td>{item.estimated_daily_demand.toLocaleString()} {item.unit}</td><td>{item.estimated_horizon_demand.toLocaleString()} {item.unit}</td><td className={item.estimated_stock_after_horizon < 0 ? "text-gold" : ""}>{item.estimated_stock_after_horizon.toLocaleString()} {item.unit}</td><td>{item.days_of_cover.toLocaleString()} days</td><td><StatusBadge status={item.risk_level}/></td></tr>)}</tbody></table>{!forecastLoading && !forecastError && catalogForecasts.length === 0 && <EmptyState title="No forecast records" detail="No catalog forecast records were returned."/>}</div><div className="table-footer"><span>Forecast source: {forecastSource} · {forecastMethod}</span><span>{forecastCount} records</span></div></section>
  </>;
}

function NetworkPage({ shipments, inventory }: { shipments: Shipment[]; inventory: InventoryItem[] }) {
  const nodes = [{ id: "A", name: "Cedar Hub", x: 16, y: 25, detail: `${inventory.filter(i => i.location === "Cedar Hub").length} tracked items` }, { id: "B", name: "Maple Hub", x: 17, y: 73, detail: `${inventory.filter(i => i.location === "Maple Hub").length} tracked items` }, { id: "C", name: "Pine Hub", x: 50, y: 50, detail: `${inventory.filter(i => i.location === "Pine Hub").length} tracked items` }, { id: "D", name: "Demo Team East", x: 83, y: 26, detail: "Fictional receiving point" }, { id: "E", name: "Demo Team Central", x: 82, y: 73, detail: "Fictional receiving point" }];
  return <>
    <PageTitle eyebrow="INTELLIGENCE / NETWORK" title="Supply network" description="A fictional network diagram for demonstrating logistics visibility."/>
    <div className="notice-banner"><div className="notice-icon"><Map size={18}/></div><div><strong>Schematic view</strong><p>Nodes and connections are illustrative and do not represent real military geography or routes.</p></div><span className="notice-tag">SYNTHETIC</span></div>
    <section className="panel network-panel"><div className="panel-heading"><div><div className="eyebrow">NETWORK VISUALISATION</div><h2>Supply point connections</h2><p>Conceptual node-and-link diagram</p></div><div className="network-legend"><span><i className="network-key depot"/>Supply point</span><span><i className="network-key unit"/>Receiving point</span></div></div><div className="network-canvas"><svg className="network-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#667a58"/></marker></defs><path d="M18 27 L48 49" markerEnd="url(#arrow)"/><path d="M19 72 L48 52" markerEnd="url(#arrow)"/><path d="M52 49 L81 27" markerEnd="url(#arrow)"/><path d="M52 52 L80 72" markerEnd="url(#arrow)"/></svg>{nodes.map(n => <div key={n.id} className={`network-node ${n.id === "D" || n.id === "E" ? "receiving" : ""}`} style={{ left: `${n.x}%`, top: `${n.y}%` }}><div className="network-node-icon">{n.id === "D" || n.id === "E" ? <PackageCheck size={18}/> : <Boxes size={18}/>}</div><strong>{n.name}</strong><span>{n.detail}</span></div>)}</div><div className="network-foot"><span><span className="live-dot"/> {shipments.filter(s => s.status === "In Transit").length} shipment(s) currently in transit in demo</span><span>Diagram is not geographic or to scale</span></div></section>
    <div className="shipment-cards"><div className="mini-metric"><Boxes size={18}/><span>Supply points</span><strong>03</strong></div><div className="mini-metric"><PackageCheck size={18}/><span>Receiving points</span><strong>02</strong></div><div className="mini-metric"><Truck size={18}/><span>Active demo shipments</span><strong>{shipments.filter(s => s.status === "In Transit").length}</strong></div></div>
  </>;
}

function ReportsPage({ inventory, requests, shipments, activities, exportCsv, resetDemo }: { inventory: InventoryItem[]; requests: SupplyRequest[]; shipments: Shipment[]; activities: Activity[]; exportCsv: () => void; resetDemo: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const reportRows = [
    { label: "Inventory items", value: inventory.length, detail: "Tracked demo records", icon: Boxes },
    { label: "Supply requests", value: requests.length, detail: "All recorded statuses", icon: ClipboardList },
    { label: "Shipments", value: shipments.length, detail: "All recorded shipments", icon: Truck },
    { label: "Activity events", value: activities.length, detail: "Recent local event log", icon: ActivityIcon }
  ];
  return <>
    <PageTitle eyebrow="SYSTEM / REPORTING" title="Reports & activity" description="Review the current local demo state and export sample inventory data." action={<button className="btn btn-primary" onClick={exportCsv}><Download size={16}/> Export inventory CSV</button>}/>
    <div className="report-grid">{reportRows.map(r => { const Icon = r.icon; return <div className="report-card" key={r.label}><div className="report-icon"><Icon size={18}/></div><span>{r.label}</span><strong>{r.value.toString().padStart(2, "0")}</strong><small>{r.detail}</small></div>; })}</div>
    <section className="panel table-panel"><div className="panel-heading"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Recent activity</h2><p>Events created in this browser demo</p></div></div><div className="activity-list report-activity">{activities.map(a => <div className="activity-row" key={a.id}><div className={`activity-symbol ${a.kind}`}>{a.kind === "success" ? <CheckCircle2 size={15}/> : a.kind === "warning" ? <AlertTriangle size={15}/> : <ActivityIcon size={15}/>}</div><div className="activity-copy"><strong>{a.title}</strong><span>{a.description}</span><small>{a.time}</small></div><span className="activity-id">{a.id}</span></div>)}</div></section>
    <section className="panel reset-panel"><div><h2>Demo data controls</h2><p>Reset locally stored inventory, requests, shipments and activity to their original fictional sample records.</p></div>{confirmReset ? <div className="row-actions"><button className="btn btn-secondary" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn btn-danger" onClick={() => { resetDemo(); setConfirmReset(false); }}>Confirm reset</button></div> : <button className="btn btn-secondary" onClick={() => setConfirmReset(true)}>Reset demo data</button>}</section>
    <div className="info-callout"><ShieldCheck size={16}/><span>This audit trail is a local prototype feature. Production audit logs and access controls must be implemented by the backend.</span></div>
  </>;
}
