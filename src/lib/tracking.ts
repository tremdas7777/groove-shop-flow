import { cartTrackingProps } from "@/lib/cart-snapshot";
import { identifyTikTok, trackTikTok } from "@/lib/tiktok-pixel";

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
  xcod?: string;
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
const MAX_LOCAL_EVENTS = 2000;

export function newId(prefix = "ev") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function detectDevice(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): DeviceType {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android/i.test(ua)) return "mobile";
  return "desktop";
}

export const TRACKING_SEARCH_KEYS = [
  "src",
  "sck",
  "xcod",
  "utm_source",
  "utm_campaign",
  "utm_medium",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ttclid",
] as const;

const UTMIFY_KEYS = TRACKING_SEARCH_KEYS;

export type TrackingSearch = Partial<Record<(typeof TRACKING_SEARCH_KEYS)[number], string>>;

export function pickTrackingSearch(search: Record<string, unknown> = {}): TrackingSearch {
  const next: TrackingSearch = {};
  for (const key of TRACKING_SEARCH_KEYS) {
    const value = cleanAttrValue(typeof search[key] === "string" ? search[key] : undefined);
    if (value) next[key] = value;
  }
  return next;
}

export function keepTrackingSearch<T extends Record<string, unknown>>(search: T): T & TrackingSearch {
  return { ...search, ...pickTrackingSearch(search) };
}

export function compactAttribution(attr?: Attribution): Attribution {
  const next: Attribution = {};
  if (!attr) return next;
  for (const key of TRACKING_SEARCH_KEYS) {
    const value = cleanAttrValue(attr[key]);
    if (!value || value.includes("{{") || value.includes("}}")) continue;
    next[key] = value;
  }
  return inferAdSource(next);
}

export function hasCampaignTracking(attr?: Attribution) {
  const next = compactAttribution(attr);
  return Boolean(next.utm_source || next.utm_campaign || next.src || next.sck || next.fbclid || next.gclid || next.ttclid);
}

export const attributionHeadScript = `(function(){if(location.pathname.toLowerCase().indexOf("/admin")===0)return;var k=["src","sck","xcod","utm_source","utm_campaign","utm_medium","utm_content","utm_term","fbclid","gclid","ttclid"];var p=new URLSearchParams(location.search);var n={};k.forEach(function(key){var v=p.get(key);if(v&&v!=="null"&&v!=="undefined"){n[key]=v;try{localStorage.setItem(key,v);localStorage.setItem(key+"_exp",new Date(Date.now()+7*864e5).toISOString());}catch(e){}}});if(n.fbclid&&!n.utm_source)n.utm_source="FB";try{var prev=JSON.parse(localStorage.getItem("${ATTR_KEY}")||"{}");var m=Object.assign({},prev,n);if(!m.landing)m.landing=location.pathname+location.search;localStorage.setItem("${ATTR_KEY}",JSON.stringify(m));}catch(e){}})();`;

function cleanAttrValue(value?: string | null) {
  const next = value?.trim();
  if (!next || next === "null" || next === "undefined") return undefined;
  return next;
}

function mergeAttribution(...parts: Array<Attribution | undefined>): Attribution {
  const merged: Attribution = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      const clean = cleanAttrValue(value);
      if (clean && !merged[key]) merged[key] = clean;
    }
  }
  return inferAdSource(merged);
}

function inferAdSource(attr: Attribution): Attribution {
  if (attr.utm_source) return attr;
  if (attr.fbclid) return { ...attr, utm_source: "FB" };
  if (attr.ttclid) return { ...attr, utm_source: "tiktok" };
  if (attr.gclid) return { ...attr, utm_source: "google" };
  return attr;
}

function readParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function readUtmifyStored(): Attribution {
  if (typeof window === "undefined") return {};
  const fromStorage: Attribution = {};
  for (const key of UTMIFY_KEYS) {
    try {
      const exp = window.localStorage.getItem(`${key}_exp`);
      if (exp && new Date(exp) < new Date()) continue;
      const value = cleanAttrValue(window.localStorage.getItem(key));
      if (value) fromStorage[key] = value;
    } catch {
      // ignore
    }
  }
  const params = window.utmParams;
  const fromScript: Attribution = {};
  if (params && typeof params.get === "function") {
    for (const key of UTMIFY_KEYS) {
      const value = cleanAttrValue(params.get(key));
      if (value) fromScript[key] = value;
    }
  }
  return mergeAttribution(fromScript, fromStorage);
}

