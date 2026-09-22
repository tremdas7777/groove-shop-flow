import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  defaultSettings,
  emptyUtmfy,
  mergePixelSecrets,
  metaCapiTargets,
  normalizePixels,
  pixelsAreActive,
  publicPixels,
  maskPixelSettings,
  type AdminSettings,
  type AdminSnapshot,
  type PresenceVisitor,
  type PublicTrackingSettings,
} from "@/lib/admin";
import {
  customerFirstName,
  customerLastName,
  customerName,
  type OrderSummary,
} from "@/lib/checkout";
import type { AnalyticsEvent } from "@/lib/tracking";

const MAX_EVENTS = 4000;
const PRESENCE_TTL_MS = 90_000;
const STATE_CACHE_URL = "https://asics-admin.internal/state";

interface Session {
  token: string;
  expiresAt: number;
}

interface Store {
  settings: AdminSettings;
  pinHash: string;
  events: AnalyticsEvent[];
  orders: OrderSummary[];
  presence: Map<string, PresenceVisitor>;
  sessions: Session[];
  utmfyLast?: { at: string; ok: boolean; message: string };
  metaLast?: { at: string; ok: boolean; message: string };
  loaded: boolean;
}

interface PersistedState {
  settings?: AdminSettings;
  pinHash?: string;
  events?: AnalyticsEvent[];
  orders?: OrderSummary[];
  presence?: PresenceVisitor[];
  sessions?: Session[];
  utmfyLast?: Store["utmfyLast"];
  metaLast?: Store["metaLast"];
}

const globalStore = globalThis as typeof globalThis & { __asicsAdminStore?: Store };

const store: Store = globalStore.__asicsAdminStore ?? {
  settings: structuredClone(defaultSettings),
  pinHash: "",
  events: [],
  orders: [],
  presence: new Map(),
  sessions: [],
  loaded: false,
};
globalStore.__asicsAdminStore = store;

let persistChain: Promise<void> = Promise.resolve();

function envPin() {
  return process.env.ADMIN_PIN ?? "";
}

async function sha256(value: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

async function randomToken() {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(24).toString("hex");
}

function statePath() {
  return `${process.cwd()}/data/admin-state.json`;
}

function serializeState(): PersistedState {
  prunePresence();
  return {
    settings: store.settings,
    pinHash: store.pinHash,
    events: store.events.slice(-MAX_EVENTS),
    orders: store.orders.slice(0, 500),
    presence: [...store.presence.values()],
    sessions: store.sessions.filter((session) => session.expiresAt > Date.now()),
    utmfyLast: store.utmfyLast,
    metaLast: store.metaLast,
  };
}

function mergePersisted(data: PersistedState) {
  if (Array.isArray(data.events)) {
    const byId = new Map(store.events.map((event) => [event.id, event]));
    for (const event of data.events) {
      if (event?.id && !byId.has(event.id)) store.events.push(event);
    }
    store.events = store.events
      .slice()
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-MAX_EVENTS);
  }
  if (Array.isArray(data.orders)) {
    const byId = new Map(store.orders.map((order) => [order.id, order]));
    for (const order of data.orders) {
      if (!order?.id) continue;
      const prev = byId.get(order.id);
      if (!prev) {
        store.orders.push(order);
        byId.set(order.id, order);
      } else if ((order.createdAt ?? "") > (prev.createdAt ?? "") || order.status === "paid") {
        Object.assign(prev, order);
      }
    }
    store.orders = store.orders
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 500);
  }
  if (Array.isArray(data.presence)) {
    for (const visitor of data.presence) {
      if (!visitor?.sessionId) continue;
      const prev = store.presence.get(visitor.sessionId);
      if (!prev || visitor.lastTs >= prev.lastTs) store.presence.set(visitor.sessionId, visitor);
    }
  }
  if (Array.isArray(data.sessions)) {
    const byToken = new Map(store.sessions.map((session) => [session.token, session]));
    for (const session of data.sessions) {
      if (session?.token && session.expiresAt > Date.now() && !byToken.has(session.token)) {
        store.sessions.push(session);
      }
    }
  }
  if (!store.pinHash && data.pinHash) store.pinHash = data.pinHash;
  if (data.settings && !pixelsAreActive(store.settings.pixels) && pixelsAreActive(normalizePixels(data.settings.pixels))) {
    store.settings = {
      ...defaultSettings,
      ...data.settings,
      pixels: normalizePixels(data.settings.pixels),
      utmfy: { ...emptyUtmfy, ...data.settings.utmfy },
    };
  }
  if (data.utmfyLast && (!store.utmfyLast || data.utmfyLast.at > store.utmfyLast.at)) {
    store.utmfyLast = data.utmfyLast;
  }
  if (data.metaLast && (!store.metaLast || data.metaLast.at > store.metaLast.at)) {
    store.metaLast = data.metaLast;
  }
}

