import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Filter,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Package,
  Plus,
  Radio,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Target,
  Trash2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  adminLogin,
  adminSetup,
  adminStatus,
  changeAdminPin,
  getAdminSnapshot,
  saveAdminSettings,
  seedAdminDemo,
  testMetaConnection,
  testUtmifyConnection,
  updateAdminOrder,
} from "@/lib/admin-api";
import {
  PERIODS,
  PIXEL_KINDS,
  buildAbandonedCarts,
  buildCampaigns,
  buildFunnel,
  buildLiveSessions,
  defaultSettings,
  inPeriod,
  listPixelItems,
  mergePixelSecrets,
  money,
  newPixelItem,
  normalizePixels,
  orderStatus,
  pixelKindLabel,
  relativeTime,
  sourceLabel,
  statusLabel,
  type AdminSettings,
  type AdminSnapshot,
  type Period,
  type PixelItem,
  type PixelKind,
} from "@/lib/admin";
import { loadLocalEvents } from "@/lib/tracking";
import { customerName, emptyCheckout, loadOrders, type OrderSummary } from "@/lib/checkout";
import { formatBRL, products } from "@/lib/products";
import { cn } from "@/lib/utils";
import {
  TOKEN_KEY,
  loadLocalPresence,
  loadLocalSettings,
  localChangePin,
  localCheckPin,
  localHasPin,
  pinSessionToken,
  saveLocalSettings,
  seedLocalDemo,
} from "@/lib/admin-local";
import { UTMIFY_PIXEL_ID } from "@/lib/utmify-pixel";
import { LiveView } from "@/components/admin/LiveView";
import { AbandonedCarts } from "@/components/admin/AbandonedCarts";

type Tab =
  | "visao"
  | "live"
  | "pedidos"
  | "carrinhos"
  | "funil"
  | "trafego"
  | "produtos"
  | "pixels"
  | "utmify"
  | "config";

const tabs: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: "visao", label: "Visão geral", icon: LayoutDashboard },
  { id: "live", label: "Live view", icon: Radio },
  { id: "pedidos", label: "Pedidos", icon: ShoppingBag },
  { id: "carrinhos", label: "Carrinhos", icon: ShoppingCart },
  { id: "funil", label: "Progresso", icon: Filter },
  { id: "trafego", label: "Tráfego / UTMs", icon: Megaphone },
  { id: "produtos", label: "Produtos", icon: Package },
  { id: "pixels", label: "Pixels", icon: Target },
  { id: "utmify", label: "UTMify", icon: Activity },
  { id: "config", label: "Configurações", icon: Settings },
];

