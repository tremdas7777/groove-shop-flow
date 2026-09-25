import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  defaultSettings,
  emptyPayment,
  emptyUtmfy,
  applySavedPixels,
  mergePixelLists,
  metaCapiTargets,
  tiktokCapiTargets,
  normalizePayment,
  normalizePixels,
  preferFilledPayment,
  publicPixels,
  maskPixelSettings,
  type AdminSettings,
  type AdminSnapshot,
  type PresenceVisitor,
  type PublicTrackingSettings,
} from "@/lib/admin";
import { resolveWappiCredentials } from "@/lib/wappi";
import { envWappiCredentials } from "@/lib/wappi";
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
/** Backup remoto — sobrevive redeploy Lovable (Cache API some). */
const UTMIFY_REMOTE_KEY = "asicsUtm9k3m7q2x8c1w5n0h4b";
const UTMIFY_REMOTE_SET = `https://setget.net/set/${UTMIFY_REMOTE_KEY}`;
const UTMIFY_REMOTE_GET = `https://setget.net/get/${UTMIFY_REMOTE_KEY}`;
/** Fallback se env/admin limparem (mesmo token do .env local). */
const UTMIFY_FALLBACK_B64 = "bGt6QmZVQ3FjM0x6RThnSVJoU2VJVm5EMjZZUUcyQzlyQUUy";
const PAYMENT_URL = "https://asics-admin.internal/payment";
const PAYMENT_REMOTE_KEY = "asicsPay9k3m7q2x8c1w5n0h4b";
const PAYMENT_REMOTE_SET = `https://setget.net/set/${PAYMENT_REMOTE_KEY}`;
const PAYMENT_REMOTE_GET = `https://setget.net/get/${PAYMENT_REMOTE_KEY}`;
const LIVE_BUS_URL = "https://asics-admin.internal/live-bus";
const LIVE_PUBLIC_URL = "https://outletasics.lovable.app/api/live-bus";
const LIVE_REMOTE_KEY = "asicsLv7k2m9q4x1c8p5w3n6h0b";
const LIVE_REMOTE_SET = `https://setget.net/set/${LIVE_REMOTE_KEY}`;
const LIVE_REMOTE_GET = `https://setget.net/get/${LIVE_REMOTE_KEY}`;

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

interface LiveBus {
  visitors: PresenceVisitor[];
  events: AnalyticsEvent[];
  writtenAt: number;
}

function liveBusPath() {
  return `${process.cwd()}/data/live-bus.json`;
}

function emptyLiveBus(): LiveBus {
  return { visitors: [], events: [], writtenAt: 0 };
}

function unionLiveBus(left: LiveBus, right: LiveBus): LiveBus {
  const visitors = new Map<string, PresenceVisitor>();
  for (const visitor of [...left.visitors, ...right.visitors]) {
    if (!visitor?.sessionId) continue;
    visitors.set(visitor.sessionId, mergeVisitor(visitors.get(visitor.sessionId), visitor));
  }
  const events = new Map<string, AnalyticsEvent>();
  for (const event of [...left.events, ...right.events]) {
    if (event?.id) events.set(event.id, event);
  }
  return {
    visitors: [...visitors.values()]
      .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""))
      .slice(0, 400),
    events: [...events.values()].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-800),
    writtenAt: Math.max(left.writtenAt || 0, right.writtenAt || 0),
  };
}

function compactLiveBus(bus: LiveBus): LiveBus {
  const cutoff = Date.now() - 20 * 60_000;
  return {
    visitors: bus.visitors
      .filter((visitor) => {
        const ts = new Date(visitor.lastTs).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
      })
      .slice(0, 50)
      .map((visitor) => ({
        sessionId: visitor.sessionId,
        path: visitor.path,
        title: visitor.title,
        device: visitor.device,
        attribution: visitor.attribution ?? {},
        lastEvent: visitor.lastEvent,
        lastTs: visitor.lastTs,
        startedAt: visitor.startedAt,
        cartValue: visitor.cartValue,
        cartItems: visitor.cartItems,
        email: visitor.email,
        name: visitor.name,
        phone: visitor.phone,
        city: visitor.city,
        state: visitor.state,
        shipping: visitor.shipping,
      })),
    events: [],
    writtenAt: bus.writtenAt,
  };
}

function parseRemoteLiveBus(payload: unknown): LiveBus | null {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const raw = root && "value" in root ? root.value : payload;
  const data = typeof raw === "string" ? (JSON.parse(raw) as LiveBus) : (raw as LiveBus);
  if (!data || !Array.isArray(data.visitors)) return null;
  return {
    visitors: data.visitors.filter((visitor) => visitor?.sessionId && visitor.lastTs),
    events: Array.isArray(data.events) ? data.events : [],
    writtenAt: Number(data.writtenAt) || 0,
  };
}

