import { defaultSettings, type AdminSettings, type PublicTrackingSettings } from "@/lib/admin";
import { loadOrders, type OrderSummary } from "@/lib/checkout";
import { loadLocalEvents, type AnalyticsEvent } from "@/lib/tracking";

const PIN_KEY = "asics-admin-pin-hash";
const SETTINGS_KEY = "asics-admin-settings";
const TOKEN_KEY = "asics-admin-token";

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
      pixels: { ...defaultSettings.pixels, ...(parsed.pixels ?? {}) },
      utmfy: { ...defaultSettings.utmify, ...(parsed.utmify ?? {}) },
      hasPin: localHasPin(),
    };
  } catch {
    return { ...defaultSettings, hasPin: localHasPin() };
  }
}

export function saveLocalSettings(settings: AdminSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadPublicSettings(): PublicTrackingSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const settings = loadLocalSettings();
    const pixels = settings.pixels ?? defaultSettings.pixels;
    const utmfy = settings.utmify ?? defaultSettings.utmify;
    const pixelsOn =
      pixels.metaEnabled ||
      pixels.googleEnabled ||
      pixels.tiktokEnabled ||
      pixels.kwaiEnabled ||
      utmfy.enabled ||
      Boolean(pixels.customHeadHtml);
    if (!pixelsOn) return null;
    return {
      pixels,
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
    if (i % 2 === 0) push("view_item", 60 - i, "/produto/1", { content_ids: ["1"], value: 300 });
    if (i % 3 === 0) push("add_to_cart", 50 - i, "/produto/1", { content_ids: ["1"], value: 300 });
    if (i % 4 === 0) push("view_cart", 40 - i, "/carrinho");
    if (i % 5 === 0) push("begin_checkout", 30 - i, "/checkout");
    if (i % 6 === 0) {
      push("generate_pix", 15 - i, "/pedido", { order_id: `ASDEMO${i}`, value: 319.9 });
      const paid = i % 12 === 0;
      if (paid) push("purchase", 8 - i, "/pedido", { order_id: `ASDEMO${i}`, value: 319.9 });
      orders.unshift({
        id: `ASDEMO${i}`,
        createdAt: new Date(now - (15 - i) * 60_000).toISOString(),
        data: {
          email: `cliente${i}@email.com`,
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
}