async function readPersisted(): Promise<PersistedState | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as PersistedState;
  } catch {
    // sem arquivo
  }
  try {
    const cache = await caches.open("asics-admin");
    const res = await cache.match(STATE_CACHE_URL);
    if (res) return (await res.json()) as PersistedState;
  } catch {
    // sem Cache API
  }
  return null;
}

async function writePersisted(data: PersistedState) {
  const body = JSON.stringify(data);
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const path = statePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  } catch {
    // ambiente sem disco gravável
  }
  try {
    const cache = await caches.open("asics-admin");
    await cache.put(
      STATE_CACHE_URL,
      new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "max-age=604800",
        },
      }),
    );
  } catch {
    // Cache API indisponível
  }
}

async function persist() {
  persistChain = persistChain.then(async () => {
    const disk = await readPersisted();
    if (disk) mergePersisted(disk);
    await writePersisted(serializeState());
  });
  await persistChain;
}

async function hydrate() {
  if (store.loaded) return;
  store.loaded = true;
  const data = await readPersisted();
  if (data) {
    if (data.settings) {
      store.settings = {
        ...defaultSettings,
        ...data.settings,
        pixels: normalizePixels(data.settings.pixels),
        utmfy: { ...emptyUtmfy, ...data.settings.utmfy },
      };
    }
    mergePersisted(data);
  }
  if (!store.pinHash && envPin()) {
    store.pinHash = await sha256(envPin());
    store.settings.hasPin = true;
  }
  store.settings.hasPin = Boolean(store.pinHash);
}

function publicSettings(): PublicTrackingSettings {
  return {
    pixels: publicPixels(store.settings.pixels),
    utmfy: {
      enabled: store.settings.utmfy.enabled,
      pixelId: store.settings.utmfy.pixelId,
    },
  };
}

function maskSecret(value: string) {
  return value ? `••••${value.slice(-4)}` : "";
}

function maskSettings(): AdminSettings {
  return {
    ...store.settings,
    hasPin: Boolean(store.pinHash),
    pixels: maskPixelSettings(store.settings.pixels, maskSecret),
    utmfy: {
      ...store.settings.utmfy,
      apiToken: maskSecret(store.settings.utmfy.apiToken),
    },
  };
}

function prunePresence() {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [id, visitor] of store.presence) {
    if (new Date(visitor.lastTs).getTime() < cutoff) store.presence.delete(id);
  }
}

function requireSession(token?: string) {
  store.sessions = store.sessions.filter((session) => session.expiresAt > Date.now());
  if (!token || !store.sessions.some((session) => session.token === token)) {
    throw new Error("Sessão do admin expirada. Entre novamente.");
  }
}