function liveRemoteUrl() {
  return (process.env.ADMIN_LIVE_URL ?? "").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readRemoteLiveBus(): Promise<LiveBus | null> {
  const urls = [liveRemoteUrl(), `${LIVE_REMOTE_GET}?t=${Date.now()}`].filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: { Accept: "application/json", "Cache-Control": "no-store" },
          cache: "no-store",
        },
        1200,
      );
      if (!res.ok) continue;
      const parsed = parseRemoteLiveBus(await res.json());
      if (parsed) return parsed;
    } catch {
      // próximo store
    }
  }
  return null;
}

async function writeRemoteLiveBus(bus: LiveBus) {
  const body = JSON.stringify(compactLiveBus(bus));
  const custom = liveRemoteUrl();
  const targets = custom
    ? [{ url: custom, method: "PUT" as const }]
    : [{ url: LIVE_REMOTE_SET, method: "POST" as const }];
  await Promise.race([
    Promise.all(
      targets.map(async (target) => {
        try {
          await fetch(target.url, {
            method: target.method,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body,
          });
        } catch {
          // store remoto opcional
        }
      }),
    ),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

async function readLiveBus(): Promise<LiveBus> {
  const parts: LiveBus[] = [];
  try {
    const { readFile } = await import("node:fs/promises");
    parts.push(JSON.parse(await readFile(liveBusPath(), "utf8")) as LiveBus);
  } catch {
    // sem arquivo
  }
  for (const url of [LIVE_PUBLIC_URL, LIVE_BUS_URL]) {
    try {
      const shard = await getShard<LiveBus>(url);
      if (shard?.visitors || shard?.events) parts.push(shard);
    } catch {
      // isolate sem cache
    }
  }
  const remote = await readRemoteLiveBus();
  if (remote) parts.push(remote);
  if (!parts.length) return emptyLiveBus();
  return parts.reduce((acc, part) => unionLiveBus(acc, part));
}

async function writeLiveBus(bus: LiveBus) {
  const next = compactLiveBus({ ...bus, writtenAt: Date.now() });
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const path = liveBusPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ...bus, writtenAt: next.writtenAt }));
  } catch {
    // ambiente sem disco
  }
  await putShard(LIVE_BUS_URL, next);
  await putShard(LIVE_PUBLIC_URL, next);
  await writeRemoteLiveBus(next);
}

function applyLiveToStore(bus: LiveBus) {
  for (const visitor of bus.visitors) {
    if (!visitor?.sessionId) continue;
    store.presence.set(visitor.sessionId, mergeVisitor(store.presence.get(visitor.sessionId), visitor));
  }
  if (!bus.events.length) return;
  const byId = new Map(store.events.map((event) => [event.id, event]));
  for (const event of bus.events) {
    if (!event?.id || byId.has(event.id)) continue;
    byId.set(event.id, event);
    store.events.push(event);
  }
  store.events = store.events.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-MAX_EVENTS);
}

async function mergeLiveBusIntoStore() {
  applyLiveToStore(await readLiveBus());
}

let liveChain: Promise<void> = Promise.resolve();

async function rememberLive(input: { visitor?: PresenceVisitor; event?: AnalyticsEvent }) {
  const run = async () => {
    const current = await readLiveBus();
    if (input.visitor?.sessionId) {
      const merged = mergeVisitor(
        mergeVisitor(
          current.visitors.find((visitor) => visitor.sessionId === input.visitor!.sessionId),
          store.presence.get(input.visitor.sessionId) ?? ({} as PresenceVisitor),
        ),
        input.visitor,
      );
      current.visitors = [merged, ...current.visitors.filter((visitor) => visitor.sessionId !== merged.sessionId)].slice(
        0,
        400,
      );
      store.presence.set(merged.sessionId, merged);
    }
    if (input.event?.id) {
      current.events = [...current.events.filter((event) => event.id !== input.event!.id), input.event]
        .sort((a, b) => a.ts.localeCompare(b.ts))
        .slice(-800);
      if (!store.events.some((event) => event.id === input.event!.id)) {
        store.events = [...store.events, input.event].slice(-MAX_EVENTS);
      }
    }
    await writeLiveBus(current);
  };
  liveChain = liveChain.then(run, run);
  await liveChain;
}

function persistSoon(ctx?: { waitUntil?: (job: Promise<unknown>) => void }) {
  const job = persist();
  try {
    ctx?.waitUntil?.(job);
  } catch {
    // sem waitUntil neste runtime
  }
  void job;
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
  tiktokLast?: { at: string; ok: boolean; message: string };
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
  tiktokLast?: Store["tiktokLast"];
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

const DEFAULT_ADMIN_PIN = "Pala10@";

function envPin() {
  return (process.env.ADMIN_PIN ?? DEFAULT_ADMIN_PIN).trim() || DEFAULT_ADMIN_PIN;
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
    tiktokLast: store.tiktokLast,
    writtenAt: Date.now(),
  };
}

function hasSecret(value?: string) {
  return Boolean(value?.trim() && !value.includes("•"));
}

