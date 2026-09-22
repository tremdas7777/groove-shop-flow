import type { OrderSummary } from "@/lib/checkout";
import { formatBRL } from "@/lib/products";
import type { AnalyticsEvent, Attribution, DeviceType, FunnelEventName } from "@/lib/tracking";

export interface PixelSettings {
  metaEnabled: boolean;
  metaPixelId: string;
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
  pixels: Omit<PixelSettings, "customHeadHtml"> & { customHeadHtml: string };
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
}

export const emptyPixels: PixelSettings = {
  metaEnabled: false,
  metaPixelId: "",
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
  if (path === "/") return "Home";
  if (path.startsWith("/produto/")) return `Produto ${path.split("/")[2] ?? ""}`;
  if (path.startsWith("/carrinho")) return "Sacola";
  if (path.startsWith("/checkout")) return "Checkout";
  if (path.startsWith("/pedido")) return "Pedido / PIX";
  return path;
}
