import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { getPublicTrackingSettings, heartbeatVisitor, ingestStoreEvent } from "@/lib/admin-api";
import type { PublicTrackingSettings } from "@/lib/admin";
import { listPixelItems } from "@/lib/admin";
import { loadPublicSettings, touchLocalPresence } from "@/lib/admin-local";
import { describeCart, readStoredCart } from "@/lib/cart-snapshot";
import { loadCheckoutDraft } from "@/lib/checkout";
import {
  captureAttribution,
  detectDevice,
  getAttribution,
  getLastTrackedName,
  getSessionId,
  setEventIngest,
  track,
} from "@/lib/tracking";

function isAdminPath(path: string) {
  return path.toLowerCase().startsWith("/admin");
}

function ensureScript(src: string, attrs: Record<string, string> = {}) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  for (const [key, value] of Object.entries(attrs)) script.setAttribute(key, value);
  document.head.appendChild(script);
}

function injectPixels(settings: PublicTrackingSettings) {
  const items = listPixelItems(settings.pixels).filter(
    (item) => item.enabled && Boolean(item.pixelId || item.adsId || item.html?.trim()),
  );
  const inited = {
    meta: new Set<string>(),
    google: new Set<string>(),
    tiktok: new Set<string>(),
    kwai: new Set<string>(),
    snap: new Set<string>(),
    pinterest: new Set<string>(),
  };

  for (const item of items) {
    if (item.kind === "meta" && item.pixelId && !inited.meta.has(item.pixelId)) {
      if (!window.fbq) {
        const stub = function (...args: unknown[]) {
          (stub as { queue: unknown[]; callMethod?: (...a: unknown[]) => void }).queue.push(args);
        } as ((...args: unknown[]) => void) & { queue: unknown[]; loaded: boolean; version: string };
        stub.queue = [];
        stub.loaded = true;
        stub.version = "2.0";
        window.fbq = stub;
        ensureScript("https://connect.facebook.net/en_US/fbevents.js");
      }
      window.fbq("init", item.pixelId);
      if (inited.meta.size === 0) window.fbq("track", "PageView");
      inited.meta.add(item.pixelId);
    }

    if (item.kind === "google" && (item.pixelId || item.adsId)) {
      const ids = [item.pixelId, item.adsId].filter(Boolean) as string[];
      const primary = ids[0];
      if (!window.gtag && primary) {
        window.dataLayer = window.dataLayer ?? [];
        window.gtag = function (...args: unknown[]) {
          window.dataLayer?.push(args);
        };
        window.gtag("js", new Date());
        ensureScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(primary)}`);
      }
      for (const id of ids) {
        if (inited.google.has(id)) continue;
        window.gtag?.("config", id);
        inited.google.add(id);
      }
    }

    if (item.kind === "tiktok" && item.pixelId && !inited.tiktok.has(item.pixelId)) {
      if (!window.ttq) {
        window.ttq = {
          load: (pixelId: string) => {
            ensureScript("https://analytics.tiktok.com/i18n/pixel/events.js", {
              "data-id": pixelId,
            });
          },
          page: () => undefined,
          track: (..._args: unknown[]) => undefined,
        };
      }
      window.ttq.load(item.pixelId);
      window.ttq.page();
      inited.tiktok.add(item.pixelId);
    }

    if (item.kind === "kwai" && item.pixelId && !inited.kwai.has(item.pixelId)) {
      if (!window.kwaiq) {
        window.kwaiq = {
          load: () => undefined,
          track: (..._args: unknown[]) => undefined,
        };
      }
      window.kwaiq.load(item.pixelId);
      inited.kwai.add(item.pixelId);
    }

    if (item.kind === "snap" && item.pixelId && !inited.snap.has(item.pixelId)) {
      if (!window.snaptr) {
        const snaptr = function (...args: unknown[]) {
          (snaptr as { queue: unknown[] }).queue.push(args);
        } as ((...args: unknown[]) => void) & { queue: unknown[] };
        snaptr.queue = [];
        window.snaptr = snaptr;
        ensureScript("https://sc-static.net/scevent.min.js");
      }
      window.snaptr("init", item.pixelId);
      window.snaptr("track", "PAGE_VIEW");
      inited.snap.add(item.pixelId);
    }

    if (item.kind === "pinterest" && item.pixelId && !inited.pinterest.has(item.pixelId)) {
      if (!window.pintrk) {
        const pintrk = function (...args: unknown[]) {
          (pintrk as { queue: unknown[] }).queue.push(args);
        } as ((...args: unknown[]) => void) & { queue: unknown[] };
        pintrk.queue = [];
        window.pintrk = pintrk;
        ensureScript("https://s.pinimg.com/ct/core.js");
      }
      window.pintrk("load", item.pixelId);
      window.pintrk("page");
      inited.pinterest.add(item.pixelId);
    }

    if (item.kind === "custom" && item.html?.trim()) {
      const mark = `asics-custom-pixel-${item.id}`;
      if (!document.getElementById(mark)) {
        const holder = document.createElement("div");
        holder.id = mark;
        holder.innerHTML = item.html;
        document.head.appendChild(holder);
      }
    }
  }

  if (settings.utmfy.enabled) {
    if (settings.utmfy.pixelId) window.pixelId = settings.utmfy.pixelId;
    ensureScript("https://cdn.utmify.com.br/scripts/utms/latest.js", {
      "data-utmify-prevent-xcod-sck": "",
      "data-utmify-prevent-subids": "",
      defer: "",
    });
    if (settings.utmfy.pixelId) {
      ensureScript("https://cdn.utmify.com.br/scripts/pixel/pixel.js");
    }
  }
}

export function TrackingProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.searchStr || ""}`,
  });
  const lastPath = useRef("");
  const settingsRef = useRef<PublicTrackingSettings | null>(null);

  useEffect(() => {
    captureAttribution();
    setEventIngest((event) => {
      const send = async (attempt = 0) => {
        try {
          await ingestStoreEvent({ data: event });
        } catch {
          if (attempt < 4) window.setTimeout(() => void send(attempt + 1), 500 * (attempt + 1));
        }
      };
      void send();
    });
    const local = loadPublicSettings();
    if (local && !isAdminPath(window.location.pathname)) {
      settingsRef.current = local;
      injectPixels(local);
    }
    void getPublicTrackingSettings()
      .then((settings) => {
        settingsRef.current = settings;
        if (!isAdminPath(window.location.pathname)) injectPixels(settings);
      })
      .catch(() => undefined);
    return () => setEventIngest(null);
  }, []);

  useEffect(() => {
    if (!pathname || isAdminPath(pathname)) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    captureAttribution();
    const event = track("page_view", { path: pathname }, pathname);
    if (pathname.startsWith("/?q=") || pathname.includes("q=")) {
      const q = new URLSearchParams(pathname.split("?")[1] ?? "").get("q");
      if (q) track("search", { search_string: q });
    }
    void event;
  }, [pathname]);

  useEffect(() => {
    if (isAdminPath(pathname)) return;
    const beat = () => {
      const cart = describeCart(readStoredCart());
      const draft = loadCheckoutDraft();
      const payload = {
        sessionId: getSessionId(),
        path: window.location.pathname + window.location.search,
        title: document.title,
        device: detectDevice(),
        attribution: getAttribution(),
        lastEvent: getLastTrackedName(),
        lastTs: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        cartItems: cart.items,
        cartValue: cart.value,
        email: draft.email.trim() || undefined,
        name: draft.name.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        city: draft.city.trim() || undefined,
        state: draft.state.trim() || undefined,
        shipping: draft.shippingMethod || undefined,
      };
      touchLocalPresence(payload);
      const sendBeat = async (attempt = 0) => {
        try {
          await heartbeatVisitor({
            data: {
              sessionId: payload.sessionId,
              path: payload.path,
              title: payload.title,
              device: payload.device,
              attribution: payload.attribution,
              lastEvent: payload.lastEvent,
              cartItems: payload.cartItems,
              cartValue: payload.cartValue,
              email: payload.email,
              name: payload.name,
              phone: payload.phone,
              city: payload.city,
              state: payload.state,
              shipping: payload.shipping,
            },
          });
        } catch {
          if (attempt < 3) window.setTimeout(() => void sendBeat(attempt + 1), 800 * (attempt + 1));
        }
      };
      void sendBeat();
    };
    beat();
    const id = window.setInterval(beat, 8000);
    return () => window.clearInterval(id);
  }, [pathname]);

  return children;
}
