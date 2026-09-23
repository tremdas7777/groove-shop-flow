import { customerName, type OrderSummary } from "@/lib/checkout";
import { formatBRL, getProduct, parsePrice } from "@/lib/products";
import type { AnalyticsEvent, Attribution, DeviceType, FunnelEventName } from "@/lib/tracking";
import { UTMIFY_PIXEL_ID } from "@/lib/utmify-pixel";

export type PixelKind = "meta" | "google" | "tiktok" | "kwai" | "snap" | "pinterest" | "custom";

export const PIXEL_KINDS: { id: PixelKind; label: string }[] = [
  { id: "meta", label: "Meta Ads" },
  { id: "google", label: "Google Analytics / Ads" },
  { id: "tiktok", label: "TikTok Ads" },
  { id: "kwai", label: "Kwai Ads" },
  { id: "snap", label: "Snapchat Ads" },
  { id: "pinterest", label: "Pinterest Ads" },
  { id: "custom", label: "HTML / outro pixel" },
];

export interface PixelItem {
  id: string;
  kind: PixelKind;
  enabled: boolean;
  pixelId: string;
  adsId?: string;
  accessToken?: string;
  html?: string;
}

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
  items: PixelItem[];
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
  settingsAt?: number;
}

export interface PublicTrackingSettings {
  pixels: Omit<PixelSettings, "customHeadHtml" | "metaAccessToken"> & { customHeadHtml: string };
  utmfy: { enabled: boolean; pixelId: string };
}

export interface AbandonedCartItem {
  id: number;
  title: string;
  size?: string;
  qty: number;
  price: number;
  photo?: string;
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
  cartItems?: AbandonedCartItem[];
  cartValue?: number;
  email?: string;
  name?: string;
  phone?: string;
  city?: string;
  state?: string;
  shipping?: string;
}

export interface AdminSnapshot {
  settings: AdminSettings;
  events: AnalyticsEvent[];
  orders: OrderSummary[];
  visitors: PresenceVisitor[];
  utmfyLast?: { at: string; ok: boolean; message: string };
  metaLast?: { at: string; ok: boolean; message: string };
  tiktokLast?: { at: string; ok: boolean; message: string };
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
  items: [],
};

export function pixelKindLabel(kind: PixelKind) {
  return PIXEL_KINDS.find((item) => item.id === kind)?.label ?? kind;
}

export function newPixelItem(kind: PixelKind): PixelItem {
  return {
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    enabled: true,
    pixelId: "",
    adsId: "",
    accessToken: "",
    html: "",
  };
}

function pixelsFromLegacy(pixels: PixelSettings): PixelItem[] {
  const items: PixelItem[] = [];
  if (pixels.metaEnabled || pixels.metaPixelId || pixels.metaAccessToken) {
    items.push({
      id: "legacy-meta",
      kind: "meta",
      enabled: pixels.metaEnabled,
      pixelId: pixels.metaPixelId,
      accessToken: pixels.metaAccessToken,
    });
  }
  if (pixels.googleEnabled || pixels.gaId || pixels.googleAdsId) {
    items.push({
      id: "legacy-google",
      kind: "google",
      enabled: pixels.googleEnabled,
      pixelId: pixels.gaId,
      adsId: pixels.googleAdsId,
    });
  }
  if (pixels.tiktokEnabled || pixels.tiktokPixelId) {
    items.push({
      id: "legacy-tiktok",
      kind: "tiktok",
      enabled: pixels.tiktokEnabled,
      pixelId: pixels.tiktokPixelId,
    });
  }
  if (pixels.kwaiEnabled || pixels.kwaiPixelId) {
    items.push({
      id: "legacy-kwai",
      kind: "kwai",
      enabled: pixels.kwaiEnabled,
      pixelId: pixels.kwaiPixelId,
    });
  }
  if (pixels.snapEnabled || pixels.snapPixelId) {
    items.push({
      id: "legacy-snap",
      kind: "snap",
      enabled: pixels.snapEnabled,
      pixelId: pixels.snapPixelId,
    });
  }
  if (pixels.customHeadHtml.trim()) {
    items.push({
      id: "legacy-custom",
      kind: "custom",
      enabled: true,
      pixelId: "",
      html: pixels.customHeadHtml,
    });
  }
  return items;
}

