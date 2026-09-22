export const TIKTOK_PIXEL_SRC = "https://analytics.tiktok.com/i18n/pixel/events.js";

export interface TikTokQueue {
  track: (...args: unknown[]) => void;
  page: (...args: unknown[]) => void;
  load: (id: string, opts?: Record<string, unknown>) => void;
  identify: (data: Record<string, string>) => void;
  instance?: (id: string) => TikTokQueue;
  methods?: string[];
  _i?: Record<string, unknown>;
  _t?: Record<string, number>;
  _o?: Record<string, unknown>;
  push?: (...args: unknown[]) => number;
}

declare global {
  interface Window {
    TiktokAnalyticsObject?: "ttq";
    ttq?: TikTokQueue;
  }
}

function envPixelId() {
  return (typeof process !== "undefined" ? process.env.TIKTOK_PIXEL_ID ?? "" : "").trim();
}

function isOfficialTtq(ttq?: TikTokQueue) {
  return Boolean(ttq && (Array.isArray(ttq) || ttq.methods || ttq._i));
}

function installTtq() {
  const w = window;
  if (w.ttq && !isOfficialTtq(w.ttq)) {
    delete w.ttq;
    delete w.TiktokAnalyticsObject;
  }
  if (isOfficialTtq(w.ttq)) return w.ttq!;
  w.TiktokAnalyticsObject = "ttq";
  const ttq = [] as unknown as TikTokQueue;
  w.ttq = ttq;
  ttq.methods = [
    "page",
    "track",
    "identify",
    "instances",
    "debug",
    "on",
    "off",
    "once",
    "ready",
    "alias",
    "group",
    "enableCookie",
    "disableCookie",
  ];
  const setAndDefer = (target: TikTokQueue, method: string) => {
    (target as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
      (target as unknown as unknown[]).push([method, ...args]);
    };
  };
  for (const method of ttq.methods) setAndDefer(ttq, method);
  ttq.instance = (id: string) => {
    const bag = ((ttq._i ??= {})[id] ??= []) as unknown as TikTokQueue;
    for (const method of ttq.methods ?? []) setAndDefer(bag, method);
    return bag;
  };
  ttq.load = (id: string, opts?: Record<string, unknown>) => {
    const src = `${TIKTOK_PIXEL_SRC}?sdkid=${encodeURIComponent(id)}&lib=ttq`;
    ttq._i ??= {};
    ttq._i[id] ??= [];
    ttq._t ??= {};
    ttq._t[id] = Date.now();
    ttq._o ??= {};
    ttq._o[id] = opts ?? {};
    if (document.querySelector(`script[src^="${TIKTOK_PIXEL_SRC}"]`)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(script, first);
  };
  return ttq;
}

const loaded = new Set<string>();

export function injectTikTokPixel(pixelId?: string) {
  if (typeof window === "undefined") return;
  if (window.location.pathname.toLowerCase().startsWith("/admin")) return;
  const id = (pixelId ?? envPixelId()).trim();
  if (!id) return;
  const ttq = installTtq();
  if (!loaded.has(id)) {
    ttq.load(id);
    loaded.add(id);
  }
  ttq.page();
}

export function identifyTikTok(user: { email?: string; phone?: string; externalId?: string }) {
  if (typeof window === "undefined" || !window.ttq?.identify) return;
  const email = user.email?.trim().toLowerCase();
  const digits = user.phone?.replace(/\D/g, "") ?? "";
  const phone = digits ? (digits.startsWith("55") ? digits : `55${digits}`) : "";
  if (!email && !phone && !user.externalId) return;
  window.ttq.identify({
    ...(email ? { email } : {}),
    ...(phone ? { phone_number: phone } : {}),
    ...(user.externalId ? { external_id: user.externalId } : {}),
  });
}

export function trackTikTok(event: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.ttq?.track) return;
  window.ttq.track(event, props ?? {});
}

export function tiktokHeadScript(pixelId = envPixelId()) {
  const id = pixelId.trim();
  if (!id) return "";
  return `(function(w,d,t){if(location.pathname.toLowerCase().indexOf("/admin")===0)return;w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(obj,m){obj[m]=function(){obj.push([m].concat([].slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(id){for(var n=0,e=ttq._i[id]||[];n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r="${TIKTOK_PIXEL_SRC}",o=d.createElement("script");ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{},o.async=!0,o.src=r+"?sdkid="+e+"&lib="+t;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(o,s)};ttq.load("${id}");ttq.page();})(window,document,"ttq");`;
}
