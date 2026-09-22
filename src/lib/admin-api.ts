import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  defaultSettings,
  emptyUtmfy,
  applySavedPixels,
  mergePixelLists,
  metaCapiTargets,
  normalizePixels,
  publicPixels,
  maskPixelSettings,
  type AdminSettings,
  type AdminSnapshot,
  type PresenceVisitor,
  type PublicTrackingSettings,
} from "@/lib/admin";
import { UTMIFY_PIXEL_ID } from "@/lib/utmify-pixel";
import {
  customerFirstName,
  customerLastName,
  customerName,
  emptyCheckout,
  type OrderSummary,
} from "@/lib/checkout";
import { compactAttribution, hasCampaignTracking, type AnalyticsEvent, type Attribution } from "@/lib/tracking";

const MAX_EVENTS = 15000;
const MAX_ORDERS = 2000;
const MAX_PRESENCE = 8000;
const PRESENCE_KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const STATE_CACHE_URL = "https://asics-admin.internal/state";
const CACHE_NAME = "asics-admin";
const EVENT_PREFIX = "https://asics-admin.internal/event/";
const PRESENCE_PREFIX = "https://asics-admin.internal/presence/";
const ORDER_PREFIX = "https://asics-admin.internal/order/";
const SESSION_PREFIX = "https://asics-admin.internal/session/";
const UTMIFY_PREFIX = "https://asics-admin.internal/utmfy/";
const UTMIFY_TOKEN_URL = "https://asics-admin.internal/utmfy-token";

type UtmfyStatus = "waiting_payment" | "paid" | "refused" | "refunded";
type UtmfySent = NonNullable<OrderSummary["utmfySent"]>;

function mergeUtmfySent(left?: UtmfySent, right?: UtmfySent): UtmfySent {
  return {
    waiting_payment: Boolean(left?.waiting_payment || right?.waiting_payment),
    paid: Boolean(left?.paid || right?.paid),
    refused: Boolean(left?.refused || right?.refused),
    refunded: Boolean(left?.refunded || right?.refunded),
    createdAt: left?.createdAt || right?.createdAt,
    tracked: Boolean(left?.tracked || right?.tracked),
  };
}

function preferSession(left?: string, right?: string) {
  const real = (id?: string) => Boolean(id && !id.startsWith("mp_") && !id.startsWith("order:"));
  if (real(left)) return left;
  if (real(right)) return right;
  return left || right;
}

function earlierIso(left?: string, right?: string) {
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

function defaultCache(): Cache | null {
  try {
    const extra = caches as typeof caches & { default?: Cache };
    return extra.default ?? null;
  } catch {
    return null;
  }
}

async function listAdminCaches() {
  const found: Cache[] = [];
  try {
    found.push(await caches.open(CACHE_NAME));
  } catch {
    // named cache indisponível
  }
  const fallback = defaultCache();
  if (fallback) found.push(fallback);
  return found;
}

async function putCacheRecord(url: string, body: string) {
  const response = () =>
    new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=5184000",
      },
    });
  for (const cache of await listAdminCaches()) {
    try {
      await cache.put(url, response());
    } catch {
      // isolate sem esse cache
    }
  }
}

async function matchCacheRecord(url: string) {
  for (const cache of await listAdminCaches()) {
    try {
      const res = await cache.match(url);
      if (res) return res;
    } catch {
      // próximo cache
    }
  }
  return null;
}

async function putShard(url: string, data: unknown) {
  try {
    await putCacheRecord(url, JSON.stringify(data));
  } catch {
    // Cache API indisponível
  }
}

async function persistTrafficShards(input: {
  event?: AnalyticsEvent;
  visitor?: PresenceVisitor;
  order?: OrderSummary;
  session?: Session;
}) {
  if (input.event?.id) await putShard(`${EVENT_PREFIX}${input.event.id}`, input.event);
  if (input.visitor?.sessionId) await putShard(`${PRESENCE_PREFIX}${input.visitor.sessionId}`, input.visitor);
  if (input.order?.id) {
    await putShard(`${ORDER_PREFIX}${input.order.id}`, input.order);
    const sent = mergeUtmfySent(store.utmfyClaims.get(input.order.id), input.order.utmfySent);
    if (sent.waiting_payment || sent.paid || sent.refused || sent.refunded) {
      await putShard(`${UTMIFY_PREFIX}${input.order.id}`, sent);
    }
  }
  if (input.session?.token) await putShard(`${SESSION_PREFIX}${input.session.token}`, input.session);
}

