export const FUNNEL_EVENTS = [
  "page_view",
  "view_item",
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "checkout_identify",
  "checkout_shipping",
  "checkout_payment",
  "generate_pix",
  "purchase",
  "search",
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];

export type DeviceType = "mobile" | "tablet" | "desktop";

export interface Attribution {
  src?: string;
  sck?: string;
  utm_source?: string;
  utm_campaign?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
  landing?: string;
  referrer?: string;
  [key: string]: string | undefined;
}

export interface AnalyticsEvent {
  id: string;
  name: FunnelEventName | string;
  ts: string;
  sessionId: string;
  path: string;
  title?: string;
  device: DeviceType;
  attribution: Attribution;
  props?: Record<string, any>;
}

const SESSION_KEY = "asics-session-id";
const ATTR_KEY = "asics-attribution";
const EVENTS_KEY = "asics-analytics-events";
const MAX_LOCAL_EVENTS = 800;

export function newId(prefix = "ev") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function detectDevice(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): DeviceType {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android/i.test(ua)) return "mobile";
  return "desktop";
}

function readParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function captureAttribution(): Attribution {
  const params = readParams();
  const next: Attribution = {
    src: params.get("src") ?? undefined,
    sck: params.get("sck") ?? undefined,
    utm_source: params.get("utm_source") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_content: params.get("utm_content") ?? undefined,
    utm_term: params.get("utm_term") ?? undefined,
    fbclid: params.get("fbclid") ?? undefined,
    gclid: params.get("gclid") ?? undefined,
    ttclid: params.get("ttclid") ?? undefined,
  };

  let stored: Attribution = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(ATTR_KEY) || "{}") as Attribution;
  } catch {
    stored = {};
  }

  const hasNew = Object.values(next).some(Boolean);
  const merged: Attribution = {
    ...stored,
    ...(hasNew ? next : {}),
    landing: stored.landing || (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/"),
    referrer:
      stored.referrer ||
      (typeof document !== "undefined" && document.referrer && !document.referrer.includes(window.location.host)
        ? document.referrer
        : undefined),
  };

  try {
    window.localStorage.setItem(ATTR_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  return merged;
}

export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ATTR_KEY);
    if (raw) return JSON.parse(raw) as Attribution;
  } catch {
    // ignore
  }
  return captureAttribution();
}

export function getSessionId() {
  if (typeof window === "undefined") return "ssr";
  let id = window.sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = newId("ses");
    window.sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function loadLocalEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EVENTS_KEY);
    return raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

function persistLocalEvent(event: AnalyticsEvent) {
  const events = [...loadLocalEvents(), event].slice(-MAX_LOCAL_EVENTS);
  try {
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // ignore
  }
}

export function buildEvent(
  name: FunnelEventName | string,
  props?: Record<string, unknown>,
  path?: string,
): AnalyticsEvent {
  return {
    id: newId(),
    name,
    ts: new Date().toISOString(),
    sessionId: getSessionId(),
    path: path ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search),
    title: typeof document === "undefined" ? undefined : document.title,
    device: detectDevice(),
    attribution: getAttribution(),
    props,
  };
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    ttq?: { track: (...args: unknown[]) => void; page: () => void; load: (id: string) => void };
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    kwaiq?: { track: (...args: unknown[]) => void; load: (id: string) => void };
    snaptr?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    pintrk?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    pixelId?: string;
  }
}

export function firePixels(event: AnalyticsEvent) {
  if (typeof window === "undefined") return;
  const value = Number(event.props?.value ?? event.props?.total ?? 0);
  const currency = "BRL";
  const contentIds = (event.props?.content_ids as string[] | undefined) ?? [];
  const contentName = String(event.props?.content_name ?? "");

  const metaMap: Record<string, string> = {
    page_view: "PageView",
    view_item: "ViewContent",
    add_to_cart: "AddToCart",
    view_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    checkout_identify: "InitiateCheckout",
    checkout_payment: "AddPaymentInfo",
    generate_pix: "AddPaymentInfo",
    purchase: "Purchase",
    search: "Search",
  };
  const meta = metaMap[event.name];
  if (meta && window.fbq) {
    const eventID = String(event.props?.event_id ?? event.props?.order_id ?? event.id);
    window.fbq(
      "track",
      meta,
      {
        value: value || undefined,
        currency,
        content_ids: contentIds,
        content_name: contentName || undefined,
        content_type: "product",
      },
      { eventID },
    );
  }

  const ttMap: Record<string, string> = {
    view_item: "ViewContent",
    add_to_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    generate_pix: "AddPaymentInfo",
    purchase: "CompletePayment",
    search: "Search",
  };
  const tt = ttMap[event.name];
  if (tt && window.ttq?.track) {
    window.ttq.track(tt, {
      value: value || undefined,
      currency,
      contents: contentIds.map((id) => ({ content_id: id, content_type: "product" })),
    });
  }

  const gMap: Record<string, string> = {
    view_item: "view_item",
    add_to_cart: "add_to_cart",
    begin_checkout: "begin_checkout",
    generate_pix: "add_payment_info",
    purchase: "purchase",
    search: "search",
  };
  const g = gMap[event.name];
  if (g && window.gtag) {
    window.gtag("event", g, {
      value: value || undefined,
      currency,
      transaction_id: event.props?.order_id,
      items: contentIds.map((id) => ({ item_id: id, item_name: contentName })),
    });
  }

  if (event.name === "purchase" && window.kwaiq?.track) {
    window.kwaiq.track("purchase", { value, currency });
  }
  if (event.name === "purchase" && window.snaptr) {
    window.snaptr("track", "PURCHASE", { price: value, currency });
  }
  if (event.name === "purchase" && window.pintrk) {
    window.pintrk("track", "checkout", { value, currency });
  }
}

type Ingest = (event: AnalyticsEvent) => void;

let ingestRef: Ingest | null = null;
let lastTrackedName = "page_view";

export function setEventIngest(fn: Ingest | null) {
  ingestRef = fn;
}

export function getLastTrackedName() {
  return lastTrackedName;
}

export function track(name: FunnelEventName | string, props?: Record<string, unknown>, path?: string) {
  if (typeof window === "undefined") return;
  const event = buildEvent(name, props, path);
  if (name !== "heartbeat") lastTrackedName = name;
  persistLocalEvent(event);
  firePixels(event);
  ingestRef?.(event);
  return event;
}