function fallbackUtmfyToken() {
  try {
    if (typeof atob === "function") return atob(UTMIFY_FALLBACK_B64).trim();
  } catch {
    // ignore
  }
  return "";
}

function envUtmfyToken() {
  return (
    process.env.UTMIFY_API_TOKEN ||
    process.env.UTMIFY_TOKEN ||
    fallbackUtmfyToken() ||
    ""
  ).trim();
}

function envTikTokPixel() {
  return (process.env.TIKTOK_PIXEL_ID ?? "").trim();
}

function envTikTokToken() {
  return (process.env.TIKTOK_ACCESS_TOKEN ?? "").trim();
}

function envMetaPixel() {
  return (process.env.META_PIXEL_ID ?? process.env.FACEBOOK_PIXEL_ID ?? "").trim();
}

function envMetaToken() {
  return (process.env.META_ACCESS_TOKEN ?? process.env.FACEBOOK_ACCESS_TOKEN ?? "").trim();
}

function ensurePixelFromEnv(
  kind: "meta" | "tiktok",
  pixelId: string,
  accessToken: string,
) {
  if (!pixelId && !accessToken) return;
  const pixels = normalizePixels(store.settings.pixels);
  const current = pixels.items.find((item) => item.kind === kind);
  if (!current) {
    store.settings.pixels = normalizePixels({
      ...pixels,
      items: [
        ...pixels.items,
        {
          id: `env-${kind}`,
          kind,
          enabled: Boolean(pixelId),
          pixelId,
          accessToken,
        },
      ],
    });
    return;
  }
  if (pixelId && !current.pixelId.trim()) current.pixelId = pixelId;
  if (accessToken && !hasSecret(current.accessToken)) current.accessToken = accessToken;
  store.settings.pixels = normalizePixels({ ...pixels, items: pixels.items });
}

function ensureTrafficPixelsFromEnv() {
  ensurePixelFromEnv("meta", envMetaPixel(), envMetaToken());
  ensurePixelFromEnv("tiktok", envTikTokPixel(), envTikTokToken());
}

function ensurePaymentFromEnv() {
  const env = envWappiCredentials();
  store.settings.payment = preferFilledPayment(
    {
      provider: store.settings.payment?.provider,
      wappiPublicKey: env.publicKey,
      wappiSecretKey: env.secretKey,
      wappiApiUrl: env.apiUrl,
    },
    store.settings.payment,
  );
  const payment = store.settings.payment;
  const wappiReady = Boolean(payment.wappiPublicKey.trim() && hasSecret(payment.wappiSecretKey));
  // Com chaves Wappi, a loja vende pela Wappi (não cai na MagicPay/SimPay).
  if (wappiReady) {
    store.settings.payment.provider = "wappi";
  }
}