function utcStamp(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function sendUtmfy(order: OrderSummary, status: "waiting_payment" | "paid" | "refused" | "refunded") {
  const token = store.settings.utmfy.apiToken;
  if (!store.settings.utmfy.enabled || !token) return;
  const attr = order.attribution ?? {};
  const payload = {
    orderId: order.id,
    platform: "AsicsStore",
    paymentMethod: "pix" as const,
    status,
    createdAt: utcStamp(order.createdAt),
    approvedDate: status === "paid" ? utcStamp() : null,
    refundedAt: status === "refunded" ? utcStamp() : null,
    customer: {
      name: customerName(order.data),
      email: order.data.email,
      phone: order.data.phone.replace(/\D/g, "") || null,
      document: order.data.cpf.replace(/\D/g, "") || null,
      country: "BR",
    },
    products: order.items.map((item) => ({
      id: String(item.id),
      name: item.title,
      planId: item.size ?? null,
      planName: item.size ? `Tam. ${item.size}` : null,
      quantity: item.qty,
      priceInCents: Math.round(item.price * 100),
    })),
    trackingParameters: {
      src: attr.src ?? null,
      sck: attr.sck ?? null,
      utm_source: attr.utm_source ?? null,
      utm_campaign: attr.utm_campaign ?? null,
      utm_medium: attr.utm_medium ?? null,
      utm_content: attr.utm_content ?? null,
      utm_term: attr.utm_term ?? null,
    },
    commission: {
      totalPriceInCents: Math.round(order.total * 100),
      gatewayFeeInCents: 0,
      userCommissionInCents: Math.round(order.total * 100),
      currency: "BRL" as const,
    },
    ...(store.settings.utmfy.testMode ? { isTest: true } : {}),
  };

  try {
    const res = await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": token,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    store.utmfyLast = {
      at: new Date().toISOString(),
      ok: res.ok,
      message: res.ok ? `UTMify ${status} · ${order.id}` : body.slice(0, 240) || `HTTP ${res.status}`,
    };
  } catch (error) {
    store.utmfyLast = {
      at: new Date().toISOString(),
      ok: false,
      message: error instanceof Error ? error.message : "Falha ao enviar para a UTMify",
    };
  }
}

async function hashUser(value: string) {
  return sha256(value.trim().toLowerCase());
}

async function sendMetaCapi(order: OrderSummary, eventName: "Purchase" | "AddPaymentInfo" | "InitiateCheckout") {
  const targets = metaCapiTargets(store.settings.pixels);
  if (targets.length === 0) return;
  const phone = order.data.phone.replace(/\D/g, "");
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: order.id,
        action_source: "website",
        user_data: {
          em: [await hashUser(order.data.email)],
          ph: phone ? [await hashUser(phone)] : undefined,
          fn: customerFirstName(order.data)
            ? [await hashUser(customerFirstName(order.data))]
            : undefined,
          ln: customerLastName(order.data)
            ? [await hashUser(customerLastName(order.data))]
            : undefined,
          external_id: order.sessionId ? [await hashUser(order.sessionId)] : undefined,
          country: [await hashUser("br")],
        },
        custom_data: {
          currency: "BRL",
          value: order.total,
          content_ids: order.items.map((item) => String(item.id)),
          content_type: "product",
          order_id: order.id,
          num_items: order.items.reduce((acc, item) => acc + item.qty, 0),
        },
      },
    ],
  };
  try {
    let lastOk = false;
    let lastMessage = "";
    for (const target of targets) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(target.pixelId.trim())}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, access_token: target.accessToken?.trim() }),
        },
      );
      const body = await res.text();
      lastOk = res.ok;
      lastMessage = res.ok
        ? `Meta ${eventName} · ${order.id}`
        : body.slice(0, 240) || `HTTP ${res.status}`;
      if (!res.ok) break;
    }
    store.metaLast = {
      at: new Date().toISOString(),
      ok: lastOk,
      message: lastMessage,
    };
  } catch (error) {
    store.metaLast = {
      at: new Date().toISOString(),
      ok: false,
      message: error instanceof Error ? error.message : "Falha no Meta CAPI",
    };
  }
}

async function sendWebhook(kind: string, payload: unknown) {
  const url = store.settings.webhookUrl.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, at: new Date().toISOString(), payload }),
    });
  } catch {
    // webhook best-effort
  }
}

function upsertOrderLocal(order: OrderSummary) {
  const index = store.orders.findIndex((item) => item.id === order.id);
  if (index >= 0) store.orders[index] = { ...store.orders[index], ...order };
  else store.orders.unshift(order);
  store.orders = store.orders.slice(0, 500);
}