async function getShard<T>(url: string): Promise<T | null> {
  try {
    const res = await matchCacheRecord(url);
    if (!res) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function readShards(): Promise<PersistedState | null> {
  try {
    const cachesFound = await listAdminCaches();
    const keys = new Map<string, Request>();
    for (const cache of cachesFound) {
      try {
        for (const req of await cache.keys()) keys.set(req.url, req);
      } catch {
        // isolate sem keys()
      }
    }
    if (!keys.size) return null;
    const events: AnalyticsEvent[] = [];
    const presence: PresenceVisitor[] = [];
    const orders: OrderSummary[] = [];
    const sessions: Session[] = [];
    const claims: Record<string, UtmfySent> = {};
    await Promise.all(
      [...keys.values()].map(async (req) => {
        const url = req.url;
        const res = await matchCacheRecord(url);
        if (!res) return;
        try {
          const data = await res.json();
          if (url.startsWith(EVENT_PREFIX) && data?.id) events.push(data);
          else if (url.startsWith(PRESENCE_PREFIX) && data?.sessionId) presence.push(data);
          else if (url.startsWith(ORDER_PREFIX) && data?.id) orders.push(data);
          else if (url.startsWith(SESSION_PREFIX) && data?.token) sessions.push(data);
          else if (url.startsWith(UTMIFY_PREFIX) && data && typeof data === "object") {
            const orderId = url.slice(UTMIFY_PREFIX.length);
            if (orderId) {
              const current = claims[orderId] ?? {};
              claims[orderId] = mergeUtmfySent(current, data as UtmfySent);
            }
          }
        } catch {
          // shard inválido
        }
      }),
    );
    if (!events.length && !presence.length && !orders.length && !sessions.length && !Object.keys(claims).length) {
      return null;
    }
    return { events, presence, orders, sessions, utmfyClaims: claims };
  } catch {
    return null;
  }
}

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
  utmfyClaims: Map<string, UtmfySent>;
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
  utmfyClaims?: Record<string, UtmfySent>;
  utmfyLast?: Store["utmfyLast"];
  metaLast?: Store["metaLast"];
  writtenAt?: number;
}

const globalStore = globalThis as typeof globalThis & { __asicsAdminStore?: Store };

const store: Store = globalStore.__asicsAdminStore ?? {
  settings: structuredClone(defaultSettings),
  pinHash: "",
  events: [],
  orders: [],
  presence: new Map(),
  sessions: [],
  utmfyClaims: new Map(),
  loaded: false,
};
globalStore.__asicsAdminStore = store;
store.utmfyClaims ??= new Map();

let persistChain: Promise<void> = Promise.resolve();

function envPin() {
  return process.env.ADMIN_PIN ?? "";
}

async function sha256(value: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

function statePath() {
  return `${process.cwd()}/data/admin-state.json`;
}

function serializeState(): PersistedState {
  pruneStalePresence();
  return {
    settings: store.settings,
    pinHash: store.pinHash,
    events: store.events.slice(-MAX_EVENTS),
    orders: store.orders.slice(0, MAX_ORDERS),
    presence: [...store.presence.values()],
    sessions: store.sessions.filter((session) => session.expiresAt > Date.now()),
    utmfyClaims: Object.fromEntries(store.utmfyClaims),
    utmfyLast: store.utmfyLast,
    metaLast: store.metaLast,
    writtenAt: Date.now(),
  };
}

function hasSecret(value?: string) {
  return Boolean(value?.trim() && !value.includes("•"));
}

function envUtmfyToken() {
  return (process.env.UTMIFY_API_TOKEN ?? process.env.UTMIFY_TOKEN ?? "").trim();
}

function mergeUtmfy(disk?: AdminSettings["utmfy"]) {
  const current = store.settings.utmfy ?? emptyUtmfy;
  const incoming = { ...emptyUtmfy, ...disk };
  const apiToken = [current.apiToken, incoming.apiToken, envUtmfyToken()].find((value) => hasSecret(value)) ?? "";
  store.settings.utmfy = {
    enabled: true,
    pixelId: current.pixelId || incoming.pixelId || UTMIFY_PIXEL_ID,
    apiToken,
    testMode: typeof incoming.testMode === "boolean" ? incoming.testMode : current.testMode,
  };
}

async function rememberUtmfyToken(token?: string) {
  if (!hasSecret(token)) return;
  store.settings.utmfy.apiToken = token.trim();
  store.settings.utmfy.enabled = true;
  await putShard(UTMIFY_TOKEN_URL, { apiToken: token.trim() });
}

async function loadUtmfyToken() {
  const pinned = await getShard<{ apiToken?: string }>(UTMIFY_TOKEN_URL);
  mergeUtmfy({ apiToken: pinned?.apiToken ?? "" });
}

function mergeVisitor(prev: PresenceVisitor | undefined, incoming: PresenceVisitor): PresenceVisitor {
  if (!prev) return incoming;
  const newer = incoming.lastTs >= prev.lastTs ? incoming : prev;
  const older = newer === incoming ? prev : incoming;
  return {
    ...older,
    ...newer,
    startedAt: prev.startedAt || incoming.startedAt,
    lastTs: newer.lastTs,
    lastEvent:
      newer.lastEvent === "heartbeat" && older.lastEvent && older.lastEvent !== "heartbeat"
        ? older.lastEvent
        : newer.lastEvent,
    cartItems: newer.cartItems?.length ? newer.cartItems : older.cartItems,
    cartValue: newer.cartValue || older.cartValue,
    email: newer.email || older.email,
    name: newer.name || older.name,
    phone: newer.phone || older.phone,
    city: newer.city || older.city,
    state: newer.state || older.state,
    shipping: newer.shipping || older.shipping,
    attribution: mergeAttribution(older.attribution, newer.attribution),
  };
}

function unionPersisted(left: PersistedState, right: PersistedState): PersistedState {
  const events = new Map<string, AnalyticsEvent>();
  for (const event of [...(left.events ?? []), ...(right.events ?? [])]) {
    if (event?.id) events.set(event.id, event);
  }
  const orders = new Map<string, OrderSummary>();
  for (const order of [...(left.orders ?? []), ...(right.orders ?? [])]) {
    if (!order?.id) continue;
    const prev = orders.get(order.id);
    if (!prev || (order.createdAt ?? "") > (prev.createdAt ?? "") || order.status === "paid") {
      orders.set(
        order.id,
        prev
          ? { ...prev, ...order, utmfySent: mergeUtmfySent(prev.utmfySent, order.utmfySent) }
          : order,
      );
    }
  }
  const presence = new Map<string, PresenceVisitor>();
  for (const visitor of [...(left.presence ?? []), ...(right.presence ?? [])]) {
    if (!visitor?.sessionId) continue;
    presence.set(visitor.sessionId, mergeVisitor(presence.get(visitor.sessionId), visitor));
  }
  const sessions = new Map<string, Session>();
  for (const session of [...(left.sessions ?? []), ...(right.sessions ?? [])]) {
    if (session?.token && session.expiresAt > Date.now()) sessions.set(session.token, session);
  }
  const leftAt = left.settings?.settingsAt ?? 0;
  const rightAt = right.settings?.settingsAt ?? 0;
  const settings = rightAt > leftAt ? right.settings : left.settings ?? right.settings;
  return {
    settings,
    pinHash: left.pinHash || right.pinHash,
    events: [...events.values()].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-MAX_EVENTS),
    orders: [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ORDERS),
    presence: [...presence.values()],
    sessions: [...sessions.values()],
    utmfyClaims: Object.fromEntries(
      [...Object.entries(left.utmfyClaims ?? {}), ...Object.entries(right.utmfyClaims ?? {})].map(
        ([id, sent]) => [id, mergeUtmfySent(left.utmfyClaims?.[id], mergeUtmfySent(right.utmfyClaims?.[id], sent))],
      ),
    ),
    utmfyLast:
      left.utmfyLast && (!right.utmfyLast || left.utmfyLast.at > right.utmfyLast.at)
        ? left.utmfyLast
        : right.utmfyLast,
    metaLast:
      left.metaLast && (!right.metaLast || left.metaLast.at > right.metaLast.at) ? left.metaLast : right.metaLast,
    writtenAt: Math.max(left.writtenAt ?? 0, right.writtenAt ?? 0),
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
        Object.assign(prev, mergeOrders(prev, order));
      }
    }
    store.orders = store.orders
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ORDERS);
  }
  if (Array.isArray(data.presence)) {
    for (const visitor of data.presence) {
      if (!visitor?.sessionId) continue;
      store.presence.set(visitor.sessionId, mergeVisitor(store.presence.get(visitor.sessionId), visitor));
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
  if (data.settings) {
    const storeAt = store.settings.settingsAt ?? 0;
    const diskAt = data.settings.settingsAt ?? 0;
    if (diskAt > storeAt) {
      store.settings = {
        ...defaultSettings,
        ...data.settings,
        pixels: normalizePixels(data.settings.pixels),
        utmfy: store.settings.utmfy,
        settingsAt: diskAt,
      };
    } else if (diskAt === storeAt) {
      store.settings.pixels = mergePixelLists(store.settings.pixels, data.settings.pixels);
    }
    mergeUtmfy(data.settings.utmfy);
  }
  if (data.utmfyClaims) {
    for (const [id, sent] of Object.entries(data.utmfyClaims)) {
      store.utmfyClaims.set(id, mergeUtmfySent(store.utmfyClaims.get(id), sent));
    }
  }
  for (const order of store.orders) {
    if (!order.id) continue;
    const merged = mergeUtmfySent(store.utmfyClaims.get(order.id), order.utmfySent);
    store.utmfyClaims.set(order.id, merged);
    order.utmfySent = merged;
  }
  if (data.utmfyLast && (!store.utmfyLast || data.utmfyLast.at > store.utmfyLast.at)) {
    store.utmfyLast = data.utmfyLast;
  }
  if (data.metaLast && (!store.metaLast || data.metaLast.at > store.metaLast.at)) {
    store.metaLast = data.metaLast;
  }
}

function remoteStateUrl() {
  return (process.env.ADMIN_STATE_URL ?? "").trim();
}

function remoteStateHeaders() {
  const token = (process.env.ADMIN_STATE_TOKEN ?? "").trim();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readRemoteState(): Promise<PersistedState | null> {
  const url = remoteStateUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: remoteStateHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PersistedState;
  } catch {
    return null;
  }
}

async function writeRemoteState(data: PersistedState) {
  const url = remoteStateUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "PUT",
      headers: remoteStateHeaders(),
      body: JSON.stringify({
        events: data.events,
        orders: data.orders,
        presence: data.presence,
        sessions: data.sessions,
        pinHash: data.pinHash,
        utmfyClaims: data.utmfyClaims,
        writtenAt: data.writtenAt,
      }),
    });
  } catch {
    // store remoto opcional
  }
}