export function captureAttribution(): Attribution {
  const params = readParams();
  const next: Attribution = {
    src: cleanAttrValue(params.get("src")),
    sck: cleanAttrValue(params.get("sck")),
    xcod: cleanAttrValue(params.get("xcod")),
    utm_source: cleanAttrValue(params.get("utm_source")),
    utm_campaign: cleanAttrValue(params.get("utm_campaign")),
    utm_medium: cleanAttrValue(params.get("utm_medium")),
    utm_content: cleanAttrValue(params.get("utm_content")),
    utm_term: cleanAttrValue(params.get("utm_term")),
    fbclid: cleanAttrValue(params.get("fbclid")),
    gclid: cleanAttrValue(params.get("gclid")),
    ttclid: cleanAttrValue(params.get("ttclid")),
  };

  let stored: Attribution = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(ATTR_KEY) || "{}") as Attribution;
  } catch {
    stored = {};
  }

  const merged = mergeAttribution(next, readUtmifyStored(), stored, {
    landing: stored.landing || (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/"),
    referrer:
      stored.referrer ||
      (typeof document !== "undefined" && document.referrer && !document.referrer.includes(window.location.host)
        ? document.referrer
        : undefined),
  });

  try {
    window.localStorage.setItem(ATTR_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  return merged;
}

export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
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
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    kwaiq?: { track: (...args: unknown[]) => void; load: (id: string) => void };
    snaptr?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    pintrk?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    pixelId?: string;
    utmParams?: URLSearchParams;
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

  const email = String(event.props?.email ?? "").trim();
  const phone = String(event.props?.phone ?? "").trim();
  identifyTikTok({
    email: email || undefined,
    phone: phone || undefined,
    externalId: event.sessionId,
  });
  if (event.name === "page_view") {
    window.ttq?.page?.();
  }
  const ttMap: Record<string, string> = {
    view_item: "ViewContent",
    add_to_cart: "AddToCart",
    view_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    checkout_identify: "InitiateCheckout",
    checkout_payment: "AddPaymentInfo",
    generate_pix: "PlaceAnOrder",
    purchase: "CompletePayment",
    search: "Search",
  };
  const tt = ttMap[event.name];
  if (tt) {
    const cartItems = Array.isArray(event.props?.cart_items) ? event.props.cart_items : [];
    const contents = cartItems.length
      ? cartItems.map((item: { id?: number; title?: string; qty?: number; price?: number }) => ({
          content_id: String(item.id ?? ""),
          content_type: "product",
          content_name: item.title,
          quantity: item.qty ?? 1,
          price: item.price,
        }))
      : contentIds.map((id) => ({
          content_id: id,
          content_type: "product",
          content_name: contentName || undefined,
        }));
    trackTikTok(tt, {
      value: value || undefined,
      currency,
      contents,
      content_type: "product",
      content_id: contentIds[0],
      content_name: contentName || undefined,
      event_id: String(event.props?.event_id ?? event.props?.order_id ?? event.id),
    });
    if (event.name === "generate_pix") {
      trackTikTok("AddPaymentInfo", {
        value: value || undefined,
        currency,
        contents,
        event_id: `${event.props?.order_id ?? event.id}-pay`,
      });
    }
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

function mergeTrackProps(name: string, props?: Record<string, unknown>) {
  const cart = name === "purchase" ? {} : cartTrackingProps();
  const merged: Record<string, unknown> = { ...cart, ...props };
  if (!(Number(merged.value) > 0) && Number(cart.value) > 0) merged.value = cart.value;
  if ((!Array.isArray(merged.content_ids) || merged.content_ids.length === 0) && cart.content_ids) {
    merged.content_ids = cart.content_ids;
  }
  if (!Array.isArray(merged.cart_items) && cart.cart_items) merged.cart_items = cart.cart_items;
  return Object.keys(merged).length ? merged : props;
}

export function track(name: FunnelEventName | string, props?: Record<string, unknown>, path?: string) {
  if (typeof window === "undefined") return;
  const event = buildEvent(name, mergeTrackProps(name, props), path);
  if (name !== "heartbeat") lastTrackedName = name;
  persistLocalEvent(event);
  firePixels(event);
  ingestRef?.(event);
  return event;
}
