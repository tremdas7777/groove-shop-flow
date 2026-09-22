import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { getPublicTrackingSettings, heartbeatVisitor, ingestStoreEvent } from "@/lib/admin-api";
import type { PublicTrackingSettings } from "@/lib/admin";
import { loadPublicSettings } from "@/lib/admin-local";
import {
  captureAttribution,
  detectDevice,
  getAttribution,
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
  const { pixels, utmfy } = settings;

  if (pixels.metaEnabled && pixels.metaPixelId && !window.fbq) {
    const stub = function (...args: unknown[]) {
      (stub as { queue: unknown[]; callMethod?: (...a: unknown[]) => void }).queue.push(args);
    } as ((...args: unknown[]) => void) & { queue: unknown[]; loaded: boolean; version: string };
    stub.queue = [];
    stub.loaded = true;
    stub.version = "2.0";
    window.fbq = stub;
    window.fbq("init", pixels.metaPixelId);
    window.fbq("track", "PageView");
    ensureScript("https://connect.facebook.net/en_US/fbevents.js");
  }

  if (pixels.googleEnabled && (pixels.gaId || pixels.googleAdsId)) {
    const id = pixels.gaId || pixels.googleAdsId;
    if (!window.gtag) {
      window.dataLayer = window.dataLayer ?? [];
      window.gtag = function (...args: unknown[]) {
        window.dataLayer?.push(args);
      };
      window.gtag("js", new Date());
      ensureScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    }
    if (pixels.gaId) window.gtag?.("config", pixels.gaId);
    if (pixels.googleAdsId) window.gtag?.("config", pixels.googleAdsId);
  }

  if (pixels.tiktokEnabled && pixels.tiktokPixelId) {
    if (!window.ttq) {
      const ttq = {
        load: (pixelId: string) => {
          ensureScript("https://analytics.tiktok.com/i18n/pixel/events.js", {
            "data-id": pixelId,
          });
        },
        page: () => undefined,
        track: (..._args: unknown[]) => undefined,
      };
      window.ttq = ttq;
    }
    window.ttq.load(pixels.tiktokPixelId);
    window.ttq.page();
  }

  if (utmify.enabled) {
    if (utmify.pixelId) window.pixelId = utmfy.pixelId;
    ensureScript("https://cdn.utmify.com.br/scripts/utms/latest.js", {
      "data-utmify-prevent-xcod-sck": "",
      "data-utmify-prevent-subids": "",
      defer: "",
    });
    if (utmify.pixelId) {
      ensureScript("https://cdn.utmify.com.br/scripts/pixel/pixel.js");
    }
  }

  if (pixels.customHeadHtml) {
    const mark = "asics-custom-pixels";
    if (!document.getElementById(mark)) {
      const holder = document.createElement("div");
      holder.id = mark;
      holder.innerHTML = pixels.customHeadHtml;
      document.head.appendChild(holder);
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
      void ingestStoreEvent({ data: event }).catch(() => undefined);
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
      void heartbeatVisitor({
        data: {
          sessionId: getSessionId(),
          path: window.location.pathname + window.location.search,
          title: document.title,
          device: detectDevice(),
          attribution: getAttribution(),
          lastEvent: "heartbeat",
        },
      }).catch(() => undefined);
    };
    beat();
    const id = window.setInterval(beat, 8000);
    return () => window.clearInterval(id);
  }, [pathname]);

  return children;
}