async function readPersisted(): Promise<PersistedState | null> {
  const parts: PersistedState[] = [];
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(statePath(), "utf8");
    parts.push(JSON.parse(raw) as PersistedState);
  } catch {
    // sem arquivo
  }
  try {
    const res = await matchCacheRecord(STATE_CACHE_URL);
    if (res) parts.push((await res.json()) as PersistedState);
  } catch {
    // sem Cache API
  }
  const shards = await readShards();
  if (shards) parts.push(shards);
  const remote = await readRemoteState();
  if (remote) parts.push(remote);
  if (parts.length === 0) return null;
  return parts.reduce((acc, part) => (acc ? unionPersisted(acc, part) : part));
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
    await putCacheRecord(STATE_CACHE_URL, body);
  } catch {
    // Cache API indisponível
  }
  await writeRemoteState(data);
}

function keepRicherTraffic(next: PersistedState, disk?: PersistedState | null): PersistedState {
  if (!disk) return next;
  if (!(next.events?.length) && disk.events?.length) next.events = disk.events;
  if (!(next.orders?.length) && disk.orders?.length) next.orders = disk.orders;
  if (!(next.presence?.length) && disk.presence?.length) next.presence = disk.presence;
  if (!next.pinHash && disk.pinHash) next.pinHash = disk.pinHash;
  if (!next.sessions?.length && disk.sessions?.length) next.sessions = disk.sessions;
  return next;
}