export function syncPixelLegacy(pixels: PixelSettings): PixelSettings {
  const items = (pixels.items ?? []).map((item) => ({
    ...item,
    pixelId: item.pixelId ?? "",
    adsId: item.adsId ?? "",
    accessToken: item.accessToken ?? "",
    html: item.html ?? "",
  }));
  const meta = items.find((item) => item.kind === "meta");
  const google = items.find((item) => item.kind === "google");
  const tiktok = items.find((item) => item.kind === "tiktok");
  const kwai = items.find((item) => item.kind === "kwai");
  const snap = items.find((item) => item.kind === "snap");
  const customHtml = items
    .filter((item) => item.kind === "custom" && item.html?.trim())
    .map((item) => item.html)
    .join("\n");
  return {
    ...emptyPixels,
    ...pixels,
    items,
    metaEnabled: Boolean(meta?.enabled && meta.pixelId),
    metaPixelId: meta?.pixelId ?? "",
    metaAccessToken: meta?.accessToken ?? "",
    googleEnabled: Boolean(google?.enabled && (google.pixelId || google.adsId)),
    gaId: google?.pixelId ?? "",
    googleAdsId: google?.adsId ?? "",
    tiktokEnabled: Boolean(tiktok?.enabled && tiktok.pixelId),
    tiktokPixelId: tiktok?.pixelId ?? "",
    kwaiEnabled: Boolean(kwai?.enabled && kwai.pixelId),
    kwaiPixelId: kwai?.pixelId ?? "",
    snapEnabled: Boolean(snap?.enabled && snap.pixelId),
    snapPixelId: snap?.pixelId ?? "",
    customHeadHtml: customHtml,
  };
}

export function normalizePixels(pixels?: Partial<PixelSettings> | null): PixelSettings {
  const merged = { ...emptyPixels, ...pixels, items: pixels?.items ?? emptyPixels.items };
  const items = merged.items.length > 0 ? merged.items : pixelsFromLegacy(merged);
  return syncPixelLegacy({ ...merged, items });
}

export function listPixelItems(pixels: PixelSettings) {
  return normalizePixels(pixels).items;
}

export function pixelsAreActive(pixels: PixelSettings) {
  return listPixelItems(pixels).some(
    (item) => item.enabled && Boolean(item.pixelId || item.adsId || item.html?.trim()),
  );
}

function filledSecret(value?: string) {
  return Boolean(value?.trim() && !value.includes("•"));
}

export function mergePixelLists(left?: PixelSettings | null, right?: PixelSettings | null): PixelSettings {
  const a = normalizePixels(left);
  const b = normalizePixels(right);
  const byId = new Map<string, PixelItem>();
  for (const item of [...a.items, ...b.items]) {
    const prev = byId.get(item.id);
    if (!prev) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      ...prev,
      ...item,
      enabled: item.enabled || prev.enabled,
      pixelId: item.pixelId || prev.pixelId,
      adsId: item.adsId || prev.adsId,
      html: item.html || prev.html,
      accessToken: filledSecret(item.accessToken) ? item.accessToken : prev.accessToken || item.accessToken,
    });
  }
  return syncPixelLegacy({ ...a, ...b, items: [...byId.values()] });
}

export function maskPixelSettings(pixels: PixelSettings, mask: (value: string) => string): PixelSettings {
  const n = normalizePixels(pixels);
  return {
    ...n,
    metaAccessToken: mask(n.metaAccessToken),
    items: n.items.map((item) => ({
      ...item,
      accessToken: mask(item.accessToken ?? ""),
    })),
  };
}

export function mergePixelSecrets(incoming: PixelSettings, stored: PixelSettings): PixelSettings {
  const next = normalizePixels(incoming);
  const prev = normalizePixels(stored);
  if (next.items.length === 0 && prev.items.length > 0) return prev;
  return mergePixelLists(prev, next);
}

