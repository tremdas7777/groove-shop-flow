import type { OrderSummary } from "@/lib/checkout";
import { formatBRL, getProduct } from "@/lib/products";
import type { AnalyticsEvent, Attribution, DeviceType, FunnelEventName } from "@/lib/tracking";

export interface PixelSettings {
  metaEnabled: boolean;
  metaPixelId: string;
  metaAccessToken: string;
  googleEnabled: boolean;
  gaId: string;
  googleAdsId: string;
  tiktokEnabled: boolean;
  tiktokPixelId: string;
  kwaiEnabled: boolean;
  kwaiPixelId: string;
  snapEnabled: boolean;
  snapPixelId: string;
  customHeadHtml: string;
}

export interface UtmfySettings {
  enabled: boolean;
  pixelId: string;
  apiToken: string;
  testMode: boolean;
}

export interface AdminSettings {
  storeName: string;
  webhookUrl: string;
  pixels: PixelSettings;
  utmfy: UtmfySettings;
  hasPin: boolean;
}

export interface PublicTrackingSettings {
  pixels: Omit<PixelSettings, "customHeadHtml" | "metaAccessToken"> & { customHeadHtml: string };
  utmfy: { enabled: boolean; pixelId: string };
}

export interface PresenceVisitor {
  sessionId: string;
  path: string;
  title?: string;
  device: DeviceType;
  attribution: Attribution;
  lastEvent: string;
  lastTs: string;
  startedAt: string;
}

export interface AdminSnapshot {
  settings: AdminSettings;
  events: AnalyticsEvent[];
  orders: OrderSummary[];
  visitors: PresenceVisitor[];
  utmfyLast?: { at: string; ok: boolean; message: string };
  metaLast?: { at: string; ok: boolean; message: string };
}

export const emptyPixels: PixelSettings = {
  metaEnabled: false,
  metaPixelId: "",
  metaAccessToken: "",
  googleEnabled: false,
  gaId: "",
  googleAdsId: "",
  tiktokEnabled: false,
  tiktokPixelId: "",
  kwaiEnabled: false,
  kwaiPixelId: "",
  snapEnabled: false,
  snapPixelId: "",
  customHeadHtml: "",
};

export const emptyUtmfy: UtmfySettings = {
  enabled: false,
  pixelId: "",
  apiToken: "",
  testMode: false,
};

export const defaultSettings: AdminSettings = {
  storeName: "ASICS Brasil",
  webhookUrl: "",
  pixels: emptyPixels,
  utmfy: emptyUtmfy,
  hasPin: false,
};

export function orderStatus(order: OrderSummary) {
  if (order.status) return order.status;
  if (order.pix?.status === "paid") return "paid";
  if (order.pix?.status === "refused") return "refused";
  if (order.pix?.status === "refunded") return "refunded";
  return "pending";
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "Aguardando PIX",
    paid: "Pago",
    refused: "Recusado",
    refunded: "Reembolsado",
    unknown: "Indefinido",
  };
  return map[status] ?? status;
}

export function money(value: number) {
  return formatBRL(value);
}

export function uniqueSessions(events: AnalyticsEvent[]) {
  return new Set(events.map((event) => event.sessionId)).size;
}

export function countNamed(events: AnalyticsEvent[], name: FunnelEventName | string) {
  return events.filter((event) => event.name === name).length;
}

export function sessionsWith(events: AnalyticsEvent[], name: FunnelEventName | string) {
  return new Set(events.filter((event) => event.name === name).map((event) => event.sessionId)).size;
}

export interface FunnelStep {
  id: string;
  label: string;
  count: number;
  rateFromStart: number;
  rateFromPrev: number;
}