async function persist() {
  const writeOnce = async () => {
    try {
      const disk = await readPersisted();
      if (disk) mergePersisted(disk);
      const next = keepRicherTraffic(serializeState(), disk);
      const nextItems = normalizePixels(next.settings?.pixels).items;
      const diskItems = normalizePixels(disk?.settings?.pixels).items;
      const nextAt = next.settings?.settingsAt ?? 0;
      const diskAt = disk?.settings?.settingsAt ?? 0;
      if (nextItems.length === 0 && diskItems.length > 0 && nextAt <= diskAt) {
        const pixels = normalizePixels(disk?.settings?.pixels);
        if (next.settings) next.settings.pixels = pixels;
        store.settings.pixels = pixels;
      }
      if (next.events) store.events = next.events;
      if (next.orders) store.orders = next.orders;
      if (next.presence) {
        store.presence = new Map(next.presence.map((visitor) => [visitor.sessionId, visitor]));
      }
      await writePersisted(next);
    } catch {
      // um isolate falhou: o próximo persist tenta de novo
    }
  };
  persistChain = persistChain.then(writeOnce, writeOnce);
  await persistChain;
}

async function hydrate() {
  const first = !store.loaded;
  store.loaded = true;
  const data = await readPersisted();
  if (data) {
    if (first && data.settings) {
      store.settings = {
        ...defaultSettings,
        ...data.settings,
        pixels: normalizePixels(data.settings.pixels),
        utmfy: { ...emptyUtmfy, ...data.settings.utmfy },
      };
    }
    mergePersisted(data);
  }
  if (!store.pinHash) {
    const pinned = await getShard<{ pinHash?: string }>("https://asics-admin.internal/pin");
    if (pinned?.pinHash) store.pinHash = pinned.pinHash;
  }
  if (!store.pinHash && envPin()) {
    store.pinHash = await sha256(envPin());
    store.settings.hasPin = true;
  }
  store.settings.hasPin = Boolean(store.pinHash);
  await loadUtmfyToken();
  mergeUtmfy(store.settings.utmfy);
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

function pruneStalePresence() {
  const cutoff = Date.now() - PRESENCE_KEEP_MS;
  for (const [id, visitor] of store.presence) {
    if (new Date(visitor.lastTs).getTime() < cutoff) store.presence.delete(id);
  }
  if (store.presence.size <= MAX_PRESENCE) return;
  const ranked = [...store.presence.values()].sort((a, b) => b.lastTs.localeCompare(a.lastTs));
  store.presence = new Map(ranked.slice(0, MAX_PRESENCE).map((visitor) => [visitor.sessionId, visitor]));
}

function pinTokenOf(hash: string) {
  return `pin_${hash}`;
}

async function ensurePinHash() {
  if (store.pinHash) return store.pinHash;
  if (envPin()) {
    store.pinHash = await sha256(envPin());
    store.settings.hasPin = true;
  }
  return store.pinHash;
}

async function requireSession(token?: string) {
  if (token?.startsWith("pin_") && /^pin_[a-f0-9]{64}$/.test(token)) {
    const incoming = token.slice(4);
    const expected = await ensurePinHash();
    if (expected && incoming === expected) return;
    if (!expected) {
      store.pinHash = incoming;
      store.settings.hasPin = true;
      await putShard("https://asics-admin.internal/pin", { pinHash: incoming });
      return;
    }
  }
  store.sessions = store.sessions.filter((session) => session.expiresAt > Date.now());
  if (token && store.sessions.some((session) => session.token === token)) return;
  if (token) {
    const cached = await getShard<Session>(`${SESSION_PREFIX}${token}`);
    if (cached?.token && cached.expiresAt > Date.now()) {
      store.sessions.push(cached);
      return;
    }
  }
  throw new Error("Sessão do admin expirada. Entre novamente.");
}

function utcStamp(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  return date.toISOString().slice(0, 19).replace("T", " ");
}

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
  if (!merged.utm_source && merged.fbclid) merged.utm_source = "FB";
  if (!merged.utm_source && merged.ttclid) merged.utm_source = "tiktok";
  if (!merged.utm_source && merged.gclid) merged.utm_source = "google";
  if (!merged.sck && merged.xcod) merged.sck = merged.xcod;
  return merged;
}