/** Aplica o que o admin salvou: a lista enviada manda, tokens mascarados ficam os antigos. */
export function applySavedPixels(incoming: PixelSettings, stored: PixelSettings): PixelSettings {
  const next = normalizePixels(incoming);
  const prevById = new Map(normalizePixels(stored).items.map((item) => [item.id, item]));
  const items = next.items.map((item) => {
    const old = prevById.get(item.id);
    return {
      ...item,
      accessToken: filledSecret(item.accessToken) ? item.accessToken : old?.accessToken || item.accessToken,
    };
  });
  return syncPixelLegacy({ ...next, items });
}

export function publicPixels(pixels: PixelSettings): PublicTrackingSettings["pixels"] {
  const n = normalizePixels(pixels);
  return {
    ...n,
    metaAccessToken: "",
    items: n.items.map(({ accessToken: _token, ...item }) => item),
  };
}

export function metaCapiTargets(pixels: PixelSettings) {
  return normalizePixels(pixels).items.filter(
    (item) =>
      item.kind === "meta" &&
      item.enabled &&
      item.pixelId.trim() &&
      Boolean(item.accessToken?.trim()) &&
      !item.accessToken?.includes("•"),
  );
}

export function tiktokCapiTargets(pixels: PixelSettings) {
  return normalizePixels(pixels).items.filter(
    (item) =>
      item.kind === "tiktok" &&
      item.enabled &&
      item.pixelId.trim() &&
      Boolean(item.accessToken?.trim()) &&
      !item.accessToken?.includes("•"),
  );
}