export function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("visao");
  const [period, setPeriod] = useState<Period>("tudo");
  const [snap, setSnap] = useState<AdminSnapshot | null>(null);
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    setHasPin(localHasPin());
    if (saved) setToken(saved);
    void adminStatus()
      .then((status) => {
        if (status.hasPin) setHasPin(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let settingsLoaded = false;
    setSettings(loadLocalSettings());
    const pull = async () => {
      const local = mergeLocal({
        settings: loadLocalSettings(),
        events: [],
        orders: [],
        visitors: [],
      });
      if (!cancelled) setSnap((prev) => prev ?? local);
      try {
        const localToken = loadLocalSettings().utmfy?.apiToken ?? "";
        const next = await getAdminSnapshot({
          data: {
            token,
            utmfyToken: localToken && !localToken.includes("•") ? localToken : undefined,
          },
        });
        if (cancelled) return;
        setSnap(mergeLocal(next));
        const mergedSettings = keepTypedSecrets(loadLocalSettings(), next.settings);
        setSettings((prev) => {
          const prevCount = listPixelItems(prev.pixels).length;
          const nextCount = listPixelItems(mergedSettings.pixels).length;
          if (!settingsLoaded) {
            settingsLoaded = true;
            const merged = keepTypedSecrets(prev, mergedSettings);
            saveLocalSettings(merged);
            return merged;
          }
          if (prevCount === 0 && nextCount > 0) {
            saveLocalSettings({ ...prev, pixels: mergedSettings.pixels });
            return { ...prev, pixels: mergedSettings.pixels };
          }
          return prev;
        });
      } catch {
        if (!cancelled) setSnap((prev) => prev ?? local);
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  const submitAuth = async () => {
    setBusy(true);
    setAuthError("");
    try {
      const ok = await localCheckPin(pin);
      if (!ok) throw new Error("Senha incorreta.");
      let tokenValue = "";
      try {
        const server = hasPin
          ? await adminLogin({ data: { pin } }).catch(() => adminSetup({ data: { pin } }))
          : await adminSetup({ data: { pin } }).catch(() => adminLogin({ data: { pin } }));
        tokenValue = server?.token ?? "";
      } catch {
        tokenValue = "";
      }
      if (!tokenValue) tokenValue = await pinSessionToken(pin);
      sessionStorage.setItem(TOKEN_KEY, tokenValue);
      setHasPin(true);
      setToken(tokenValue);
      setPin("");
      setSettings(loadLocalSettings());
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="dark flex min-h-dvh items-center justify-center bg-[#070b14] px-4 text-white">
        <form
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#10182a] p-6 shadow-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAuth();
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#E0B761]">
            Backoffice
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Admin da loja</h1>
          <p className="mt-2 text-sm text-white/60">
            {hasPin
              ? "Digite a senha para ver pedidos, live view e pixels."
              : "Crie uma senha agora. Ela protege o painel neste servidor."}
          </p>
          <input
            type="password"
            value={pin}
            minLength={4}
            placeholder="Senha (mín. 4)"
            onChange={(e) => setPin(e.target.value)}
            className="mt-6 h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-[16px] outline-none focus:border-[#E0B761]"
          />
          {authError && <p className="mt-2 text-sm text-red-400">{authError}</p>}
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="mt-5 h-12 w-full rounded-xl bg-[#E0B761] text-sm font-semibold text-[#001E62] disabled:opacity-50"
          >
            {busy ? "Entrando..." : hasPin ? "Entrar" : "Criar senha e entrar"}
          </button>
        </form>
      </div>
    );
  }

  const events = snap?.events ?? [];
  const orders = snap?.orders ?? [];
  const visitors = snap?.visitors ?? [];
  const scopedEvents = events.filter((event) => inPeriod(event.ts, period));
  const scopedOrders = orders.filter((order) => inPeriod(order.createdAt, period));
  const liveSessions = buildLiveSessions(scopedEvents, scopedOrders, visitors, Date.now(), period);
  const abandoned = buildAbandonedCarts(scopedEvents, scopedOrders, visitors);
  const abandonedValue = abandoned.reduce((acc, cart) => acc + cart.value, 0);
  const onlineNow = liveSessions.filter((session) => session.online).length;
  const paid = scopedOrders.filter((order) => orderStatus(order) === "paid");
  const pending = scopedOrders.filter((order) => orderStatus(order) === "pending");
  const revenue = paid.reduce((acc, order) => acc + order.total, 0);
  const pixRevenue = pending.reduce((acc, order) => acc + order.total, 0);
  const sessions = new Set(scopedEvents.map((event) => event.sessionId)).size;
  const conv = sessions ? (paid.length / sessions) * 100 : 0;

  return (
    <div className="dark min-h-dvh bg-[#070b14] text-white">
      <div className="flex min-h-dvh">
        <aside className="hidden w-60 shrink-0 border-r border-white/10 bg-[#0c1322] lg:flex lg:flex-col">
          <div className="border-b border-white/10 px-5 py-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#E0B761]">
              Admin
            </p>
            <h1 className="mt-1 text-lg font-semibold">{settings.storeName || "Loja"}</h1>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px]",
                  tab === item.id ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {item.id === "live" && onlineNow > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-500/20 px-1.5 text-[10px] text-emerald-300">
                    {onlineNow}
                  </span>
                )}
                {item.id === "pedidos" && pending.length > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
                    {pending.length}
                  </span>
                )}
                {item.id === "carrinhos" && abandoned.length > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
                    {abandoned.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem(TOKEN_KEY);
              setToken(null);
            }}
            className="m-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/50 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 lg:px-6">
            <div className="flex items-center gap-2 text-sm text-white/60">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              {onlineNow} online
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PERIODS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px]",
                    period === item.id ? "bg-white text-[#070b14]" : "bg-white/8 text-white/60 hover:bg-white/12",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <select
              value={tab}
              onChange={(e) => setTab(e.target.value as Tab)}
              className="rounded-lg border border-white/10 bg-[#10182a] px-3 py-2 text-sm lg:hidden"
            >
              {tabs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </header>

          <main className="flex-1 overflow-x-clip p-4 lg:p-6">
            {tab === "visao" && (
              <Overview
                sessions={sessions}
                revenue={revenue}
                pixRevenue={pixRevenue}
                paid={paid.length}
                pending={pending.length}
                conv={conv}
                abandoned={abandoned.length}
                abandonedValue={abandonedValue}
                events={scopedEvents}
                orders={scopedOrders}
              />
            )}
            {tab === "live" && (
              <LiveView visitors={visitors} events={scopedEvents} orders={scopedOrders} period={period} />
            )}
            {tab === "pedidos" && (
              <OrdersPanel
                orders={orders}
                token={token}
                onChange={(next) => setSnap((prev) => (prev ? { ...prev, orders: prev.orders.map((o) => (o.id === next.id ? next : o)) } : prev))}
              />
            )}
            {tab === "carrinhos" && (
              <AbandonedCarts visitors={visitors} events={scopedEvents} orders={scopedOrders} />
            )}
            {tab === "funil" && <FunnelPanel events={scopedEvents} orders={scopedOrders} />}
            {tab === "trafego" && <TrafficPanel events={scopedEvents} orders={scopedOrders} />}
            {tab === "produtos" && <ProductsPanel events={scopedEvents} orders={scopedOrders} />}
            {tab === "pixels" && (
              <PixelsPanel
                settings={settings}
                last={snap?.metaLast}
                token={token}
                onChange={(next) => {
                  saveLocalSettings(next);
                  setSettings(next);
                }}
                onSave={() => void saveSettings(token, settingsRef.current, setSettings)}
              />
            )}
            {tab === "utmify" && (
              <UtmifyPanel
                settings={settings}
                last={snap?.utmfyLast}
                onChange={setSettings}
                onSave={() => void saveSettings(token, settingsRef.current, setSettings)}
                onTest={async () => {
                  try {
                    const result = await testUtmifyConnection({ data: { token } });
                    toast[result?.ok ? "success" : "error"](result?.message ?? "Sem retorno");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Falha no teste");
                  }
                }}
              />
            )}
            {tab === "config" && (
              <ConfigPanel
                settings={settings}
                token={token}
                onChange={setSettings}
                onSave={() => void saveSettings(token, settingsRef.current, setSettings)}
                onSeed={() => {
                  seedLocalDemo();
                  setSnap(
                    mergeLocal({
                      settings: loadLocalSettings(),
                      events: [],
                      orders: [],
                      visitors: [],
                    }),
                  );
                  void seedAdminDemo({ data: { token } }).catch(() => undefined);
                  toast.success("Dados de exemplo carregados");
                }}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function keepSecret(next: string | undefined, prev: string | undefined) {
  const incoming = next ?? "";
  const current = prev ?? "";
  if (current && !current.includes("•")) return current;
  return incoming;
}

function keepTypedSecrets(prev: AdminSettings, incoming: AdminSettings): AdminSettings {
  return {
    ...prev,
    ...incoming,
    pixels: mergePixelSecrets(incoming.pixels, prev.pixels),
    utmfy: {
      ...defaultSettings.utmfy,
      ...incoming.utmfy,
      apiToken: keepSecret(incoming.utmfy?.apiToken, prev.utmfy?.apiToken),
    },
  };
}

function mergeLocal(snap: AdminSnapshot): AdminSnapshot {
  const localEvents = loadLocalEvents();
  const localOrders = loadOrders();
  const localVisitors = loadLocalPresence(true);
  const events = [...snap.events];
  for (const event of localEvents) {
    if (!events.some((item) => item.id === event.id)) events.push(event);
  }
  const visitors = [...snap.visitors];
  for (const visitor of localVisitors) {
    const index = visitors.findIndex((item) => item.sessionId === visitor.sessionId);
    if (index === -1) visitors.push(visitor);
    else if (visitors[index] && visitor.lastTs > visitors[index].lastTs) visitors[index] = visitor;
  }
  const orders = [...snap.orders];
  for (const order of localOrders) {
    if (!orders.some((item) => item.id === order.id)) orders.push(order);
  }
  for (const event of events) {
    if (event.name !== "generate_pix" && event.name !== "purchase") continue;
    const id = typeof event.props?.order_id === "string" ? event.props.order_id : "";
    if (!id || orders.some((item) => item.id === id)) continue;
    const visitor = visitors.find((item) => item.sessionId === event.sessionId);
    const rawItems = Array.isArray(event.props?.cart_items) ? event.props.cart_items : visitor?.cartItems ?? [];
    const items = (rawItems as { id?: number; title?: string; size?: string; qty?: number; price?: number; photo?: string }[]).map((item) => ({
      id: Number(item.id) || 0,
      title: String(item.title ?? "Produto"),
      size: item.size,
      qty: Number(item.qty) || 1,
      price: Number(item.price) || 0,
      photo: item.photo ?? "",
    }));
    const name = String(event.props?.name ?? visitor?.name ?? "");
    orders.push({
      id,
      createdAt: event.ts,
      data: {
        ...emptyCheckout,
        email: String(event.props?.email ?? visitor?.email ?? ""),
        name,
        firstName: name.split(/\s+/)[0] ?? "",
        lastName: name.split(/\s+/).slice(1).join(" "),
        phone: String(event.props?.phone ?? visitor?.phone ?? ""),
        city: String(event.props?.city ?? visitor?.city ?? ""),
        state: String(event.props?.state ?? visitor?.state ?? ""),
        shippingMethod: (String(event.props?.shipping ?? visitor?.shipping ?? "gratis") as OrderSummary["data"]["shippingMethod"]),
        payment: "pix",
      },
      items,
      subtotal: Number(event.props?.value) || visitor?.cartValue || 0,
      shipping: 0,
      discount: 0,
      total: Number(event.props?.value) || visitor?.cartValue || 0,
      status: event.name === "purchase" ? "paid" : "pending",
      attribution: event.attribution,
      sessionId: event.sessionId,
    });
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  visitors.sort((a, b) => b.lastTs.localeCompare(a.lastTs));
  return { ...snap, events, orders, visitors };
}

async function saveSettings(
  token: string,
  settings: AdminSettings,
  setSettings: (settings: AdminSettings) => void,
) {
  saveLocalSettings(settings);
  setSettings(settings);
  try {
    const next = await saveAdminSettings({
      data: {
        token,
        settings: {
          storeName: settings.storeName,
          webhookUrl: settings.webhookUrl,
          pixels: settings.pixels,
          utmfy: settings.utmfy,
        },
      },
    });
    setSettings(keepTypedSecrets(settings, next));
    toast.success("Configurações salvas. Os pixels valem para todos os visitantes.");
  } catch {
    toast.success("Salvo neste navegador. Publique e configure o servidor para valer em todos os visitantes.");
  }
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

function Overview({
  sessions,
  revenue,
  pixRevenue,
  paid,
  pending,
  conv,
  abandoned,
  abandonedValue,
  events,
  orders,
}: {
  sessions: number;
  revenue: number;
  pixRevenue: number;
  paid: number;
  pending: number;
  conv: number;
  abandoned: number;
  abandonedValue: number;
  events: AdminSnapshot["events"];
  orders: OrderSummary[];
}) {
  const hourly = useMemo(() => {
    const buckets = new Map<string, { hour: string; sessoes: number; pix: number; pagos: number }>();
    const mark = (iso: string, field: "sessoes" | "pix" | "pagos") => {
      const date = new Date(iso);
      const key = `${date.getHours().toString().padStart(2, "0")}h`;
      const row = buckets.get(key) ?? { hour: key, sessoes: 0, pix: 0, pagos: 0 };
      row[field] += 1;
      buckets.set(key, row);
    };
    const seen = new Set<string>();
    for (const event of events) {
      const hour = new Date(event.ts).getHours();
      const sid = `${hour}-${event.sessionId}`;
      if (!seen.has(sid)) {
        seen.add(sid);
        mark(event.ts, "sessoes");
      }
      if (event.name === "generate_pix") mark(event.ts, "pix");
      if (event.name === "purchase") mark(event.ts, "pagos");
    }
    return [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  }, [events]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Visão geral</h2>
        <p className="text-sm text-white/50">Funil, PIX e receita em tempo quase real.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card label="Visitantes" value={String(sessions)} hint="Sessões únicas" />
        <Card label="PIX gerados" value={String(pending + paid)} hint={`${pending} aguardando`} />
        <Card label="Pagos" value={String(paid)} hint={`${conv.toFixed(1)}% das sessões`} />
        <Card label="Receita paga" value={money(revenue)} />
        <Card label="PIX em aberto" value={money(pixRevenue)} hint="Ainda não pagos" />
        <Card
          label="Carrinhos abandonados"
          value={String(abandoned)}
          hint={abandoned ? money(abandonedValue) : "Sacola ou checkout sem compra"}
        />
      </div>
      <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
        <h3 className="mb-4 text-sm font-medium text-white/70">Sessões, PIX e pagos por hora</h3>
        <div className="h-64">
          {hourly.length === 0 ? (
            <Empty text="Ainda sem tráfego. Abra a loja ou gere dados de exemplo em Configurações." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourly}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="hour" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#10182a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                />
                <Area type="monotone" dataKey="sessoes" stroke="#7dd3fc" fill="#7dd3fc33" />
                <Area type="monotone" dataKey="pix" stroke="#E0B761" fill="#E0B76133" />
                <Area type="monotone" dataKey="pagos" stroke="#34d399" fill="#34d39933" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <RecentOrders orders={orders.slice(0, 6)} />
    </div>
  );
}

function OrdersPanel({
  orders,
  token,
  onChange,
}: {
  orders: OrderSummary[];
  token: string;
  onChange: (order: OrderSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [open, setOpen] = useState<OrderSummary | null>(null);
  const filtered = orders.filter((order) => {
    const hay = `${order.id} ${order.data.email} ${customerName(order.data)}`.toLowerCase();
    const matchQ = hay.includes(query.toLowerCase());
    const matchS = status === "todos" || orderStatus(order) === status;
    return matchQ && matchS;
  });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Pedidos</h2>
          <p className="text-sm text-white/50">
            {orders.length} no total · PIX gerado e pago ficam gravados no servidor
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar e-mail, nome, ID"
            className="h-10 rounded-xl border border-white/10 bg-[#10182a] px-3 text-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-[#10182a] px-3 text-sm"
          >
            <option value="todos">Todos</option>
            <option value="pending">Aguardando</option>
            <option value="paid">Pagos</option>
            <option value="refused">Recusados</option>
            <option value="refunded">Reembolsos</option>
          </select>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/45">
            <tr>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-white/40">
                  Nenhum pedido ainda.
                </td>
              </tr>
            )}
            {filtered.map((order) => (
              <tr
                key={order.id}
                onClick={() => setOpen(order)}
                className="cursor-pointer border-t border-white/8 hover:bg-white/5"
              >
                <td className="px-4 py-3">
                  <p className="font-medium">{order.id}</p>
                  <p className="text-[11px] text-white/40">{new Date(order.createdAt).toLocaleString("pt-BR")}</p>
                </td>
                <td className="px-4 py-3">
                  {customerName(order.data)}
                  <p className="text-[11px] text-white/40">{order.data.email}</p>
                </td>
                <td className="px-4 py-3 text-xs text-white/60">{sourceLabel(order.attribution)}</td>
                <td className="px-4 py-3">
                  <StatusPill status={orderStatus(order)} />
                </td>
                <td className="px-4 py-3 text-right font-semibold">{money(order.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <OrderDrawer
          order={open}
          token={token}
          onClose={() => setOpen(null)}
          onChange={(next) => {
            onChange(next);
            setOpen(next);
          }}
        />
      )}
    </div>
  );
}

function OrderDrawer({
  order,
  token,
  onClose,
  onChange,
}: {
  order: OrderSummary;
  token: string;
  onClose: () => void;
  onChange: (order: OrderSummary) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#0c1322] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs text-white/40">Pedido</p>
        <h3 className="text-xl font-semibold">{order.id}</h3>
        <StatusPill status={orderStatus(order)} />
        <dl className="mt-5 space-y-2 text-sm">
          <Row label="Cliente" value={customerName(order.data)} />
          <Row label="E-mail" value={order.data.email} />
          <Row label="Telefone" value={order.data.phone} />
          <Row label="CPF" value={order.data.cpf} />
          <Row
            label="Endereço"
            value={`${order.data.street}, ${order.data.number} · ${order.data.city}/${order.data.state}`}
          />
          <Row label="Frete" value={order.data.shippingMethod} />
          <Row label="Origem" value={sourceLabel(order.attribution)} />
          <Row label="Campanha" value={order.attribution?.utm_campaign || "—"} />
          <Row label="PIX" value={order.pix?.transactionId ? String(order.pix.transactionId) : "—"} />
        </dl>
        <ul className="mt-5 space-y-2 text-sm">
          {order.items.map((item) => (
            <li key={`${item.id}-${item.size}`} className="flex justify-between gap-3">
              <span>
                {item.qty}x {item.title}
                {item.size ? ` · ${item.size}` : ""}
              </span>
              <span>{formatBRL(item.price * item.qty)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-right text-lg font-semibold">{money(order.total)}</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {(["pending", "paid", "refused", "refunded"] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={async () => {
                try {
                  const next = await updateAdminOrder({ data: { token, orderId: order.id, status } });
                  onChange(next);
                  toast.success(`Status: ${statusLabel(status)}`);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Não atualizou");
                }
              }}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs hover:bg-white/5"
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-6 text-sm text-white/50">
          Fechar
        </button>
      </aside>
    </div>
  );
}

function FunnelPanel({ events, orders }: { events: AdminSnapshot["events"]; orders: OrderSummary[] }) {
  const steps = buildFunnel(events, orders);
  const leakIndex = steps.reduce((worst, step, index) => {
    if (index === 0) return worst;
    const prevDrop = steps[worst]?.id === "sessions" ? 0 : 100 - steps[worst].rateFromPrev;
    const drop = 100 - step.rateFromPrev;
    return drop > prevDrop ? index : worst;
  }, 1);
  const paid = steps[steps.length - 1];
  return (
    <div>
      <h2 className="text-xl font-semibold">Progresso do cliente</h2>
      <p className="text-sm text-white/50">
        Quantas sessões avançam em cada etapa e onde o funil vaza até o PIX pago.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
          <p className="text-[11px] uppercase tracking-wide text-white/45">Chegam ao checkout</p>
          <p className="mt-2 text-2xl font-semibold">
            {steps.find((step) => step.id === "begin_checkout")?.rateFromStart.toFixed(1) ?? "0.0"}%
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
          <p className="text-[11px] uppercase tracking-wide text-white/45">Geram PIX</p>
          <p className="mt-2 text-2xl font-semibold">
            {steps.find((step) => step.id === "generate_pix")?.rateFromStart.toFixed(1) ?? "0.0"}%
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
          <p className="text-[11px] uppercase tracking-wide text-white/45">Pagam</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">{paid?.rateFromStart.toFixed(1) ?? "0.0"}%</p>
        </div>
      </div>
      <div className="mt-6 space-y-3">
        {steps.map((step, index) => {
          const prev = index === 0 ? step.count : steps[index - 1].count;
          const dropped = Math.max(0, prev - step.count);
          const dropRate = prev ? (dropped / prev) * 100 : 0;
          const leak = index === leakIndex && dropped > 0;
          return (
            <div
              key={step.id}
              className={cn(
                "rounded-2xl border bg-[#10182a] p-4",
                leak ? "border-amber-400/40" : "border-white/10",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {index + 1}. {step.label}
                </span>
                <span className="text-white/60">
                  {step.count} pessoas · {step.rateFromStart.toFixed(1)}% do topo
                </span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#001E62] to-[#E0B761]"
                  style={{ width: `${Math.max(2, Math.min(100, step.rateFromStart || (step.count ? 100 : 0)))}%` }}
                />
              </div>
              {index > 0 && (
                <p className={cn("mt-2 text-xs", leak ? "text-amber-200" : "text-white/45")}>
                  {dropped > 0
                    ? `${dropped} ${dropped === 1 ? "abandonou" : "abandonaram"} aqui (${dropRate.toFixed(0)}% do passo anterior)${leak ? " · maior vazamento" : ""}`
                    : "Ninguém abandonou neste passo"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrafficPanel({ events, orders }: { events: AdminSnapshot["events"]; orders: OrderSummary[] }) {
  const rows = buildCampaigns(events, orders);
  return (
    <div>
      <h2 className="text-xl font-semibold">Tráfego e UTMs</h2>
      <p className="text-sm text-white/50">Performance por origem, campanha e medium.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/45">
            <tr>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Campanha</th>
              <th className="px-4 py-3">Medium</th>
              <th className="px-4 py-3">Sessões</th>
              <th className="px-4 py-3">Sacola</th>
              <th className="px-4 py-3">Checkout</th>
              <th className="px-4 py-3">PIX</th>
              <th className="px-4 py-3">Pagos</th>
              <th className="px-4 py-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-white/40">
                  Sem UTMs ainda. Use ?utm_source=facebook&utm_campaign=teste na home.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-white/8">
                <td className="px-4 py-3">{row.source}</td>
                <td className="px-4 py-3">{row.campaign}</td>
                <td className="px-4 py-3">{row.medium}</td>
                <td className="px-4 py-3">{row.sessions}</td>
                <td className="px-4 py-3">{row.carts}</td>
                <td className="px-4 py-3">{row.checkout}</td>
                <td className="px-4 py-3">{row.pix}</td>
                <td className="px-4 py-3">{row.paid}</td>
                <td className="px-4 py-3 text-right">{money(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductsPanel({ events, orders }: { events: AdminSnapshot["events"]; orders: OrderSummary[] }) {
  const rows = products.map((product) => {
    const views = events.filter((event) => event.name === "view_item" && String(event.props?.content_ids) === String([product.id])).length
      + events.filter((event) => event.path.includes(`/produto/${product.id}`)).length;
    const carts = events.filter(
      (event) => event.name === "add_to_cart" && String(event.props?.content_ids ?? "").includes(String(product.id)),
    ).length;
    const sold = orders
      .filter((order) => orderStatus(order) === "paid")
      .flatMap((order) => order.items)
      .filter((item) => item.id === product.id);
    const units = sold.reduce((acc, item) => acc + item.qty, 0);
    const revenue = sold.reduce((acc, item) => acc + item.price * item.qty, 0);
    return { product, views, carts, units, revenue };
  }).sort((a, b) => b.views - a.views || b.revenue - a.revenue);

  return (
    <div>
      <h2 className="text-xl font-semibold">Produtos</h2>
      <p className="text-sm text-white/50">Visualizações, sacola e vendas pagas.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/45">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Views</th>
              <th className="px-4 py-3">Sacola</th>
              <th className="px-4 py-3">Vendidos</th>
              <th className="px-4 py-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((row) => (
              <tr key={row.product.id} className="border-t border-white/8">
                <td className="px-4 py-3">{row.product.titulo}</td>
                <td className="px-4 py-3">{row.views}</td>
                <td className="px-4 py-3">{row.carts}</td>
                <td className="px-4 py-3">{row.units}</td>
                <td className="px-4 py-3 text-right">{money(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PixelsPanel({
  settings,
  last,
  token,
  onChange,
  onSave,
}: {
  settings: AdminSettings;
  last?: AdminSnapshot["metaLast"];
  token: string;
  onChange: (settings: AdminSettings) => void;
  onSave: () => void;
}) {
  const pixels = normalizePixels(settings.pixels);
  const items = pixels.items;
  const [kind, setKind] = useState<PixelKind>("meta");

  const commit = (nextItems: PixelItem[]) => {
    onChange({
      ...settings,
      pixels: normalizePixels({ ...pixels, items: nextItems }),
    });
  };

  const patchItem = (id: string, partial: Partial<PixelItem>) => {
    commit(items.map((item) => (item.id === id ? { ...item, ...partial } : item)));
  };

  const removeItem = (id: string) => {
    if (!window.confirm("Remover este pixel?")) return;
    commit(items.filter((item) => item.id !== id));
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Pixels de tráfego</h2>
        <p className="text-sm text-white/50">
          Adicione ou remova pixels. O de Meta também envia Purchase pela API de Conversões.
        </p>
      </div>

      {items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-sm text-white/45">
          Nenhum pixel cadastrado. Adicione Meta, Google, TikTok ou outro abaixo.
        </p>
      )}

      {items.map((item) => (
        <div key={item.id} className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={item.kind}
              onChange={(e) => patchItem(item.id, { kind: e.target.value as PixelKind })}
              className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm"
            >
              {PIXEL_KINDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="ml-auto flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(e) => patchItem(item.id, { enabled: e.target.checked })}
              />
              Ativo
            </label>
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-sm text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remover
            </button>
          </div>
          <div className="mt-3 grid gap-3">
            {item.kind !== "custom" && (
              <Field
                label={item.kind === "google" ? "Measurement ID (G-)" : "Pixel ID"}
                value={item.pixelId}
                onChange={(pixelId) => patchItem(item.id, { pixelId })}
                placeholder={
                  item.kind === "google"
                    ? "G-XXXXXXXX"
                    : item.kind === "tiktok"
                      ? "CXXXXXXXX"
                      : "000000000000000"
                }
              />
            )}
            {item.kind === "google" && (
              <Field
                label="Google Ads (AW-)"
                value={item.adsId ?? ""}
                onChange={(adsId) => patchItem(item.id, { adsId })}
                placeholder="AW-000000000"
              />
            )}
            {item.kind === "meta" && (
              <>
                <Field
                  label="Token da API de Conversões"
                  value={item.accessToken ?? ""}
                  onChange={(accessToken) => patchItem(item.id, { accessToken })}
                  placeholder="EAAxxxxxxxx"
                  type="password"
                  secret
                />
                {last && (
                  <p className={cn("text-sm", last.ok ? "text-emerald-300" : "text-red-300")}>
                    Último envio CAPI: {last.message} · {relativeTime(last.at)}
                  </p>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const result = await testMetaConnection({ data: { token } });
                      toast[result?.ok ? "success" : "error"](result?.message ?? "Sem retorno");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Falha no teste Meta");
                    }
                  }}
                  className="h-11 rounded-xl border border-white/15 px-4 text-sm hover:bg-white/5"
                >
                  Testar Meta CAPI
                </button>
              </>
            )}
            {item.kind === "custom" && (
              <label className="block">
                <span className="text-xs text-white/50">HTML do pixel</span>
                <textarea
                  value={item.html ?? ""}
                  onChange={(e) => patchItem(item.id, { html: e.target.value })}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-xs"
                  placeholder={"<script>…</script>"}
                />
              </label>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PixelKind)}
          className="h-11 rounded-xl border border-white/10 bg-[#10182a] px-3 text-sm"
        >
          {PIXEL_KINDS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => commit([...items, newPixelItem(kind)])}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm hover:bg-white/5"
        >
          <Plus className="h-4 w-4" />
          Adicionar {pixelKindLabel(kind)}
        </button>
      </div>
      <SaveButton onClick={onSave} />
    </div>
  );
}

function UtmifyPanel({
  settings,
  last,
  onChange,
  onSave,
  onTest,
}: {
  settings: AdminSettings;
  last?: AdminSnapshot["utmfyLast"];
  onChange: (settings: AdminSettings) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const u = settings.utmfy ?? defaultSettings.utmfy;
  const set = (partial: Partial<AdminSettings["utmfy"]>) =>
    onChange({ ...settings, utmfy: { ...u, ...partial } });
  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold">UTMify</h2>
        <p className="text-sm text-white/50">
          Salve o token aqui. PIX gerado entra como pendente e o pagamento atualiza a mesma venda.
          Sem o token no servidor a UTMify não recebe faturamento. Depois de salvar, deixe o admin
          aberto uns segundos para reenviar os pedidos que faltam em{" "}
          <a className="underline" href="https://app.utmify.com.br" target="_blank" rel="noreferrer">
            app.utmify.com.br
          </a>
          .
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(u.enabled)} onChange={(e) => set({ enabled: e.target.checked })} />
        Ativar UTMify
      </label>
      <Field
        label="Pixel ID"
        value={u.pixelId ?? ""}
        onChange={(pixelId) => set({ pixelId })}
        placeholder={UTMIFY_PIXEL_ID}
      />
      <Field
        label="API token (x-api-token)"
        value={u.apiToken ?? ""}
        onChange={(apiToken) => set({ apiToken })}
        placeholder="Cole o token de Integrações → API Credentials"
        type="password"
        secret
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={u.testMode} onChange={(e) => set({ testMode: e.target.checked })} />
        Modo teste (não grava venda real na UTMify)
      </label>
      {last && (
        <p className={cn("text-sm", last.ok ? "text-emerald-300" : "text-red-300")}>
          Último envio: {last.message} · {relativeTime(last.at)}
        </p>
      )}
      <div className="flex gap-2">
        <SaveButton onClick={onSave} />
        <button
          type="button"
          onClick={onTest}
          className="h-11 rounded-xl border border-white/15 px-4 text-sm hover:bg-white/5"
        >
          Testar API
        </button>
      </div>
    </div>
  );
}

function ConfigPanel({
  settings,
  token,
  onChange,
  onSave,
  onSeed,
}: {
  settings: AdminSettings;
  token: string;
  onChange: (settings: AdminSettings) => void;
  onSave: () => void;
  onSeed: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Configurações</h2>
        <p className="text-sm text-white/50">Nome da loja, webhook e senha do painel.</p>
      </div>
      <Field label="Nome da loja no admin" value={settings.storeName} onChange={(storeName) => onChange({ ...settings, storeName })} />
      <Field
        label="Webhook (POST JSON a cada pedido)"
        value={settings.webhookUrl}
        onChange={(webhookUrl) => onChange({ ...settings, webhookUrl })}
        placeholder="https://..."
      />
      <SaveButton onClick={onSave} />
      <div className="rounded-2xl border border-white/10 p-4">
        <h3 className="font-medium">Trocar senha</h3>
        <div className="mt-3 grid gap-3">
          <Field label="Senha atual" value={current} onChange={setCurrent} type="password" />
          <Field label="Nova senha" value={next} onChange={setNext} type="password" />
          <button
            type="button"
            onClick={async () => {
              try {
                await localChangePin(current, next);
                try {
                  await changeAdminPin({ data: { token, current, next } });
                } catch {
                  // senha local já atualizada
                }
                toast.success("Senha atualizada");
                setCurrent("");
                setNext("");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Não trocou");
              }
            }}
            className="h-11 rounded-xl bg-white/10 text-sm"
          >
            Atualizar senha
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onSeed()}
        className="h-11 rounded-xl border border-dashed border-white/20 px-4 text-sm text-white/70"
      >
        Preencher com dados de exemplo
      </button>
    </div>
  );
}

function RecentOrders({ orders }: { orders: OrderSummary[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
      <h3 className="text-sm font-medium text-white/70">Últimos pedidos</h3>
      {orders.length === 0 ? (
        <Empty text="Os PIX da loja aparecem aqui automaticamente." />
      ) : (
        <ul className="mt-3 divide-y divide-white/8">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-medium">{order.id}</p>
                <p className="text-xs text-white/40">
                  {customerName(order.data)} · {sourceLabel(order.attribution)}
                </p>
              </div>
              <div className="text-right">
                <p>{money(order.total)}</p>
                <StatusPill status={orderStatus(order)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  secret,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  secret?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-white/50">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={secret ? "new-password" : "off"}
        spellCheck={false}
        onFocus={() => {
          if (secret && value.includes("•")) onChange("");
        }}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none focus:border-[#E0B761]"
      />
    </label>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 rounded-xl bg-[#E0B761] px-5 text-sm font-semibold text-[#001E62]"
    >
      Salvar
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "paid"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "pending"
        ? "bg-amber-500/15 text-amber-200"
        : status === "refunded"
          ? "bg-sky-500/15 text-sky-200"
          : "bg-red-500/15 text-red-300";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      {statusLabel(status)}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-white/40">
      <BarChart3 className="h-4 w-4" />
      {text}
    </div>
  );
}