function resolveOrderAttribution(order: OrderSummary): Attribution {
  const email = order.data.email?.trim().toLowerCase();
  const phone = order.data.phone.replace(/\D/g, "");
  const fromEvents = store.events
    .filter((event) => {
      if (event.sessionId && event.sessionId === order.sessionId) return true;
      if (typeof event.props?.order_id === "string" && event.props.order_id === order.id) return true;
      if (email && String(event.props?.email ?? "").trim().toLowerCase() === email) return true;
      if (phone && String(event.props?.phone ?? "").replace(/\D/g, "") === phone) return true;
      return false;
    })
    .map((event) => event.attribution);
  const fromVisitors = [...store.presence.values()]
    .filter((visitor) => {
      if (visitor.sessionId && visitor.sessionId === order.sessionId) return true;
      if (email && visitor.email?.trim().toLowerCase() === email) return true;
      if (phone && visitor.phone?.replace(/\D/g, "") === phone) return true;
      return false;
    })
    .map((visitor) => visitor.attribution);
  return mergeAttribution(order.attribution, ...fromEvents, ...fromVisitors);
}

function utmfyCreatedAtFor(order: OrderSummary) {
  const claimed = store.utmfyClaims.get(order.id)?.createdAt;
  const stored = store.orders.find((item) => item.id === order.id);
  return (
    claimed ||
    stored?.utmfySent?.createdAt ||
    order.utmfySent?.createdAt ||
    utcStamp(stored?.createdAt || order.createdAt)
  );
}