export function buildFunnel(events: AnalyticsEvent[], orders: OrderSummary[]): FunnelStep[] {
  const start = uniqueSessions(events);
  const steps = [
    { id: "sessions", label: "Visitantes", count: start },
    { id: "view_item", label: "Viram produto", count: sessionsWith(events, "view_item") },
    { id: "add_to_cart", label: "Adicionaram à sacola", count: sessionsWith(events, "add_to_cart") },
    { id: "view_cart", label: "Abriram a sacola", count: sessionsWith(events, "view_cart") },
    { id: "begin_checkout", label: "Iniciaram checkout", count: sessionsWith(events, "begin_checkout") },
    { id: "checkout_identify", label: "Identificação", count: sessionsWith(events, "checkout_identify") },
    { id: "checkout_shipping", label: "Entrega", count: sessionsWith(events, "checkout_shipping") },
    { id: "generate_pix", label: "PIX gerado", count: sessionsWith(events, "generate_pix") || orders.length },
    {
      id: "purchase",
      label: "Pagaram",
      count: sessionsWith(events, "purchase") || orders.filter((order) => orderStatus(order) === "paid").length,
    },
  ];

  return steps.map((step, index) => {
    const prev = index === 0 ? step.count : steps[index - 1].count;
    return {
      ...step,
      rateFromStart: start ? (step.count / start) * 100 : 0,
      rateFromPrev: prev ? (step.count / prev) * 100 : 0,
    };
  });
}

export interface CampaignRow {
  key: string;
  source: string;
  campaign: string;
  medium: string;
  sessions: number;
  carts: number;
  checkout: number;
  pix: number;
  paid: number;
  revenue: number;
}

export function buildCampaigns(events: AnalyticsEvent[], orders: OrderSummary[]): CampaignRow[] {
  const map = new Map<string, CampaignRow>();

  const bump = (attr: Attribution, field: keyof CampaignRow, amount = 1) => {
    const source = attr.utm_source || attr.src || (attr.referrer ? "referral" : "direto");
    const campaign = attr.utm_campaign || "(sem campanha)";
    const medium = attr.utm_medium || "(none)";
    const key = `${source}|${campaign}|${medium}`;
    const row =
      map.get(key) ??
      ({
        key,
        source,
        campaign,
        medium,
        sessions: 0,
        carts: 0,
        checkout: 0,
        pix: 0,
        paid: 0,
        revenue: 0,
      } satisfies CampaignRow);
    if (field !== "source" && field !== "campaign" && field !== "medium" && field !== "key") {
      (row[field] as number) += amount;
    }
    map.set(key, row);
  };

  const seenSessions = new Set<string>();
  for (const event of events) {
    if (!seenSessions.has(event.sessionId)) {
      seenSessions.add(event.sessionId);
      bump(event.attribution, "sessions");
    }
    if (event.name === "add_to_cart") bump(event.attribution, "carts");
    if (event.name === "begin_checkout") bump(event.attribution, "checkout");
    if (event.name === "generate_pix") bump(event.attribution, "pix");
  }

  for (const order of orders) {
    const attr = order.attribution ?? {};
    if (orderStatus(order) === "paid") {
      bump(attr, "paid");
      bump(attr, "revenue", order.total);
    }
  }

  return [...map.values()].sort((a, b) => b.sessions - a.sessions || b.revenue - a.revenue);
}