function snapshot(): AdminSnapshot {
  prunePresence();
  return {
    settings: maskSettings(),
    events: store.events.slice(-2000),
    orders: store.orders,
    visitors: [...store.presence.values()].sort((a, b) => b.lastTs.localeCompare(a.lastTs)),
    utmfyLast: store.utmfyLast,
    metaLast: store.metaLast,
  };
}

const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  ts: z.string(),
  sessionId: z.string(),
  path: z.string(),
  title: z.string().optional(),
  device: z.string().catch("mobile"),
  attribution: z.record(z.any()).optional(),
  props: z.record(z.any()).optional(),
});

const presenceSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  title: z.string().optional(),
  device: z.string().catch("mobile"),
  attribution: z.record(z.any()).optional(),
  lastEvent: z.string(),
  cartItems: z
    .array(
      z.object({
        id: z.number(),
        title: z.string(),
        size: z.string().optional(),
        qty: z.number(),
        price: z.number(),
        photo: z.string().optional(),
      }),
    )
    .optional(),
  cartValue: z.number().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  shipping: z.string().optional(),
});

const orderSchema = z.custom<OrderSummary>((value) => Boolean(value && typeof value === "object" && "id" in value));

function textProp(props: Record<string, any> | undefined, key: string) {
  const value = props?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cartFromProps(props: Record<string, any> | undefined) {
  const raw = props?.cart_items;
  if (!Array.isArray(raw) || raw.length === 0) return { cartItems: undefined as PresenceVisitor["cartItems"], cartValue: undefined as number | undefined };
  const cartItems = raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const id = Number(row.id);
      const qty = Math.max(1, Number(row.qty) || 1);
      const price = Number(row.price) || 0;
      const title = String(row.title ?? "").trim();
      if (!title && !Number.isFinite(id)) return null;
      return {
        id: Number.isFinite(id) ? id : 0,
        title: title || `Produto ${id}`,
        size: typeof row.size === "string" && row.size ? row.size : undefined,
        qty,
        price,
        photo: typeof row.photo === "string" && row.photo ? row.photo : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const cartValue = Number(props?.value) || cartItems.reduce((acc, item) => acc + item.price * item.qty, 0);
  return { cartItems: cartItems.length ? cartItems : undefined, cartValue: cartValue || undefined };
}

function keepCartFields(
  prev: PresenceVisitor | undefined,
  incoming: {
    cartItems?: PresenceVisitor["cartItems"];
    cartValue?: number;
    email?: string;
    name?: string;
    phone?: string;
    city?: string;
    state?: string;
    shipping?: string;
  },
) {
  return {
    cartItems: incoming.cartItems !== undefined ? incoming.cartItems : prev?.cartItems,
    cartValue: incoming.cartValue !== undefined ? incoming.cartValue : prev?.cartValue,
    email: incoming.email || prev?.email,
    name: incoming.name || prev?.name,
    phone: incoming.phone || prev?.phone,
    city: incoming.city || prev?.city,
    state: incoming.state || prev?.state,
    shipping: incoming.shipping || prev?.shipping,
  };
}

export const getPublicTrackingSettings = createServerFn({ method: "GET" }).handler(async () => {
  await hydrate();
  return publicSettings();
});

export const ingestStoreEvent = createServerFn({ method: "POST" })
  .validator(eventSchema)
  .handler(async ({ data }) => {
    await hydrate();
    if (data.path.toLowerCase().startsWith("/admin")) return { ok: true };
    const device = data.device === "desktop" || data.device === "tablet" ? data.device : "mobile";
    const incoming = { ...data, device, attribution: data.attribution ?? {} } as AnalyticsEvent;
    const prev = store.presence.get(incoming.sessionId);
    const fromProps = cartFromProps(incoming.props);
    store.events = [...store.events.filter((event) => event.id !== incoming.id), incoming].slice(-MAX_EVENTS);
    store.presence.set(incoming.sessionId, {
      sessionId: incoming.sessionId,
      path: incoming.path,
      title: incoming.title,
      device,
      attribution: incoming.attribution ?? {},
      lastEvent: incoming.name,
      lastTs: incoming.ts,
      startedAt: prev?.startedAt ?? incoming.ts,
      ...keepCartFields(prev, {
        cartItems: fromProps.cartItems,
        cartValue: fromProps.cartValue,
        email: textProp(incoming.props, "email"),
        name: textProp(incoming.props, "name"),
        phone: textProp(incoming.props, "phone"),
        city: textProp(incoming.props, "city"),
        state: textProp(incoming.props, "state"),
        shipping: textProp(incoming.props, "shipping"),
      }),
    });
    await persist();
    return { ok: true };
  });

export const heartbeatVisitor = createServerFn({ method: "POST" })
  .validator(presenceSchema)
  .handler(async ({ data }) => {
    await hydrate();
    if (data.path.toLowerCase().startsWith("/admin")) return { ok: true };
    const prev = store.presence.get(data.sessionId);
    const lastEvent =
      data.lastEvent === "heartbeat" && prev?.lastEvent && prev.lastEvent !== "heartbeat"
        ? prev.lastEvent
        : data.lastEvent;
    const device = data.device === "desktop" || data.device === "tablet" ? data.device : "mobile";
    store.presence.set(data.sessionId, {
      sessionId: data.sessionId,
      path: data.path,
      title: data.title,
      device,
      attribution: data.attribution ?? {},
      lastEvent,
      lastTs: new Date().toISOString(),
      startedAt: prev?.startedAt ?? new Date().toISOString(),
      ...keepCartFields(prev, {
        cartItems: data.cartItems,
        cartValue: data.cartValue,
        email: data.email,
        name: data.name,
        phone: data.phone,
        city: data.city,
        state: data.state,
        shipping: data.shipping,
      }),
    });
    await persist();
    return { ok: true };
  });

export const upsertStoreOrder = createServerFn({ method: "POST" })
  .validator(z.object({ order: orderSchema, notify: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await hydrate();
    const prev = store.orders.find((item) => item.id === data.order.id);
    upsertOrderLocal(data.order);
    if (data.notify !== false) {
      const nextStatus = data.order.status ?? data.order.pix?.status ?? "pending";
      const prevStatus = prev?.status ?? prev?.pix?.status;
      if (!prev) {
        await sendUtmfy(data.order, nextStatus === "paid" ? "paid" : "waiting_payment");
        if (nextStatus === "paid") await sendMetaCapi(data.order, "Purchase");
        else await sendMetaCapi(data.order, "AddPaymentInfo");
        await sendWebhook("order.created", data.order);
      } else if (prevStatus !== nextStatus) {
        const mapped =
          nextStatus === "paid"
            ? "paid"
            : nextStatus === "refunded"
              ? "refunded"
              : nextStatus === "refused"
                ? "refused"
                : "waiting_payment";
        await sendUtmfy(data.order, mapped);
        if (nextStatus === "paid") await sendMetaCapi(data.order, "Purchase");
        await sendWebhook("order.updated", data.order);
      }
    }
    await persist();
    return { ok: true };
  });

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  await hydrate();
  return { hasPin: Boolean(store.pinHash) };
});

export const adminSetup = createServerFn({ method: "POST" })
  .validator(z.object({ pin: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    if (store.pinHash) throw new Error("A senha do admin já foi definida.");
    store.pinHash = await sha256(data.pin);
    store.settings.hasPin = true;
    const token = await randomToken();
    store.sessions.push({ token, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
    await persist();
    return { token };
  });

export const adminLogin = createServerFn({ method: "POST" })
  .validator(z.object({ pin: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    if (!store.pinHash) throw new Error("Crie a senha do admin primeiro.");
    const hash = await sha256(data.pin);
    if (hash !== store.pinHash) throw new Error("Senha incorreta.");
    const token = await randomToken();
    store.sessions.push({ token, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
    await persist();
    return { token };
  });

export const getAdminSnapshot = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    return snapshot();
  });

export const saveAdminSettings = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      settings: z.object({
        storeName: z.string(),
        webhookUrl: z.string(),
        pixels: z.custom<AdminSettings["pixels"]>(),
        utmfy: z.object({
          enabled: z.boolean(),
          pixelId: z.string(),
          apiToken: z.string(),
          testMode: z.boolean(),
        }),
      }),
    }),
  )
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    const keepToken =
      !data.settings.utmfy.apiToken || data.settings.utmfy.apiToken.includes("•")
        ? store.settings.utmfy.apiToken
        : data.settings.utmfy.apiToken;
    store.settings = {
      ...store.settings,
      storeName: data.settings.storeName,
      webhookUrl: data.settings.webhookUrl,
      pixels: mergePixelSecrets(data.settings.pixels, store.settings.pixels),
      utmfy: { ...data.settings.utmfy, apiToken: keepToken },
      hasPin: Boolean(store.pinHash),
    };
    await persist();
    return maskSettings();
  });