export const emptyUtmfy: UtmfySettings = {
  enabled: true,
  pixelId: UTMIFY_PIXEL_ID,
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
  const paidOrders = orders.filter((order) => orderStatus(order) === "paid").length;
  const purchase = Math.max(sessionsWith(events, "purchase"), paidOrders);
  const pix = Math.max(sessionsWith(events, "generate_pix"), orders.length, purchase);
  const shipping = Math.max(sessionsWith(events, "checkout_shipping"), pix);
  const identify = Math.max(sessionsWith(events, "checkout_identify"), shipping);
  const checkout = Math.max(sessionsWith(events, "begin_checkout"), identify);
  const cart = Math.max(
    sessionsWith(events, "view_cart"),
    sessionsWith(events, "add_to_cart"),
    checkout,
  );
  const product = Math.max(sessionsWith(events, "view_item"), cart);
  const start = Math.max(uniqueSessions(events), pix);
  const steps = [
    { id: "sessions", label: "Visitantes", count: start },
    { id: "view_item", label: "Viram produto", count: product },
    { id: "add_to_cart", label: "Adicionaram à sacola", count: cart },
    { id: "view_cart", label: "Abriram a sacola", count: cart },
    { id: "begin_checkout", label: "Iniciaram checkout", count: checkout },
    { id: "checkout_identify", label: "Identificação", count: identify },
    { id: "checkout_shipping", label: "Entrega", count: shipping },
    { id: "generate_pix", label: "PIX gerado", count: pix },
    { id: "purchase", label: "Pagaram", count: purchase },
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

export const ONLINE_MS = 3 * 60_000;
export const RECENT_MS = 60 * 24 * 60 * 60_000;

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
  period?: Period,
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
    orderBySession.set(`order:${order.id}`, order);
  }

  const ids = new Set<string>([
    ...grouped.keys(),
    ...visitors.map((visitor) => visitor.sessionId),
    ...orders.map((order) => order.sessionId || `order:${order.id}`),
  ]);
  const sessions: LiveSession[] = [];

  for (const sessionId of ids) {
    const trail = (grouped.get(sessionId) ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));
    const visitor = visitors.find((item) => item.sessionId === sessionId);
    const last = trail[trail.length - 1];
    const lastTs = visitor?.lastTs && (!last || visitor.lastTs >= last.ts) ? visitor.lastTs : last?.ts ?? orderBySession.get(sessionId)?.createdAt;
    if (!lastTs) continue;
    if (period) {
      if (!inPeriod(lastTs, period, now) && !trail.some((event) => inPeriod(event.ts, period, now))) continue;
    } else if (now - new Date(lastTs).getTime() > RECENT_MS) continue;

    const startedAt = visitor?.startedAt ?? trail[0]?.ts ?? lastTs;
    const path = visitor?.path ?? last?.path ?? "/";
    const lastMeaningful =
      [...trail].reverse().find((event) => event.name !== "heartbeat" && event.name !== "page_view") ??
      last ??
      ({ name: visitor?.lastEvent || "page_view" } as AnalyticsEvent);
    const order =
      orderBySession.get(sessionId) ??
      orders.find((item) => item.sessionId === sessionId || `order:${item.id}` === sessionId || item.id === sessionId);
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
      ? customerName(order.data)
      : visitor?.name ||
        visitor?.email ||
        String([...trail].reverse().find((event) => event.props?.email)?.props?.email ?? "") ||
        undefined;

    sessions.push({
      sessionId,
      path,
      device: visitor?.device ?? last?.device ?? "mobile",
      attribution: visitor?.attribution ?? last?.attribution ?? {},
      lastEvent: visitor?.lastEvent && visitor.lastEvent !== "heartbeat" ? visitor.lastEvent : lastMeaningful.name,
      lastTs,
      startedAt,
      online: isOnline(lastTs, now),
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

export const ABANDON_MS = 5 * 60_000;
const CART_INTENT = new Set([
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "checkout_identify",
  "checkout_shipping",
  "checkout_payment",
  "generate_pix",
]);

export type AbandonedStage =
  | "product"
  | "cart"
  | "checkout"
  | "identify"
  | "shipping"
  | "payment"
  | "pix";

export interface AbandonedDropOff {
  id: AbandonedStage;
  label: string;
  hint: string;
}

export interface AbandonedCart {
  sessionId: string;
  lastTs: string;
  startedAt: string;
  path: string;
  device: DeviceType;
  attribution: Attribution;
  lastEvent: string;
  stepIndex: number;
  dropOff: AbandonedDropOff;
  items: AbandonedCartItem[];
  value: number;
  qty: number;
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  shipping?: string;
  order?: OrderSummary;
  events: AnalyticsEvent[];
}

function propText(props: Record<string, unknown> | undefined, key: string) {
  const value = props?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeCartItems(raw: unknown): AbandonedCartItem[] {
  if (!Array.isArray(raw)) return [];
  const items: AbandonedCartItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = Number(row.id);
    const qty = Math.max(1, Number(row.qty) || 1);
    const price = Number(row.price) || 0;
    const title = String(row.title ?? (Number.isFinite(id) ? getProduct(id)?.titulo : "") ?? "").trim();
    if (!title && !Number.isFinite(id)) continue;
    const product = Number.isFinite(id) ? getProduct(id) : undefined;
    items.push({
      id: Number.isFinite(id) ? id : 0,
      title: title || product?.titulo || `Produto ${id}`,
      size: typeof row.size === "string" && row.size ? row.size : undefined,
      qty,
      price: price || (product ? parsePrice(product.preco) : 0),
      photo: typeof row.photo === "string" && row.photo ? row.photo : product?.fotos[0],
    });
  }
  return items;
}

function itemsFromAddToCart(events: AnalyticsEvent[]): AbandonedCartItem[] {
  const lines = new Map<string, AbandonedCartItem>();
  for (const event of events) {
    if (event.name !== "add_to_cart") continue;
    const ids = event.props?.content_ids;
    const raw = Array.isArray(ids) ? ids[0] : ids;
    const id = Number(raw ?? event.path.split("/")[2]);
    const product = Number.isFinite(id) ? getProduct(id) : undefined;
    const title = propText(event.props, "content_name") || product?.titulo || productFromEvent(event) || "Produto";
    const size = propText(event.props, "size") || undefined;
    const key = `${Number.isFinite(id) ? id : title}-${size ?? ""}`;
    const prev = lines.get(key);
    lines.set(key, {
      id: Number.isFinite(id) ? id : prev?.id ?? 0,
      title,
      size,
      qty: (prev?.qty ?? 0) + 1,
      price: Number(event.props?.value) || prev?.price || (product ? parsePrice(product.preco) : 0),
      photo: prev?.photo || product?.fotos[0],
    });
  }
  return [...lines.values()];
}

function itemsForSession(
  events: AnalyticsEvent[],
  visitor?: PresenceVisitor,
  order?: OrderSummary,
): AbandonedCartItem[] {
  if (order?.items?.length) {
    return order.items.map((item) => ({
      id: item.id,
      title: item.title,
      size: item.size,
      qty: item.qty,
      price: item.price,
      photo: item.photo,
    }));
  }
  if (visitor?.cartItems?.length) return visitor.cartItems;
  for (const event of [...events].reverse()) {
    const fromProps = normalizeCartItems(event.props?.cart_items);
    if (fromProps.length) return fromProps;
  }
  return itemsFromAddToCart(events);
}

function dropOffFor(stepIndex: number, lastEvent: string, path: string): AbandonedDropOff {
  const page = pageLabel(path);
  if (stepIndex >= 6 || lastEvent === "generate_pix") {
    return {
      id: "pix",
      label: "Gerou o PIX e não pagou",
      hint: `Última página: ${page}`,
    };
  }
  if (lastEvent === "checkout_payment") {
    return {
      id: "payment",
      label: "Parou no pagamento",
      hint: `Chegou no PIX e saiu · ${page}`,
    };
  }
  if (lastEvent === "checkout_shipping" || stepIndex >= 5) {
    return {
      id: "shipping",
      label: "Parou no pagamento",
      hint: `Informou a entrega e não gerou o PIX · ${page}`,
    };
  }
  if (lastEvent === "checkout_identify" || stepIndex >= 4) {
    return {
      id: "identify",
      label: "Parou depois dos dados",
      hint: `Preencheu nome e e-mail e não avançou a entrega · ${page}`,
    };
  }
  if (lastEvent === "begin_checkout" || stepIndex >= 3) {
    return {
      id: "checkout",
      label: "Parou na identificação",
      hint: `Abriu o checkout e não preencheu os dados · ${page}`,
    };
  }
  if (lastEvent === "view_cart" || path.startsWith("/carrinho")) {
    return {
      id: "cart",
      label: "Abriu a sacola e saiu",
      hint: `Não foi para o checkout · ${page}`,
    };
  }
  return {
    id: "product",
    label: "Adicionou à sacola e saiu",
    hint: `Colocou o produto na sacola e não continuou · ${page}`,
  };
}

export function buildAbandonedCarts(
  events: AnalyticsEvent[],
  orders: OrderSummary[],
  visitors: PresenceVisitor[],
  now = Date.now(),
): AbandonedCart[] {
  const grouped = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const list = grouped.get(event.sessionId) ?? [];
    list.push(event);
    grouped.set(event.sessionId, list);
  }

  const orderBySession = new Map<string, OrderSummary>();
  const orphanOrders: OrderSummary[] = [];
  for (const order of orders) {
    if (orderStatus(order) === "paid") continue;
    if (order.sessionId) orderBySession.set(order.sessionId, order);
    else orphanOrders.push(order);
  }

  const ids = new Set<string>([
    ...grouped.keys(),
    ...visitors.map((visitor) => visitor.sessionId),
    ...orderBySession.keys(),
  ]);

  const carts: AbandonedCart[] = [];

  for (const sessionId of ids) {
    const trail = (grouped.get(sessionId) ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));
    const visitor = visitors.find((item) => item.sessionId === sessionId);
    const last = trail[trail.length - 1];
    const lastTs = visitor?.lastTs && (!last || visitor.lastTs >= last.ts) ? visitor.lastTs : last?.ts;
    const order = orderBySession.get(sessionId);
    const paid = trail.some((event) => event.name === "purchase") || (order && orderStatus(order) === "paid");
    if (paid) continue;

    const hasIntent =
      Boolean(order) ||
      Boolean(visitor?.cartItems?.length) ||
      trail.some(
        (event) =>
          CART_INTENT.has(event.name) ||
          normalizeCartItems(event.props?.cart_items).length > 0 ||
          Number(event.props?.cart_qty) > 0,
      );
    if (!hasIntent) continue;

    const startedAt = visitor?.startedAt ?? trail[0]?.ts ?? lastTs ?? order?.createdAt;
    const stamp = lastTs ?? order?.createdAt;
    if (!stamp || !startedAt) continue;

    const online = Boolean(visitor && isOnline(visitor.lastTs, now)) || isOnline(stamp, now);
    if (online || now - new Date(stamp).getTime() < ABANDON_MS) continue;

    const path = visitor?.path ?? last?.path ?? (order ? "/pedido" : "/");
    const lastMeaningful =
      [...trail].reverse().find((event) => event.name !== "heartbeat" && event.name !== "page_view") ?? last;
    const lastEvent =
      visitor?.lastEvent && visitor.lastEvent !== "heartbeat"
        ? visitor.lastEvent
        : lastMeaningful?.name ?? (order ? "generate_pix" : "add_to_cart");
    const fromEvents = stepIndexFromEvents(trail);
    const fromPath = stepIndexFromPath(path);
    const fromOrder = order ? 6 : 0;
    const stepIndex = Math.max(fromEvents, fromPath, fromOrder);
    const items = itemsForSession(trail, visitor, order);
    const eventValue = Number(
      [...trail].reverse().find((event) => Number(event.props?.value ?? event.props?.total))?.props?.value ?? 0,
    );
    const value =
      order?.total ||
      visitor?.cartValue ||
      items.reduce((acc, item) => acc + item.price * item.qty, 0) ||
      eventValue;
    if (items.length === 0 && !order && value <= 0) continue;

    const emailEvent = [...trail].reverse().find((event) => propText(event.props, "email"));
    const nameEvent = [...trail].reverse().find((event) => propText(event.props, "name"));
    const phoneEvent = [...trail].reverse().find((event) => propText(event.props, "phone"));
    const cityEvent = [...trail].reverse().find((event) => propText(event.props, "city"));
    const stateEvent = [...trail].reverse().find((event) => propText(event.props, "state"));
    const shipEvent = [...trail].reverse().find((event) => propText(event.props, "shipping"));

    carts.push({
      sessionId,
      lastTs: stamp,
      startedAt,
      path,
      device: visitor?.device ?? last?.device ?? "mobile",
      attribution: visitor?.attribution ?? last?.attribution ?? order?.attribution ?? {},
      lastEvent,
      stepIndex,
      dropOff: dropOffFor(stepIndex, lastEvent, path),
      items,
      value,
      qty: items.reduce((acc, item) => acc + item.qty, 0),
      name: order ? customerName(order.data) : visitor?.name || propText(nameEvent?.props, "name") || undefined,
      email: order?.data.email || visitor?.email || propText(emailEvent?.props, "email") || undefined,
      phone: order?.data.phone || visitor?.phone || propText(phoneEvent?.props, "phone") || undefined,
      city: order?.data.city || visitor?.city || propText(cityEvent?.props, "city") || undefined,
      state: order?.data.state || visitor?.state || propText(stateEvent?.props, "state") || undefined,
      shipping:
        order?.data.shippingMethod || visitor?.shipping || propText(shipEvent?.props, "shipping") || undefined,
      order,
      events: trail,
    });
  }

  for (const order of orphanOrders) {
    if (now - new Date(order.createdAt).getTime() < ABANDON_MS) continue;
    carts.push({
      sessionId: `order:${order.id}`,
      lastTs: order.createdAt,
      startedAt: order.createdAt,
      path: "/pedido",
      device: "mobile",
      attribution: order.attribution ?? {},
      lastEvent: "generate_pix",
      stepIndex: 6,
      dropOff: dropOffFor(6, "generate_pix", "/pedido"),
      items: order.items.map((item) => ({
        id: item.id,
        title: item.title,
        size: item.size,
        qty: item.qty,
        price: item.price,
        photo: item.photo,
      })),
      value: order.total,
      qty: order.items.reduce((acc, item) => acc + item.qty, 0),
      name: customerName(order.data),
      email: order.data.email,
      phone: order.data.phone,
      city: order.data.city,
      state: order.data.state,
      shipping: order.data.shippingMethod,
      order,
      events: [],
    });
  }

  return carts.sort((a, b) => b.lastTs.localeCompare(a.lastTs) || b.value - a.value);
}

export function abandonedStageLabel(id: AbandonedStage) {
  const map: Record<AbandonedStage, string> = {
    product: "Saiu no produto",
    cart: "Saiu na sacola",
    checkout: "Saiu na identificação",
    identify: "Saiu na entrega",
    shipping: "Saiu no pagamento",
    payment: "Saiu no pagamento",
    pix: "PIX sem pagar",
  };
  return map[id];
}