export function sourceLabel(attr?: Attribution) {
  if (!attr) return "Direto";
  return attr.utm_source || attr.src || (attr.referrer ? hostOf(attr.referrer) : "Direto");
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 10) return "agora";
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h`;
  return `${Math.round(hr / 24)} d`;
}

export function pageLabel(path: string) {
  const clean = path.split("?")[0] || "/";
  if (clean === "/") return "Home";
  if (clean.startsWith("/produto/")) {
    const id = Number(clean.split("/")[2]);
    const product = Number.isFinite(id) ? getProduct(id) : undefined;
    return product ? product.titulo : `Produto ${clean.split("/")[2] ?? ""}`;
  }
  if (clean.startsWith("/carrinho")) return "Sacola";
  if (clean.startsWith("/checkout")) return "Checkout";
  if (clean.startsWith("/pedido")) return "Pedido / PIX";
  if (clean.startsWith("/obrigado")) return "Obrigado / Upsell";
  return path;
}

export const PERIODS = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "7d", label: "7 dias" },
  { id: "15d", label: "15 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "tudo", label: "Tudo" },
] as const;

export type Period = (typeof PERIODS)[number]["id"];

function startOfDay(ms: number) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function periodRange(period: Period, now = Date.now()): [number, number] {
  const today = startOfDay(now);
  if (period === "hoje") return [today, now];
  if (period === "ontem") return [today - 86_400_000, today];
  if (period === "7d") return [now - 7 * 86_400_000, now];
  if (period === "15d") return [now - 15 * 86_400_000, now];
  if (period === "30d") return [now - 30 * 86_400_000, now];
  if (period === "mes") return [new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime(), now];
  return [0, now];
}

export function inPeriod(iso: string, period: Period, now = Date.now()) {
  const time = new Date(iso).getTime();
  const [from, to] = periodRange(period, now);
  if (period === "ontem") return time >= from && time < to;
  return time >= from && time <= to;
}

export const JOURNEY_STEPS = [
  { id: "arrived", label: "Entrou", short: "Home", events: ["page_view"] },
  { id: "product", label: "Viu o produto", short: "Produto", events: ["view_item"] },
  { id: "cart", label: "Colocou na sacola", short: "Sacola", events: ["add_to_cart", "view_cart"] },
  { id: "checkout", label: "Abriu o checkout", short: "Checkout", events: ["begin_checkout"] },
  { id: "identify", label: "Preencheu os dados", short: "Dados", events: ["checkout_identify"] },
  { id: "shipping", label: "Escolheu a entrega", short: "Entrega", events: ["checkout_shipping", "checkout_payment"] },
  { id: "pix", label: "Gerou o PIX", short: "PIX", events: ["generate_pix"] },
  { id: "paid", label: "Pagou", short: "Pago", events: ["purchase"] },
] as const;

export type JourneyStepId = (typeof JOURNEY_STEPS)[number]["id"];

const EVENT_LABELS: Record<string, string> = {
  page_view: "Entrou na página",
  view_item: "Abriu um produto",
  add_to_cart: "Adicionou à sacola",
  view_cart: "Abriu a sacola",
  begin_checkout: "Iniciou o checkout",
  checkout_identify: "Preencheu nome e e-mail",
  checkout_shipping: "Informou o endereço",
  checkout_payment: "Foi para o pagamento",
  generate_pix: "Gerou o PIX",
  purchase: "Pagou o PIX",
  search: "Pesquisou",
  heartbeat: "Continua na loja",
};

export function eventLabel(name: string) {
  return EVENT_LABELS[name] ?? name.replace(/_/g, " ");
}

export const ONLINE_MS = 90_000;
export const RECENT_MS = 45 * 60_000;

export function isOnline(iso: string, now = Date.now()) {
  return now - new Date(iso).getTime() <= ONLINE_MS;
}

function productFromEvent(event: AnalyticsEvent) {
  const name = String(event.props?.content_name ?? "");
  if (name) return name;
  const ids = event.props?.content_ids;
  const raw = Array.isArray(ids) ? ids[0] : ids;
  const id = Number(raw);
  if (Number.isFinite(id)) return getProduct(id)?.titulo;
  if (event.path.startsWith("/produto/")) return pageLabel(event.path);
  return undefined;
}

function stepIndexFromPath(path: string) {
  const clean = path.split("?")[0] || "/";
  if (clean.startsWith("/obrigado")) return 7;
  if (clean.startsWith("/pedido")) return 6;
  if (clean.startsWith("/checkout")) return 3;
  if (clean.startsWith("/carrinho")) return 2;
  if (clean.startsWith("/produto/")) return 1;
  return 0;
}

function stepIndexFromEvents(events: AnalyticsEvent[]) {
  let index = 0;
  const names = new Set(events.map((event) => event.name));
  JOURNEY_STEPS.forEach((step, i) => {
    if (step.events.some((name) => names.has(name))) index = Math.max(index, i);
  });
  return index;
}

export interface LiveSession {
  sessionId: string;
  path: string;
  device: DeviceType;
  attribution: Attribution;
  lastEvent: string;
  lastTs: string;
  startedAt: string;
  online: boolean;
  stepIndex: number;
  step: (typeof JOURNEY_STEPS)[number];
  events: AnalyticsEvent[];
  productName?: string;
  identity?: string;
  value?: number;
  order?: OrderSummary;
}

export function buildLiveSessions(
  events: AnalyticsEvent[],
  orders: OrderSummary[],
  visitors: PresenceVisitor[],
  now = Date.now(),
): LiveSession[] {
  const grouped = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const list = grouped.get(event.sessionId) ?? [];
    list.push(event);
    grouped.set(event.sessionId, list);
  }

  const orderBySession = new Map<string, OrderSummary>();
  for (const order of orders) {
    if (order.sessionId) orderBySession.set(order.sessionId, order);
  }

  const ids = new Set<string>([...grouped.keys(), ...visitors.map((visitor) => visitor.sessionId)]);
  const sessions: LiveSession[] = [];

  for (const sessionId of ids) {
    const trail = (grouped.get(sessionId) ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));
    const visitor = visitors.find((item) => item.sessionId === sessionId);
    const last = trail[trail.length - 1];
    const lastTs = visitor?.lastTs && (!last || visitor.lastTs >= last.ts) ? visitor.lastTs : last?.ts;
    if (!lastTs) continue;
    if (now - new Date(lastTs).getTime() > RECENT_MS && !visitor) continue;

    const startedAt = visitor?.startedAt ?? trail[0]?.ts ?? lastTs;
    const path = visitor?.path ?? last?.path ?? "/";
    const lastMeaningful =
      [...trail].reverse().find((event) => event.name !== "heartbeat" && event.name !== "page_view") ??
      last ??
      ({ name: visitor?.lastEvent || "page_view" } as AnalyticsEvent);
    const order = orderBySession.get(sessionId);
    const fromEvents = stepIndexFromEvents(trail);
    const fromPath = stepIndexFromPath(path);
    const fromOrder = order ? (orderStatus(order) === "paid" ? 7 : 6) : 0;
    const stepIndex = Math.max(fromEvents, fromPath, fromOrder);
    const product =
      [...trail].reverse().map(productFromEvent).find(Boolean) ??
      (path.startsWith("/produto/") ? pageLabel(path) : undefined) ??
      order?.items[0]?.title;
    const eventValue = Number(
      [...trail].reverse().find((event) => Number(event.props?.value ?? event.props?.total))?.props?.value ?? 0,
    );
    const value = order?.total ?? (eventValue || undefined);
    const identity = order
      ? `${order.data.firstName} ${order.data.lastName}`.trim()
      : String([...trail].reverse().find((event) => event.props?.email)?.props?.email ?? "") || undefined;

    sessions.push({
      sessionId,
      path,
      device: visitor?.device ?? last?.device ?? "mobile",
      attribution: visitor?.attribution ?? last?.attribution ?? {},
      lastEvent: visitor?.lastEvent && visitor.lastEvent !== "heartbeat" ? visitor.lastEvent : lastMeaningful.name,
      lastTs,
      startedAt,
      online: Boolean(visitor) || isOnline(lastTs, now),
      stepIndex,
      step: JOURNEY_STEPS[stepIndex],
      events: trail,
      productName: product,
      identity,
      value,
      order,
    });
  }

  return sessions.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.lastTs.localeCompare(a.lastTs);
  });
}

export function journeyNextLabel(stepIndex: number) {
  return JOURNEY_STEPS[stepIndex + 1]?.label ?? "Concluiu a compra";
}

export function sessionDuration(startedAt: string, lastTs: string) {
  const ms = Math.max(0, new Date(lastTs).getTime() - new Date(startedAt).getTime());
  const min = Math.round(ms / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${hr} h ${rest} min` : `${hr} h`;
}