export const changeAdminPin = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), current: z.string(), next: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    if ((await sha256(data.current)) !== store.pinHash) throw new Error("Senha atual incorreta.");
    store.pinHash = await sha256(data.next);
    await persist();
    return { ok: true };
  });

export const updateAdminOrder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      orderId: z.string(),
      status: z.enum(["pending", "paid", "refused", "refunded"]).optional(),
      notes: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    const order = store.orders.find((item) => item.id === data.orderId);
    if (!order) throw new Error("Pedido não encontrado.");
    if (data.status) {
      order.status = data.status;
      if (order.pix) order.pix = { ...order.pix, status: data.status === "pending" ? "pending" : data.status };
    }
    if (data.notes !== undefined) order.notes = data.notes;
    const mapped =
      order.status === "paid"
        ? "paid"
        : order.status === "refunded"
          ? "refunded"
          : order.status === "refused"
            ? "refused"
            : "waiting_payment";
    await sendUtmfy(order, mapped);
    if (order.status === "paid") await sendMetaCapi(order, "Purchase");
    await sendWebhook("order.updated", order);
    await persist();
    return order;
  });

export const testUtmifyConnection = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    if (!store.settings.utmfy.apiToken) throw new Error("Cole o token da UTMify antes de testar.");
    const dummy: OrderSummary = {
      id: `TEST${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      data: {
        email: "teste@loja.local",
        name: "Teste UTMify",
        firstName: "Teste",
        lastName: "UTMify",
        cpf: "00000000000",
        phone: "11999999999",
        cep: "01310100",
        street: "Av. Paulista",
        number: "1000",
        complement: "",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
        shippingMethod: "gratis",
        payment: "pix",
        cardNumber: "",
        cardName: "",
        cardExpiry: "",
        cardCvv: "",
        coupon: "",
        newsletter: false,
      },
      items: [
        {
          id: 1,
          qty: 1,
          title: "Pedido de teste UTMify",
          price: 1,
          photo: "",
        },
      ],
      subtotal: 1,
      shipping: 0,
      discount: 0,
      total: 1,
      status: "pending",
    };
    const previous = store.settings.utmfy.testMode;
    store.settings.utmfy.testMode = true;
    await sendUtmfy(dummy, "waiting_payment");
    store.settings.utmfy.testMode = previous;
    await persist();
    return store.utmfyLast;
  });

export const testMetaConnection = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    const meta = metaCapiTargets(store.settings.pixels)[0] ?? normalizePixels(store.settings.pixels).items.find((item) => item.kind === "meta");
    if (!meta?.pixelId) throw new Error("Cole o Pixel ID da Meta.");
    if (!meta?.accessToken) throw new Error("Cole o token da Meta.");
    const dummy: OrderSummary = {
      id: `METATEST${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      data: {
        email: "teste@loja.local",
        name: "Teste Meta",
        firstName: "Teste",
        lastName: "Meta",
        cpf: "00000000000",
        phone: "11999999999",
        cep: "01310100",
        street: "Av. Paulista",
        number: "1000",
        complement: "",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "SP",
        shippingMethod: "gratis",
        payment: "pix",
        cardNumber: "",
        cardName: "",
        cardExpiry: "",
        cardCvv: "",
        coupon: "",
        newsletter: false,
      },
      items: [{ id: 1, qty: 1, title: "Teste Meta CAPI", price: 1, photo: "" }],
      subtotal: 1,
      shipping: 0,
      discount: 0,
      total: 1,
      status: "pending",
    };
    await sendMetaCapi(dummy, "InitiateCheckout");
    await persist();
    return store.metaLast;
  });