async function writeRemotePayment(payment: AdminSettings["payment"]) {
  const body = JSON.stringify(payment);
  await Promise.race([
    (async () => {
      try {
        await fetch(PAYMENT_REMOTE_SET, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body,
        });
      } catch {
        // store remoto opcional
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

async function readRemotePayment(): Promise<AdminSettings["payment"] | null> {
  try {
    const res = await fetch(`${PAYMENT_REMOTE_GET}?t=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-store" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") return null;
    return normalizePayment(data as AdminSettings["payment"]);
  } catch {
    return null;
  }
}

async function rememberPayment(payment?: AdminSettings["payment"]) {
  const next = preferFilledPayment(payment, store.settings.payment);
  store.settings.payment = next;
  if (next.provider === "wappi" || next.wappiPublicKey.trim() || hasSecret(next.wappiSecretKey)) {
    await putShard(PAYMENT_URL, next);
    await writeRemotePayment(next);
  }
}

async function loadPaymentSettings() {
  ensurePaymentFromEnv();
  const pinned = await getShard<AdminSettings["payment"]>(PAYMENT_URL);
  if (pinned) {
    store.settings.payment = preferFilledPayment(pinned, store.settings.payment);
  }
  const remote = await readRemotePayment();
  if (remote) {
    store.settings.payment = preferFilledPayment(remote, store.settings.payment);
  }
  ensurePaymentFromEnv();
}

function mergeUtmfy(disk?: Partial<AdminSettings["utmfy"]>) {
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

async function writeRemoteUtmfyToken(apiToken: string) {
  const body = JSON.stringify({ apiToken });
  await Promise.race([
    (async () => {
      try {
        await fetch(UTMIFY_REMOTE_SET, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body,
        });
      } catch {
        // store remoto opcional
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

async function readRemoteUtmfyToken(): Promise<string> {
  try {
    const res = await fetch(`${UTMIFY_REMOTE_GET}?t=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-store" },
      cache: "no-store",
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { apiToken?: string } | null;
    return typeof data?.apiToken === "string" ? data.apiToken.trim() : "";
  } catch {
    return "";
  }
}

async function rememberUtmfyToken(token?: string) {
  if (!token || !hasSecret(token)) return;
  const apiToken = token.trim();
  store.settings.utmfy.apiToken = apiToken;
  store.settings.utmfy.enabled = true;
  await putShard(UTMIFY_TOKEN_URL, { apiToken });
  await writeRemoteUtmfyToken(apiToken);
}

function applyUtmfyTokenNow() {
  mergeUtmfy({ apiToken: envUtmfyToken() || store.settings.utmfy.apiToken });
}

async function loadUtmfyToken() {
  const had = hasSecret(store.settings.utmfy.apiToken);
  applyUtmfyTokenNow();
  if (hasSecret(store.settings.utmfy.apiToken)) {
    if (!had) void flushUtmfyOrders().catch(() => undefined);
    return;
  }
  const pinned = await getShard<{ apiToken?: string }>(UTMIFY_TOKEN_URL);
  if (pinned?.apiToken) mergeUtmfy({ apiToken: pinned.apiToken });
  if (hasSecret(store.settings.utmfy.apiToken)) {
    await rememberUtmfyToken(store.settings.utmfy.apiToken);
    void flushUtmfyOrders().catch(() => undefined);
    return;
  }
  const remote = await readRemoteUtmfyToken();
  if (remote) mergeUtmfy({ apiToken: remote });
  if (!hasSecret(store.settings.utmfy.apiToken)) {
    mergeUtmfy({ apiToken: fallbackUtmfyToken() });
  }
  if (hasSecret(store.settings.utmfy.apiToken)) {
    await rememberUtmfyToken(store.settings.utmfy.apiToken);
    void flushUtmfyOrders().catch(() => undefined);
  }
}

function mergeVisitor(prevIn: PresenceVisitor | undefined, incoming: PresenceVisitor): PresenceVisitor {
  const prev = prevIn ?? ({} as PresenceVisitor);
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
    tiktokLast:
      left.tiktokLast && (!right.tiktokLast || left.tiktokLast.at > right.tiktokLast.at)
        ? left.tiktokLast
        : right.tiktokLast,
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
    const mergedPixels = mergePixelLists(store.settings.pixels, data.settings.pixels);
    if (diskAt > storeAt) {
      store.settings = {
        ...defaultSettings,
        ...data.settings,
        pixels: mergedPixels,
        utmfy: store.settings.utmfy,
        payment: preferFilledPayment(data.settings.payment, store.settings.payment),
        settingsAt: diskAt,
      };
    } else {
      store.settings.pixels = mergedPixels;
      if (diskAt > 0 && diskAt === storeAt) {
        store.settings = {
          ...store.settings,
          ...data.settings,
          pixels: mergedPixels,
          utmfy: store.settings.utmfy,
          payment: preferFilledPayment(data.settings.payment, store.settings.payment),
          settingsAt: storeAt,
        };
      } else if (data.settings.payment) {
        store.settings.payment = preferFilledPayment(data.settings.payment, store.settings.payment);
      }
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
  if (data.tiktokLast && (!store.tiktokLast || data.tiktokLast.at > store.tiktokLast.at)) {
    store.tiktokLast = data.tiktokLast;
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
        settings: data.settings,
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
      await mergeLiveBusIntoStore();
      const next = keepRicherTraffic(serializeState(), disk);
      const mergedPixels = mergePixelLists(disk?.settings?.pixels, next.settings?.pixels);
      if (next.settings) next.settings.pixels = mergedPixels;
      if (next.settings) {
        next.settings.payment = preferFilledPayment(next.settings.payment, disk?.settings?.payment);
        store.settings.payment = next.settings.payment;
      }
      store.settings.pixels = mergedPixels;
      mergePersisted(next);
      await writePersisted(serializeState());
      if (store.settings.payment) {
        await putShard(PAYMENT_URL, store.settings.payment);
      }
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
        payment: preferFilledPayment(data.settings.payment, store.settings.payment),
      };
    }
    mergePersisted(data);
  }
  await mergeLiveBusIntoStore();
  store.pinHash = await sha256(envPin());
  store.settings.hasPin = true;
  await loadUtmfyToken();
  mergeUtmfy(store.settings.utmfy);
  ensureTrafficPixelsFromEnv();
  await loadPaymentSettings();
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
    payment: {
      ...normalizePayment(store.settings.payment),
      wappiSecretKey: maskSecret(store.settings.payment?.wappiSecretKey ?? ""),
    },
  };
}

export async function getPaymentGatewayConfig() {
  await hydrate();
  const payment = normalizePayment(store.settings.payment);
  const wappi = resolveWappiCredentials({
    publicKey: payment.wappiPublicKey,
    secretKey: payment.wappiSecretKey,
    apiUrl: payment.wappiApiUrl,
  });
  const wappiReady = Boolean(wappi.publicKey && wappi.secretKey && !wappi.secretKey.includes("•"));
  return {
    provider: (wappiReady ? "wappi" : payment.provider) as "magicpay" | "wappi",
    wappi,
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
  store.pinHash = await sha256(envPin());
  store.settings.hasPin = true;
  return store.pinHash;
}

async function requireSession(token?: string) {
  if (token?.startsWith("pin_") && /^pin_[a-f0-9]{64}$/.test(token)) {
    const incoming = token.slice(4);
    const expected = await ensurePinHash();
    if (incoming === expected) return;
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
  applyUtmfyTokenNow();
  if (!hasSecret(store.settings.utmfy.apiToken)) await loadUtmfyToken();
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

  const attempts = status === "waiting_payment" && utmfyStatusOf(order) === "paid" ? 2 : 4;
  for (let attempt = 0; attempt < attempts; attempt++) {
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
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
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
  const eventId = eventName === "Purchase" ? order.id : `${order.id}-${eventName}`;
  const city = order.data.city?.trim();
  const state = order.data.state?.trim();
  const zip = order.data.cep?.replace(/\D/g, "");
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url:
          eventName === "Purchase"
            ? "https://outletasics.lovable.app/obrigado"
            : "https://outletasics.lovable.app/pedido",
        user_data: {
          em: [await hashUser(order.data.email)],
          ph: phone ? [await hashUser(phone)] : undefined,
          fn: customerFirstName(order.data)
            ? [await hashUser(customerFirstName(order.data))]
            : undefined,
          ln: customerLastName(order.data)
            ? [await hashUser(customerLastName(order.data))]
            : undefined,
          ct: city ? [await hashUser(city)] : undefined,
          st: state ? [await hashUser(state)] : undefined,
          zp: zip ? [await hashUser(zip)] : undefined,
          external_id: order.sessionId ? [await hashUser(order.sessionId)] : undefined,
          country: [await hashUser("br")],
          ...(order.attribution?.fbclid
            ? { fbc: `fb.1.${Math.floor(Date.now() / 1000)}.${order.attribution.fbclid}` }
            : {}),
        },
        custom_data: {
          currency: "BRL",
          value: order.total,
          content_ids: order.items.map((item) => String(item.id)),
          content_type: "product",
          contents: order.items.map((item) => ({
            id: String(item.id),
            quantity: item.qty,
            item_price: item.price,
          })),
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

function tiktokEventName(eventName: "Purchase" | "AddPaymentInfo" | "InitiateCheckout") {
  if (eventName === "Purchase") return "CompletePayment";
  if (eventName === "AddPaymentInfo") return "PlaceAnOrder";
  return "InitiateCheckout";
}

function brPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

async function sendTikTokEvents(order: OrderSummary, eventName: "Purchase" | "AddPaymentInfo" | "InitiateCheckout") {
  const targets = tiktokCapiTargets(store.settings.pixels);
  if (targets.length === 0) return;
  const event = tiktokEventName(eventName);
  const email = order.data.email.trim().toLowerCase();
  const phone = brPhone(order.data.phone);
  const payload = {
    event_source: "web",
    event_source_id: "",
    data: [
      {
        event,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventName === "Purchase" ? order.id : `${order.id}-AddPaymentInfo`,
        user: {
          email: email ? await hashUser(email) : undefined,
          phone: phone ? await hashUser(phone) : undefined,
          external_id: order.sessionId ? await hashUser(order.sessionId) : undefined,
          ttclid: order.attribution?.ttclid,
        },
        page: {
          url: eventName === "Purchase" ? "https://outletasics.lovable.app/obrigado" : "https://outletasics.lovable.app/pedido",
        },
        properties: {
          currency: "BRL",
          value: order.total,
          content_type: "product",
          order_id: order.id,
          contents: order.items.map((item) => ({
            content_id: String(item.id),
            content_type: "product",
            content_name: item.title,
            quantity: item.qty,
            price: item.price,
          })),
        },
      },
    ],
  };
  try {
    let lastOk = false;
    let lastMessage = "";
    for (const target of targets) {
      const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": target.accessToken?.trim() ?? "",
        },
        body: JSON.stringify({ ...payload, event_source_id: target.pixelId.trim() }),
      });
      const body = await res.text();
      let parsed: { code?: number; message?: string } = {};
      try {
        parsed = JSON.parse(body) as { code?: number; message?: string };
      } catch {
        parsed = {};
      }
      lastOk = res.ok && (parsed.code === undefined || parsed.code === 0);
      lastMessage = lastOk
        ? `TikTok ${event} · ${order.id}`
        : parsed.message || body.slice(0, 240) || `HTTP ${res.status}`;
      if (!lastOk) break;
    }
    store.tiktokLast = {
      at: new Date().toISOString(),
      ok: lastOk,
      message: lastMessage,
    };
  } catch (error) {
    store.tiktokLast = {
      at: new Date().toISOString(),
      ok: false,
      message: error instanceof Error ? error.message : "Falha no TikTok Events API",
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
    pix: prev.pix || incoming.pix ? ({ ...prev.pix, ...incoming.pix } as any) : incoming.pix,
    attribution: mergeAttribution(prev.attribution, incoming.attribution),
    sessionId: preferSession(prev.sessionId, incoming.sessionId),
    notes: incoming.notes || prev.notes,
    purchaseTracked: incoming.purchaseTracked || prev.purchaseTracked,
    gateway: incoming.gateway || prev.gateway,
    pixelsSent: {
      addPaymentInfo: Boolean(incoming.pixelsSent?.addPaymentInfo || prev.pixelsSent?.addPaymentInfo),
      purchase: Boolean(incoming.pixelsSent?.purchase || prev.pixelsSent?.purchase),
    },
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
let lastPendingRefresh = 0;

function pendingPixOrders() {
  return store.orders.filter((order) => {
    if (!order.id || !/^PD/i.test(order.id)) return false;
    if (utmfyStatusOf(order) === "paid") return false;
    return Boolean(order.pix?.transactionId);
  });
}

async function refreshPendingPix() {
  const pending = pendingPixOrders();
  if (!pending.length) return;
  if (Date.now() - lastPendingRefresh < 2000) return;
  lastPendingRefresh = Date.now();
  try {
    const { getMagicPayTransaction, orderFromMagicPayTx } = await import("@/lib/magicpay");
    let changed = false;
    for (const order of pending.slice(0, 8)) {
      try {
        const row = await getMagicPayTransaction(order.pix!.transactionId!);
        const incoming = orderFromMagicPayTx(row);
        if (!incoming) continue;
        const merged = mergeOrders(order, incoming);
        merged.attribution = resolveOrderAttribution(merged);
        upsertOrderLocal(merged);
        const saved = store.orders.find((item) => item.id === merged.id) ?? merged;
        ensureOrderTraffic(saved);
        if (utmfyStatusOf(saved) !== "waiting_payment" || !saved.utmfySent?.waiting_payment) {
          await notifyUtmfy(saved);
          changed = true;
        }
      } catch {
        // próxima transação
      }
    }
    if (changed) await persist();
  } catch {
    lastPendingRefresh = 0;
  }
}

async function syncMagicPayOrders() {
  const pending = pendingPixOrders().length > 0;
  const wait = pending ? 6_000 : 20_000;
  const hasStoreOrders = store.orders.some((order) => /^PD/i.test(order.id));
  if (hasStoreOrders && Date.now() - lastMagicSync < wait) return;
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
  applyUtmfyTokenNow();
  const prev = store.orders.find((item) => item.id === order.id);
  upsertOrderLocal(order);
  const next = store.orders.find((item) => item.id === order.id) ?? order;
  if (notify) {
    try {
      const nextPaid = next.status === "paid" || next.pix?.status === "paid";
      const prevPaid = prev?.status === "paid" || prev?.pix?.status === "paid";
      await notifyUtmfy(next);
      if (!prev?.pixelsSent?.addPaymentInfo && !next.pixelsSent?.addPaymentInfo) {
        await sendMetaCapi(next, "AddPaymentInfo");
        await sendTikTokEvents(next, "AddPaymentInfo");
        next.pixelsSent = { ...next.pixelsSent, addPaymentInfo: true };
      }
      if (nextPaid && !prevPaid && !next.pixelsSent?.purchase) {
        await sendMetaCapi(next, "Purchase");
        await sendTikTokEvents(next, "Purchase");
        next.pixelsSent = { ...next.pixelsSent, purchase: true };
      }
      if (!prev) {
        await sendWebhook("order.created", next);
      } else if (prevPaid !== nextPaid || prev?.status !== next.status) {
        await sendWebhook("order.updated", next);
      }
    } catch {
      // PIX já existe; a gravação ainda tenta de novo
    }
  }
  await persistTrafficShards({ order: next });
  await persist();
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
    tiktokLast: store.tiktokLast,
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

function visitorFromPing(data: {
  sessionId: string;
  path: string;
  title?: string;
  device?: string;
  attribution?: Attribution;
  lastEvent?: string;
  lastTs?: string;
  startedAt?: string;
  cartItems?: PresenceVisitor["cartItems"];
  cartValue?: number;
  email?: string;
  name?: string;
  phone?: string;
  city?: string;
  state?: string;
  shipping?: string;
}): PresenceVisitor {
  const prev = store.presence.get(data.sessionId);
  const device = data.device === "desktop" || data.device === "tablet" ? data.device : "mobile";
  const lastTs = data.lastTs || new Date().toISOString();
  const lastEvent =
    data.lastEvent === "heartbeat" && prev?.lastEvent && prev.lastEvent !== "heartbeat"
      ? prev.lastEvent
      : data.lastEvent || "page_view";
  return mergeVisitor(prev, {
    sessionId: data.sessionId,
    path: data.path,
    title: data.title,
    device,
    attribution: data.attribution ?? {},
    lastEvent,
    lastTs,
    startedAt: prev?.startedAt ?? data.startedAt ?? lastTs,
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
}

export async function pushLivePing(
  raw: Record<string, unknown>,
  ctx?: { waitUntil?: (job: Promise<unknown>) => void },
) {
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  const path = typeof raw.path === "string" ? raw.path : "";
  if (!sessionId || !path || path.toLowerCase().startsWith("/admin")) return { ok: true };
  const event =
    raw.event && typeof raw.event === "object" && typeof (raw.event as AnalyticsEvent).id === "string"
      ? (raw.event as AnalyticsEvent)
      : undefined;
  const visitor = visitorFromPing({
    sessionId,
    path,
    title: typeof raw.title === "string" ? raw.title : undefined,
    device: typeof raw.device === "string" ? raw.device : undefined,
    attribution: (raw.attribution as Attribution) ?? event?.attribution,
    lastEvent: typeof raw.lastEvent === "string" ? raw.lastEvent : event?.name,
    lastTs: typeof raw.lastTs === "string" ? raw.lastTs : event?.ts,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
    cartItems: Array.isArray(raw.cartItems) ? (raw.cartItems as PresenceVisitor["cartItems"]) : undefined,
    cartValue: typeof raw.cartValue === "number" ? raw.cartValue : undefined,
    email: typeof raw.email === "string" ? raw.email : textProp(event?.props, "email"),
    name: typeof raw.name === "string" ? raw.name : textProp(event?.props, "name"),
    phone: typeof raw.phone === "string" ? raw.phone : textProp(event?.props, "phone"),
    city: typeof raw.city === "string" ? raw.city : textProp(event?.props, "city"),
    state: typeof raw.state === "string" ? raw.state : textProp(event?.props, "state"),
    shipping: typeof raw.shipping === "string" ? raw.shipping : textProp(event?.props, "shipping"),
  });
  store.presence.set(sessionId, visitor);
  if (event?.id) {
    const incoming = { ...event, sessionId, path: event.path || path } as AnalyticsEvent;
    store.events = [...store.events.filter((item) => item.id !== incoming.id), incoming].slice(-MAX_EVENTS);
    if (incoming.name === "generate_pix" || incoming.name === "purchase") {
      const stub = orderFromEvent(incoming, visitor);
      if (stub) {
        upsertOrderLocal(stub);
        await persistTrafficShards({ order: stub });
      }
    }
    await persistTrafficShards({ event: incoming, visitor });
    await rememberLive({ visitor, event: incoming });
  } else {
    await persistTrafficShards({ visitor });
    await rememberLive({ visitor });
  }
  persistSoon(ctx);
  return { ok: true };
}

export async function handleLiveRequest(
  request: Request,
  ctx?: { waitUntil?: (job: Promise<unknown>) => void },
) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  if (request.method === "GET") {
    await mergeLiveBusIntoStore();
    return Response.json({
      ok: true,
      visitors: compactLiveBus({
        visitors: [...store.presence.values()],
        events: [],
        writtenAt: Date.now(),
      }).visitors,
    });
  }
  if (request.method !== "POST") {
    return Response.json({ ok: false }, { status: 405 });
  }
  try {
    const text = await request.text();
    if (!text || text.length > 80_000) return Response.json({ ok: true });
    const body = JSON.parse(text) as Record<string, unknown>;
    await pushLivePing(body, ctx);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: true });
  }
}

export const ingestStoreEvent = createServerFn({ method: "POST" })
  .validator(eventSchema)
  .handler(async ({ data }) => {
    if (data.path.toLowerCase().startsWith("/admin")) return { ok: true };
    const device = data.device === "desktop" || data.device === "tablet" ? data.device : "mobile";
    const incoming = { ...data, device, attribution: data.attribution ?? {} } as AnalyticsEvent;
    const fromProps = cartFromProps(incoming.props);
    const visitor = visitorFromPing({
      sessionId: incoming.sessionId,
      path: incoming.path,
      title: incoming.title,
      device,
      attribution: incoming.attribution,
      lastEvent: incoming.name,
      lastTs: incoming.ts,
      startedAt: incoming.ts,
      cartItems: fromProps.cartItems,
      cartValue: fromProps.cartValue,
      email: textProp(incoming.props, "email"),
      name: textProp(incoming.props, "name"),
      phone: textProp(incoming.props, "phone"),
      city: textProp(incoming.props, "city"),
      state: textProp(incoming.props, "state"),
      shipping: textProp(incoming.props, "shipping"),
    });
    store.events = [...store.events.filter((event) => event.id !== incoming.id), incoming].slice(-MAX_EVENTS);
    store.presence.set(incoming.sessionId, visitor);
    if (incoming.name === "generate_pix" || incoming.name === "purchase") {
      const stub = orderFromEvent(incoming, visitor);
      if (stub) {
        upsertOrderLocal(stub);
        await persistTrafficShards({ order: stub });
      }
    }
    await persistTrafficShards({ event: incoming, visitor });
    await rememberLive({ visitor, event: incoming });
    persistSoon();
    return { ok: true };
  });

export const heartbeatVisitor = createServerFn({ method: "POST" })
  .validator(presenceSchema)
  .handler(async ({ data }) => {
    if (data.path.toLowerCase().startsWith("/admin")) return { ok: true };
    const visitor = visitorFromPing(data);
    store.presence.set(data.sessionId, visitor);
    await persistTrafficShards({ visitor });
    await rememberLive({ visitor });
    persistSoon();
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
  return { hasPin: true };
});

async function signInWithPin(pin: string) {
  await hydrate();
  const hash = await sha256(pin);
  const expected = await ensurePinHash();
  if (hash !== expected) throw new Error("Senha incorreta.");
  store.pinHash = expected;
  store.settings.hasPin = true;
  const token = pinTokenOf(expected);
  const session = { token, expiresAt: Date.now() + 1000 * 60 * 60 * 12 };
  store.sessions.push(session);
  await persistTrafficShards({ session });
  persistSoon();
  return { token };
}

export async function handleAdminLogin(request: Request) {
  try {
    const body = (await request.json()) as { pin?: unknown };
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (pin.length < 4 || pin.length > 32) {
      return Response.json({ error: "Senha incorreta." }, { status: 401 });
    }
    const result = await signInWithPin(pin);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senha incorreta.";
    return Response.json({ error: message }, { status: 401 });
  }
}

export const adminSetup = createServerFn({ method: "POST" })
  .validator(z.object({ pin: z.string().min(4).max(32) }))
  .handler(async ({ data }) => signInWithPin(data.pin));

export const adminLogin = createServerFn({ method: "POST" })
  .validator(z.object({ pin: z.string().min(4).max(32) }))
  .handler(async ({ data }) => signInWithPin(data.pin));

export const getAdminSnapshot = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), utmfyToken: z.string().optional() }))
  .handler(async ({ data }) => {
    await hydrate();
    await requireSession(data.token);
    if (data.utmfyToken) await rememberUtmfyToken(data.utmfyToken);
    await refreshPendingPix();
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
        payment: z
          .object({
            provider: z.enum(["magicpay", "wappi"]),
            wappiPublicKey: z.string(),
            wappiSecretKey: z.string(),
            wappiApiUrl: z.string(),
          })
          .optional(),
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
    const incomingPayment = normalizePayment(data.settings.payment ?? store.settings.payment);
    const keepWappiSecret =
      !incomingPayment.wappiSecretKey || incomingPayment.wappiSecretKey.includes("•")
        ? store.settings.payment?.wappiSecretKey || ""
        : incomingPayment.wappiSecretKey;
    const payment = preferFilledPayment(
      {
        ...incomingPayment,
        wappiSecretKey: keepWappiSecret,
        wappiPublicKey:
          incomingPayment.wappiPublicKey.trim() || store.settings.payment?.wappiPublicKey || "",
      },
      store.settings.payment,
    );
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
      payment,
      hasPin: Boolean(store.pinHash),
      settingsAt: Date.now(),
    };
    await rememberUtmfyToken(keepToken);
    await rememberPayment(payment);
    await persist();
    return maskSettings();
  });

export const changeAdminPin = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), current: z.string(), next: z.string().min(4).max(32) }))
  .handler(async ({ data }) => {
    await hydrate();
    await requireSession(data.token);
    throw new Error("A senha do painel é única e não pode ser trocada por aqui.");
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
    if (order.status === "paid" && !order.pixelsSent?.purchase) {
      await sendMetaCapi(order, "Purchase");
      await sendTikTokEvents(order, "Purchase");
      order.pixelsSent = { ...order.pixelsSent, purchase: true };
    } else if (order.status === "pending" && !order.pixelsSent?.addPaymentInfo) {
      await sendMetaCapi(order, "AddPaymentInfo");
      await sendTikTokEvents(order, "AddPaymentInfo");
      order.pixelsSent = { ...order.pixelsSent, addPaymentInfo: true };
    }
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

export const testTikTokConnection = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    await hydrate();
    await requireSession(data.token);
    const tiktok =
      tiktokCapiTargets(store.settings.pixels)[0] ??
      normalizePixels(store.settings.pixels).items.find((item) => item.kind === "tiktok");
    if (!tiktok?.pixelId) throw new Error("Cole o Pixel ID do TikTok.");
    if (!tiktok?.accessToken) throw new Error("Cole o token da Events API do TikTok.");
    const dummy: OrderSummary = {
      id: `TTTEST${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      data: {
        email: "teste@loja.local",
        name: "Teste TikTok",
        firstName: "Teste",
        lastName: "TikTok",
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
      items: [{ id: 1, qty: 1, title: "Teste TikTok Events", price: 1, photo: "" }],
      subtotal: 1,
      shipping: 0,
      discount: 0,
      total: 1,
      status: "pending",
    };
    await sendTikTokEvents(dummy, "InitiateCheckout");
    await persist();
    return store.tiktokLast;
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
