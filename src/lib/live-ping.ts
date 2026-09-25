import { describeCart, readStoredCart } from "@/lib/cart-snapshot";
import { loadCheckoutDraft } from "@/lib/checkout";
import { detectDevice, getAttribution, getLastTrackedName, getSessionId } from "@/lib/tracking";

export type LiveLead = {
  email?: string;
  name?: string;
  phone?: string;
  city?: string;
  state?: string;
  shipping?: string;
};

function leadFromDraft(): LiveLead {
  if (typeof window === "undefined") return {};
  const draft = loadCheckoutDraft();
  return {
    email: draft.email.trim() || undefined,
    name: draft.name.trim() || undefined,
    phone: draft.phone.trim() || undefined,
    city: draft.city.trim() || undefined,
    state: draft.state.trim() || undefined,
    shipping: draft.shippingMethod || undefined,
  };
}

export function hasTypedLead(lead: LiveLead) {
  return Boolean(
    lead.name?.trim() ||
      lead.email?.trim() ||
      lead.phone?.replace(/\D/g, "") ||
      lead.city?.trim(),
  );
}

export function buildLivePresence(extra: Record<string, unknown> = {}) {
  const cart = describeCart(readStoredCart());
  const lead = leadFromDraft();
  return {
    sessionId: getSessionId(),
    path: window.location.pathname + window.location.search || "/",
    title: document.title,
    device: detectDevice(),
    attribution: getAttribution(),
    lastEvent: getLastTrackedName() || "page_view",
    lastTs: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    cartItems: cart.items,
    cartValue: cart.value,
    ...lead,
    ...extra,
  };
}

function postLive(body: string) {
  void fetch("/api/live", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}

export function pingStorePresence(extra: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const payload = buildLivePresence(extra);
  const body = JSON.stringify(payload);
  // fetch sempre — no iPhone/Instagram o sendBeacon “ok” às vezes não entrega o body.
  postLive(body);
  try {
    if (typeof navigator.sendBeacon === "function" && document.visibilityState === "hidden") {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      navigator.sendBeacon("/api/live", blob);
    }
  } catch {
    // sendBeacon opcional
  }
  return payload;
}