export const seedAdminDemo = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await hydrate();
    requireSession(data.token);
    const now = Date.now();
    const sources = [
      { utm_source: "facebook", utm_medium: "cpc", utm_campaign: "prospecting-tenis" },
      { utm_source: "tiktok", utm_medium: "cpc", utm_campaign: "video-outlet" },
      { utm_source: "google", utm_medium: "cpc", utm_campaign: "brand-asics" },
      { utm_source: "instagram", utm_medium: "social", utm_campaign: "stories-nimbus" },
    ];
    for (let i = 0; i < 36; i++) {
      const attr = sources[i % sources.length];
      const sessionId = `demo_${i}`;
      const device = i % 5 === 0 ? "desktop" : i % 4 === 0 ? "tablet" : "mobile";
      const push = (name: string, minutesAgo: number, path: string, props?: Record<string, unknown>) => {
        store.events.push({
          id: `demo_${i}_${name}`,
          name,
          ts: new Date(now - minutesAgo * 60_000).toISOString(),
          sessionId,
          path,
          device,
          attribution: attr,
          props,
        });
      };
      push("page_view", 80 - i, "/");
      if (i % 2 === 0) push("view_item", 70 - i, "/produto/1", { content_ids: ["1"], value: 300 });
      if (i % 3 === 0) {
        push("add_to_cart", 60 - i, "/produto/20008", {
          content_ids: ["20008"],
          content_name: "Tênis Masculino ASICS Raiden 4",
          value: 133.33,
          cart_items: [{ id: 20008, title: "Tênis Masculino ASICS Raiden 4", qty: 1, price: 133.33, size: "40" }],
        });
      }
      if (i % 4 === 0) {
        push("view_cart", 50 - i, "/carrinho", {
          value: 133.33,
          cart_items: [{ id: 20008, title: "Tênis Masculino ASICS Raiden 4", qty: 1, price: 133.33, size: "40" }],
        });
      }
      if (i % 5 === 0) push("begin_checkout", 40 - i, "/checkout", { value: 133.33 });
      if (i % 6 === 0) {
        push("checkout_identify", 35 - i, "/checkout", {
          email: `cliente${i}@email.com`,
          name: `${["Ana", "Bruno", "Carla", "Diego"][i % 4]} Silva`,
          phone: "11988887777",
          value: 133.33,
        });
      }
      if (i % 7 === 0) push("checkout_shipping", 30 - i, "/checkout");
      if (i % 8 === 0) {
        push("generate_pix", 20 - i, "/pedido", { order_id: `ASDEMO${i}`, value: 300 });
        const paid = i % 16 === 0;
        if (paid) push("purchase", 10 - i, "/pedido", { order_id: `ASDEMO${i}`, value: 300 });
        upsertOrderLocal({
          id: `ASDEMO${i}`,
          createdAt: new Date(now - (20 - i) * 60_000).toISOString(),
          data: {
            email: `cliente${i}@email.com`,
            name: `${["Ana", "Bruno", "Carla", "Diego"][i % 4]} Silva`,
            firstName: ["Ana", "Bruno", "Carla", "Diego"][i % 4],
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
            shippingMethod: i % 3 === 0 ? "expresso" : i % 2 === 0 ? "padrao" : "gratis",
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
          shipping: i % 3 === 0 ? 34.9 : i % 2 === 0 ? 19.9 : 0,
          discount: 299.99,
          total: 300 + (i % 3 === 0 ? 34.9 : i % 2 === 0 ? 19.9 : 0),
          status: paid ? "paid" : "pending",
          attribution: attr,
          sessionId,
          pix: {
            transactionId: `demo${i}`,
            qrcode: "000201demo",
            status: paid ? "paid" : "pending",
          },
        });
      }
    }
    await persist();
    return snapshot();
  });
