import {
  defaultSettings,
  normalizePixels,
  ONLINE_MS,
  pixelsAreActive,
  type AdminSettings,
  type PresenceVisitor,
  type PublicTrackingSettings,
} from "@/lib/admin";
import { UTMIFY_PIXEL_ID } from "@/lib/utmify-pixel";
import { loadOrders, type OrderSummary } from "@/lib/checkout";
import { loadLocalEvents, type AnalyticsEvent } from "@/lib/tracking";

const PIN_KEY = "asics-admin-pin-hash";
const SETTINGS_KEY = "asics-admin-settings";
const TOKEN_KEY = "asics-admin-token";
const PRESENCE_KEY = "asics-local-presence";

export { TOKEN_KEY };

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`asics-admin:${value}`));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function localHasPin() {
  return Boolean(window.localStorage.getItem(PIN_KEY));
}

export async function localSetupPin(pin: string) {
  window.localStorage.setItem(PIN_KEY, await digest(pin));
}

export async function localCheckPin(pin: string) {
  const stored = window.localStorage.getItem(PIN_KEY);
  if (!stored) {
    await localSetupPin(pin);
    return true;
  }
  return stored === (await digest(pin));
}

export async function localChangePin(current: string, next: string) {
  if (!(await localCheckPin(current))) throw new Error("Senha atual incorreta.");
  await localSetupPin(next);
}

export function loadLocalSettings(): AdminSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<AdminSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      pixels: normalizePixels(parsed.pixels),
      utmfy: {
        ...defaultSettings.utmfy,
        ...(parsed.utmfy ?? {}),
        pixelId: parsed.utmfy?.pixelId || UTMIFY_PIXEL_ID,
        enabled:
          Boolean(parsed.utmfy?.enabled) ||
          Boolean(parsed.utmfy?.apiToken && !parsed.utmfy.apiToken.includes("•")),
      },
      hasPin: localHasPin(),
    };
  } catch {
    return { ...defaultSettings, hasPin: localHasPin() };
  }
}

export function saveLocalSettings(settings: AdminSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    ...settings,
    pixels: normalizePixels(settings.pixels),
  }));
}

export function loadPublicSettings(): PublicTrackingSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const settings = loadLocalSettings();
    const pixels = normalizePixels(settings.pixels);
    const utmfy = settings.utmfy ?? defaultSettings.utmfy;
    const pixelsOn = pixelsAreActive(pixels) || utmfy.enabled;
    if (!pixelsOn) return null;
    return {
      pixels: {
        ...pixels,
        metaAccessToken: "",
        items: pixels.items.map(({ accessToken: _token, ...item }) => item),
      },
      utmfy: { enabled: utmfy.enabled, pixelId: utmfy.pixelId },
    };
  } catch {
    return null;
  }
}

export function localSnapshot(settings: AdminSettings): {
  settings: AdminSettings;
  events: AnalyticsEvent[];
  orders: OrderSummary[];
} {
  return {
    settings,
    events: loadLocalEvents(),
    orders: loadOrders(),
  };
}

export function touchLocalPresence(visitor: PresenceVisitor) {
  if (typeof window === "undefined") return;
  const existing = loadLocalPresence(true);
  const prev = existing.find((item) => item.sessionId === visitor.sessionId);
  const nextVisitor = { ...visitor, startedAt: prev?.startedAt ?? visitor.startedAt };
  const next = [nextVisitor, ...existing.filter((item) => item.sessionId !== visitor.sessionId)].slice(0, 80);
  try {
    window.localStorage.setItem(PRESENCE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function loadLocalPresence(includeExpired = false): PresenceVisitor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRESENCE_KEY);
    const all = raw ? (JSON.parse(raw) as PresenceVisitor[]) : [];
    if (includeExpired) return all;
    const cutoff = Date.now() - ONLINE_MS;
    return all.filter((visitor) => new Date(visitor.lastTs).getTime() >= cutoff);
  } catch {
    return [];
  }
}