async function sendUtmfy(order: OrderSummary, status: "waiting_payment" | "paid" | "refused" | "refunded") {
  await loadUtmfyToken();
  const token = store.settings.utmfy.apiToken;
  if (!hasSecret(token)) {
    store.utmfyLast = {
      at: new Date().toISOString(),
      ok: false,
      message: "UTMify sem token no servidor. Salve o token na aba UTMify.",
    };
    return false;
  }
  const attr = compactAttribution(resolveOrderAttribution(order));
  order.attribution = attr;
  const createdAt = utmfyCreatedAtFor(order);
  const totalCents = Math.max(1, Math.round(order.total * 100));
  const payload: Record<string, unknown> = {
    orderId: order.id,
    platform: "AsicsStore",
    paymentMethod: "pix",
    status,
    createdAt,
    approvedDate: status === "paid" ? utcStamp() : null,
    refundedAt: status === "refunded" ? utcStamp() : null,
    customer: {
      name: customerName(order.data) || "Cliente",
      email: order.data.email || "cliente@loja.local",
      phone: order.data.phone.replace(/\D/g, "") || null,
      document: order.data.cpf.replace(/\D/g, "") || null,
      country: "BR",
    },
    products: (order.items.length ? order.items : [{ id: 0, title: "Pedido", qty: 1, price: order.total, photo: "" }]).map(
      (item) => ({
        id: String(item.id || order.id),
        name: item.title || "Produto",
        planId: item.size ?? null,
        planName: item.size ? `Tam. ${item.size}` : null,
        quantity: item.qty,
        priceInCents: Math.max(0, Math.round(item.price * 100)),
      }),
    ),
    trackingParameters: {
      src: attr.src ?? null,
      sck: attr.sck ?? attr.xcod ?? null,
      utm_source: attr.utm_source ?? null,
      utm_campaign: attr.utm_campaign ?? null,
      utm_medium: attr.utm_medium ?? null,
      utm_content: attr.utm_content ?? null,
      utm_term: attr.utm_term ?? null,
    },
    commission: {
      totalPriceInCents: totalCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: totalCents,
    },
  };
  if (store.settings.utmfy.testMode) payload.isTest = true;

  for (let attempt = 0; attempt < 4; attempt++) {
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
      const duplicate = /already|duplicate|exists|já exist|ja exist/i.test(body);
      const ok = res.ok || (res.status >= 400 && res.status < 500 && duplicate);
      store.utmfyLast = {
        at: new Date().toISOString(),
        ok,
        message: ok
          ? `UTMify ${status} · ${order.id}`
          : body.slice(0, 240) || `HTTP ${res.status}`,
      };
      if (ok) return true;
    } catch (error) {
      store.utmfyLast = {
        at: new Date().toISOString(),
        ok: false,
        message: error instanceof Error ? error.message : "Falha ao enviar para a UTMify",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return false;
}

function utmfyStatusOf(order: OrderSummary): "waiting_payment" | "paid" | "refused" | "refunded" {
  const status = order.status ?? order.pix?.status ?? "pending";
  if (status === "paid") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "refused") return "refused";
  return "waiting_payment";
}

const utmfyLocks = new Map<string, Promise<void>>();

async function rememberUtmfySent(orderId: string, sent: UtmfySent) {
  const next = mergeUtmfySent(store.utmfyClaims.get(orderId), sent);
  store.utmfyClaims.set(orderId, next);
  const stored = store.orders.find((item) => item.id === orderId);
  if (stored) stored.utmfySent = next;
  await putShard(`${UTMIFY_PREFIX}${orderId}`, next);
  return next;
}

async function notifyUtmfy(order: OrderSummary) {
  const orderId = order.id;
  if (!orderId) return;
  const previous = utmfyLocks.get(orderId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  utmfyLocks.set(
    orderId,
    previous.then(
      () => gate,
      () => gate,
    ),
  );
  await previous.catch(() => undefined);
  try {
    const tx = order.pix?.transactionId;
    const stored = store.orders.find(
      (item) =>
        item.id === orderId ||
        (tx !== undefined &&
          tx !== "" &&
          String(item.pix?.transactionId ?? "") === String(tx)),
    );
    let sent = mergeUtmfySent(
      store.utmfyClaims.get(orderId),
      mergeUtmfySent(stored?.utmfySent, order.utmfySent),
    );
    const mapped = utmfyStatusOf(stored ?? order);
    const createdAt = sent.createdAt || utmfyCreatedAtFor(stored ?? order);
    if (!sent.createdAt) {
      sent = await rememberUtmfySent(orderId, { ...sent, createdAt });
    }

    const current = { ...(stored ?? order), utmfySent: sent };
    const tracked = hasCampaignTracking(resolveOrderAttribution(current));
    if (!sent.waiting_payment) {
      const ok = await sendUtmfy(current, "waiting_payment");
      if (ok) sent = await rememberUtmfySent(orderId, { ...sent, waiting_payment: true, createdAt, tracked });
    }
    if (mapped !== "waiting_payment" && !sent[mapped]) {
      const ok = await sendUtmfy({ ...current, utmfySent: sent }, mapped);
      if (ok) sent = await rememberUtmfySent(orderId, { ...sent, [mapped]: true, createdAt, tracked });
    } else if (tracked && !sent.tracked) {
      const ok = await sendUtmfy({ ...current, utmfySent: sent }, mapped);
      if (ok) sent = await rememberUtmfySent(orderId, { ...sent, [mapped]: true, createdAt, tracked: true });
    }
    order.utmfySent = sent;
  } finally {
    release();
  }
}

async function flushUtmfyOrders() {
  await loadUtmfyToken();
  if (!hasSecret(store.settings.utmfy.apiToken)) return;
  for (const order of store.orders) {
    if (!order.id || !/^PD/i.test(order.id)) continue;
    try {
      await notifyUtmfy(order);
    } catch {
      // segue o próximo pedido
    }
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

function mergeOrders(prev: OrderSummary | undefined, incoming: OrderSummary): OrderSummary {
  if (!prev) return incoming;
  const paid =
    incoming.status === "paid" ||
    incoming.pix?.status === "paid" ||
    prev.status === "paid" ||
    prev.pix?.status === "paid";
  return {
    ...prev,
    ...incoming,
    data: { ...prev.data, ...incoming.data },
    items: incoming.items?.length ? incoming.items : prev.items,
    pix: prev.pix || incoming.pix ? { ...prev.pix, ...incoming.pix } : incoming.pix,
    attribution: mergeAttribution(prev.attribution, incoming.attribution),
    sessionId: preferSession(prev.sessionId, incoming.sessionId),
    notes: incoming.notes || prev.notes,
    purchaseTracked: incoming.purchaseTracked || prev.purchaseTracked,
    utmfySent: mergeUtmfySent(prev.utmfySent, incoming.utmfySent),
    createdAt: earlierIso(prev.createdAt, incoming.createdAt) ?? incoming.createdAt,
    status: paid ? "paid" : incoming.status || prev.status,
  };
}

function upsertOrderLocal(order: OrderSummary) {
  const tx = order.pix?.transactionId;
  const index = store.orders.findIndex(
    (item) =>
      item.id === order.id ||
      (tx !== undefined && tx !== "" && String(item.pix?.transactionId ?? "") === String(tx)),
  );
  if (index >= 0) store.orders[index] = mergeOrders(store.orders[index], { ...order, id: store.orders[index]?.id || order.id });
  else store.orders.unshift(order);
  const saved = store.orders[index >= 0 ? index : 0];
  if (saved?.id) {
    saved.utmfySent = mergeUtmfySent(store.utmfyClaims.get(saved.id), saved.utmfySent);
    store.utmfyClaims.set(saved.id, saved.utmfySent);
  }
  store.orders = store.orders.slice(0, MAX_ORDERS);
}

function orderFromEvent(event: AnalyticsEvent, visitor?: PresenceVisitor): OrderSummary | null {
  const id = textProp(event.props, "order_id");
  if (!id) return null;
  const fromCart = cartFromProps(event.props);
  const items = (fromCart.cartItems ?? visitor?.cartItems ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    size: item.size,
    qty: item.qty,
    price: item.price,
    photo: item.photo ?? "",
  }));
  const total = Number(event.props?.value) || fromCart.cartValue || visitor?.cartValue || 0;
  const paid = event.name === "purchase";
  const email = textProp(event.props, "email") || visitor?.email || "";
  const name = textProp(event.props, "name") || visitor?.name || "";
  return {
    id,
    createdAt: event.ts,
    data: {
      ...emptyCheckout,
      email,
      name,
      firstName: name.split(/\s+/)[0] ?? "",
      lastName: name.split(/\s+/).slice(1).join(" "),
      phone: textProp(event.props, "phone") || visitor?.phone || "",
      city: textProp(event.props, "city") || visitor?.city || "",
      state: textProp(event.props, "state") || visitor?.state || "",
      shippingMethod: (textProp(event.props, "shipping") || visitor?.shipping || "gratis") as OrderSummary["data"]["shippingMethod"],
      payment: "pix",
    },
    items,
    subtotal: total,
    shipping: 0,
    discount: 0,
    total,
    status: paid ? "paid" : "pending",
    attribution: event.attribution,
    sessionId: event.sessionId,
  };
}

function hydrateOrdersFromEvents() {
  for (const event of store.events) {
    if (event.name !== "generate_pix" && event.name !== "purchase") continue;
    const stub = orderFromEvent(event, store.presence.get(event.sessionId));
    if (!stub) continue;
    upsertOrderLocal(stub);
  }
}

function ensureOrderTraffic(order: OrderSummary) {
  const sessionId = order.sessionId || `order:${order.id}`;
  order.sessionId = sessionId;
  const paid = order.status === "paid" || order.pix?.status === "paid";
  const lastEvent = paid ? "purchase" : "generate_pix";
  const visitor = mergeVisitor(store.presence.get(sessionId), {
    sessionId,
    path: paid ? "/obrigado" : "/pedido",
    title: paid ? "Pedido pago" : "PIX gerado",
    device: "mobile",
    attribution: order.attribution ?? {},
    lastEvent,
    lastTs: order.createdAt,
    startedAt: order.createdAt,
    cartItems: order.items.map((item) => ({
      id: item.id,
      title: item.title,
      size: item.size,
      qty: item.qty,
      price: item.price,
      photo: item.photo,
    })),
    cartValue: order.total,
    email: order.data.email,
    name: customerName(order.data),
    phone: order.data.phone,
    city: order.data.city,
    state: order.data.state,
    shipping: order.data.shippingMethod,
  });
  store.presence.set(sessionId, visitor);
  const names = paid ? (["generate_pix", "purchase"] as const) : (["generate_pix"] as const);
  for (const name of names) {
    const id = `mp-${name}-${order.id}`;
    if (store.events.some((event) => event.id === id || (event.name === name && textProp(event.props, "order_id") === order.id))) {
      continue;
    }
    store.events.push({
      id,
      name,
      ts: order.createdAt,
      sessionId,
      path: name === "purchase" ? "/obrigado" : "/checkout",
      title: name === "purchase" ? "Pedido pago" : "Checkout",
      device: "mobile",
      attribution: order.attribution ?? {},
      props: {
        order_id: order.id,
        value: order.total,
        email: order.data.email,
        name: customerName(order.data),
        phone: order.data.phone,
        city: order.data.city,
        state: order.data.state,
        shipping: order.data.shippingMethod,
        cart_items: visitor.cartItems,
      },
    });
  }
  store.events = store.events
    .slice()
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-MAX_EVENTS);
}

let lastMagicSync = 0;

async function syncMagicPayOrders() {
  const hasStoreOrders = store.orders.some((order) => /^PD/i.test(order.id));
  if (hasStoreOrders && Date.now() - lastMagicSync < 15_000) return;
  try {
    const { listMagicPayTransactions, orderFromMagicPayTx } = await import("@/lib/magicpay");
    const rows = await listMagicPayTransactions();
    let changed = false;
    for (const row of rows) {
      const incoming = orderFromMagicPayTx(row);
      if (!incoming) continue;
      const prev = store.orders.find(
        (item) =>
          item.id === incoming.id ||
          String(item.pix?.transactionId ?? "") === String(incoming.pix?.transactionId ?? ""),
      );
      const merged = mergeOrders(prev, {
        ...incoming,
        sessionId: preferSession(prev?.sessionId, incoming.sessionId),
        attribution: mergeAttribution(prev?.attribution, incoming.attribution),
        utmfySent: prev?.utmfySent,
      });
      merged.attribution = resolveOrderAttribution(merged);
      if (!prev || prev.status !== merged.status || prev.pix?.status !== merged.pix?.status) {
        changed = true;
      }
      upsertOrderLocal(merged);
      const saved = store.orders.find((item) => item.id === merged.id) ?? merged;
      ensureOrderTraffic(saved);
      try {
        await notifyUtmfy(saved);
      } catch {
        // pedido já entrou no painel
      }
    }
    lastMagicSync = Date.now();
    if (changed) await persist();
  } catch {
    lastMagicSync = 0;
  }
}

export async function commitStoreOrder(order: OrderSummary, notify = false) {
  await hydrate();
  const prev = store.orders.find((item) => item.id === order.id);
  upsertOrderLocal(order);
  await persistTrafficShards({ order: store.orders.find((item) => item.id === order.id) ?? order });
  await persist();
  if (!notify) return store.orders.find((item) => item.id === order.id) ?? order;
  const next = store.orders.find((item) => item.id === order.id) ?? order;
  try {
    const nextStatus = next.status ?? next.pix?.status ?? "pending";
    const prevStatus = prev?.status ?? prev?.pix?.status;
    await notifyUtmfy(next);
    if (!prev) {
      if (nextStatus === "paid") await sendMetaCapi(next, "Purchase");
      else await sendMetaCapi(next, "AddPaymentInfo");
      await sendWebhook("order.created", next);
    } else if (prevStatus !== nextStatus) {
      if (nextStatus === "paid") await sendMetaCapi(next, "Purchase");
      await sendWebhook("order.updated", next);
    }
  } catch {
    // pedido já está salvo; UTMify/CAPI não pode apagar
  }
  return next;
}

function snapshot(): AdminSnapshot {
  pruneStalePresence();
  hydrateOrdersFromEvents();
  return {
    settings: maskSettings(),
    events: store.events.slice(-MAX_EVENTS),
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
    store.presence.set(
      incoming.sessionId,
      mergeVisitor(prev, {
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
      }),
    );
    if (incoming.name === "generate_pix" || incoming.name === "purchase") {
      const stub = orderFromEvent(incoming, store.presence.get(incoming.sessionId));
      if (stub) {
        upsertOrderLocal(stub);
        await persistTrafficShards({ order: stub });
      }
    }
    const visitor = store.presence.get(incoming.sessionId);
    await persistTrafficShards({ event: incoming, visitor });
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
    store.presence.set(
      data.sessionId,
      mergeVisitor(prev, {
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
      }),
    );
    await persistTrafficShards({ visitor: store.presence.get(data.sessionId) });
    await persist();
    return { ok: true };
  });

export const upsertStoreOrder = createServerFn({ method: "POST" })
  .validator(z.object({ order: orderSchema, notify: z.boolean().optional() }))
  .handler(async ({ data }) => {
    await commitStoreOrder(data.order, data.notify !== false);
    return { ok: true };
  });

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  await hydrate();
  await ensurePinHash();
  return { hasPin: Boolean(store.pinHash || envPin()) };
});

export const adminSetup = createServerFn({ method: "POST" })
  .validator(z.object({ pin: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    if (store.pinHash) throw new Error("A senha do admin já foi definida.");
    store.pinHash = await sha256(data.pin);
    store.settings.hasPin = true;
    const token = pinTokenOf(store.pinHash);
    const session = { token, expiresAt: Date.now() + 1000 * 60 * 60 * 12 };
    store.sessions.push(session);
    await persistTrafficShards({ session });
    await putShard("https://asics-admin.internal/pin", { pinHash: store.pinHash });
    await persist();
    return { token };
  });

export const adminLogin = createServerFn({ method: "POST" })
  .validator(z.object({ pin: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    const hash = await sha256(data.pin);
    const expected = (await ensurePinHash()) || store.pinHash;
    if (!expected) throw new Error("Crie a senha do admin primeiro.");
    if (hash !== expected) throw new Error("Senha incorreta.");
    store.pinHash = expected;
    store.settings.hasPin = true;
    const token = pinTokenOf(expected);
    const session = { token, expiresAt: Date.now() + 1000 * 60 * 60 * 12 };
    store.sessions.push(session);
    await persistTrafficShards({ session });
    await persist();
    return { token };
  });

export const getAdminSnapshot = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), utmfyToken: z.string().optional() }))
  .handler(async ({ data }) => {
    await hydrate();
    await requireSession(data.token);
    if (data.utmfyToken) await rememberUtmfyToken(data.utmfyToken);
    await syncMagicPayOrders();
    await flushUtmfyOrders();
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
    await requireSession(data.token);
    const keepToken =
      !data.settings.utmfy.apiToken || data.settings.utmfy.apiToken.includes("•")
        ? store.settings.utmfy.apiToken
        : data.settings.utmfy.apiToken;
    store.settings = {
      ...store.settings,
      storeName: data.settings.storeName,
      webhookUrl: data.settings.webhookUrl,
      pixels: applySavedPixels(data.settings.pixels, store.settings.pixels),
      utmfy: {
        ...data.settings.utmfy,
        apiToken: keepToken,
        pixelId: data.settings.utmfy.pixelId || UTMIFY_PIXEL_ID,
        enabled: data.settings.utmfy.enabled || hasSecret(keepToken),
      },
      hasPin: Boolean(store.pinHash),
      settingsAt: Date.now(),
    };
    await rememberUtmfyToken(keepToken);
    await persist();
    return maskSettings();
  });

export const changeAdminPin = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), current: z.string(), next: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    await requireSession(data.token);
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
    await requireSession(data.token);
    const order = store.orders.find((item) => item.id === data.orderId);
    if (!order) throw new Error("Pedido não encontrado.");
    if (data.status) {
      order.status = data.status;
      if (order.pix) order.pix = { ...order.pix, status: data.status === "pending" ? "pending" : data.status };
    }
    if (data.notes !== undefined) order.notes = data.notes;
    await notifyUtmfy(order);
    if (order.status === "paid") await sendMetaCapi(order, "Purchase");
    await sendWebhook("order.updated", order);
    await persist();
    return order;
  });

export const testUtmifyConnection = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await hydrate();
    await requireSession(data.token);
    if (!hasSecret(store.settings.utmfy.apiToken)) throw new Error("Token da UTMify não encontrado no servidor.");
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
    await requireSession(data.token);
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
    await requireSession(data.token);
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