export function seedLocalDemo() {
  const now = Date.now();
  const events: AnalyticsEvent[] = loadLocalEvents();
  const orders: OrderSummary[] = loadOrders();
  const sources = [
    { utm_source: "facebook", utm_medium: "cpc", utm_campaign: "prospecting-tenis" },
    { utm_source: "tiktok", utm_medium: "cpc", utm_campaign: "video-outlet" },
    { utm_source: "google", utm_medium: "cpc", utm_campaign: "brand-asics" },
  ];
  for (let i = 0; i < 24; i++) {
    const attr = sources[i % sources.length];
    const sessionId = `demo_${i}`;
    const device = i % 4 === 0 ? "desktop" : "mobile";
    const push = (name: string, minutesAgo: number, path: string, props?: Record<string, unknown>) => {
      events.push({
        id: `demo_${i}_${name}_${now}`,
        name,
        ts: new Date(now - minutesAgo * 60_000).toISOString(),
        sessionId,
        path,
        device,
        attribution: attr,
        props,
      });
    };
    push("page_view", 70 - i, "/");
    if (i % 2 === 0) {
      push("view_item", 60 - i, "/produto/20014", {
        content_ids: ["20014"],
        content_name: "Tênis Masculino ASICS Novablast 5 Platium",
        value: 297,
      });
    }
    if (i % 3 === 0) {
      push("add_to_cart", 50 - i, "/produto/20014", {
        content_ids: ["20014"],
        content_name: "Tênis Masculino ASICS Novablast 5 Platium",
        value: 297,
        cart_items: [{ id: 20014, title: "Tênis Masculino ASICS Novablast 5 Platium", qty: 1, price: 297, size: "40" }],
      });
    }
    if (i % 4 === 0) {
      push("view_cart", 40 - i, "/carrinho", {
        value: 297,
        cart_items: [{ id: 20014, title: "Tênis Masculino ASICS Novablast 5 Platium", qty: 1, price: 297, size: "40" }],
      });
    }
    if (i % 5 === 0) push("begin_checkout", 30 - i, "/checkout", { value: 297 });
    if (i % 6 === 0) {
      push("checkout_identify", 25 - i, "/checkout", {
        email: `cliente${i}@email.com`,
        name: `${["Ana", "Bruno", "Carla"][i % 3]} Silva`,
        phone: "11988887777",
        value: 297,
      });
    }
    if (i % 8 === 0) push("checkout_shipping", 20 - i, "/checkout", { shipping: "padrao" });
    if (i % 6 === 0) {
      push("generate_pix", 15 - i, "/pedido", { order_id: `ASDEMO${i}`, value: 316.9 });
      const paid = i % 12 === 0;
      if (paid) push("purchase", 8 - i, "/pedido", { order_id: `ASDEMO${i}`, value: 319.9 });
      orders.unshift({
        id: `ASDEMO${i}`,
        createdAt: new Date(now - (15 - i) * 60_000).toISOString(),
        data: {
          email: `cliente${i}@email.com`,
          name: `${["Ana", "Bruno", "Carla"][i % 3]} Silva`,
          firstName: ["Ana", "Bruno", "Carla"][i % 3],
          lastName: "Silva",
          cpf: "12345678901",
          phone: "11988887777",
          cep: "01310100",
          street: "Av. Paulista",
          number: String(100 + i),
          complement: "",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
          shippingMethod: "padrao",
          payment: "pix",
          cardNumber: "",
          cardName: "",
          cardExpiry: "",
          cardCvv: "",
          coupon: "",
          newsletter: true,
        },
        items: [
          {
            id: 1,
            qty: 1,
            title: "Tênis Masculino Asics Novablast 5",
            price: 300,
            photo: "",
            size: "40",
          },
        ],
        subtotal: 300,
        shipping: 19.9,
        discount: 299.99,
        total: 319.9,
        status: paid ? "paid" : "pending",
        attribution: attr,
        sessionId,
        pix: { transactionId: `demo${i}`, qrcode: "000201demo", status: paid ? "paid" : "pending" },
      });
    }
  }
  window.localStorage.setItem("asics-analytics-events", JSON.stringify(events.slice(-800)));
  window.localStorage.setItem("asics-orders-ledger", JSON.stringify(orders.slice(0, 500)));
  const live = [0, 3, 6, 8, 12]
    .map((i) => {
      const last = events.filter((event) => event.sessionId === `demo_${i}`).at(-1);
      if (!last) return null;
      return {
        sessionId: last.sessionId,
        path: last.path,
        title: last.title,
        device: last.device,
        attribution: last.attribution,
        lastEvent: last.name,
        lastTs: new Date().toISOString(),
        startedAt: events.find((event) => event.sessionId === last.sessionId)?.ts ?? last.ts,
      } satisfies PresenceVisitor;
    })
    .filter(Boolean) as PresenceVisitor[];
  window.localStorage.setItem(PRESENCE_KEY, JSON.stringify(live));
}
