import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getProduct, getSizes, products as storeProducts } from "@/lib/products";
import {
  createZedyCheckout,
  listAllZedyProducts,
  readZedyCredentials,
  readZedyWebhookToken,
  type ZedyProduct,
  type ZedyVariant,
} from "@/lib/zedy-client";

const ZEDY_CATALOG_CACHE_MS = 5 * 60_000;
const ZEDY_ORDERS_KEY = "asicsZedyOrd9k2m";
const ZEDY_ORDERS_SET = `https://setget.net/set/${ZEDY_ORDERS_KEY}`;
const ZEDY_ORDERS_GET = `https://setget.net/get/${ZEDY_ORDERS_KEY}`;
const MAX_WEBHOOK_ORDERS = 200;
const MAX_CHECKOUT_LINES = 40;

type CatalogCache = {
  at: number;
  products: ZedyProduct[];
};

let catalogCache: CatalogCache | null = null;

export type CartLineInput = {
  id: number;
  size?: string;
  qty: number;
};

export type ZedyMatch = {
  productId: number;
  productTitle: string;
  size?: string;
  qty: number;
  skuHint: string;
  variantId: string | null;
  zedyProductId: string | null;
  zedyTitle: string | null;
  matchedBy: "sku" | "title+size" | "title" | null;
  error?: string;
};

export type ZedyWebhookOrder = {
  orderId: string;
  eventType: string;
  status: string;
  paymentMethod?: string;
  createdAt: string;
  receivedAt: string;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    document?: string;
  };
  products?: {
    id?: number | string;
    name?: string;
    quantity?: number;
    priceInCents?: number;
    image?: string;
  }[];
  commission?: {
    totalPriceInCents?: number;
    gatewayFeeInCents?: number;
    userCommissionInCents?: number;
  };
  abandonouNa?: string;
  pixQrCode?: string;
  trackingParameters?: Record<string, string | number | boolean | null>;
  rawEventKey: string;
};

type WebhookStore = {
  orders: ZedyWebhookOrder[];
  processed: string[];
};

const memory: { webhook: WebhookStore } = {
  webhook: { orders: [], processed: [] },
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unwrapSetget(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const root = payload as Record<string, unknown>;
  const raw = "value" in root ? root.value : payload;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

async function loadWebhookStore(): Promise<WebhookStore> {
  try {
    const res = await fetch(`${ZEDY_ORDERS_GET}?t=${Date.now()}`, {
      headers: { Accept: "application/json", "Cache-Control": "no-store" },
      cache: "no-store",
    });
    if (!res.ok) return memory.webhook;
    const data = unwrapSetget(await res.json()) as WebhookStore | null;
    if (!data || !Array.isArray(data.orders)) return memory.webhook;
    memory.webhook = {
      orders: data.orders.slice(0, MAX_WEBHOOK_ORDERS),
      processed: Array.isArray(data.processed) ? data.processed.slice(0, 2000) : [],
    };
  } catch {
    // usa memória
  }
  return memory.webhook;
}

async function saveWebhookStore(store: WebhookStore) {
  memory.webhook = store;
  const body = JSON.stringify({
    orders: store.orders.slice(0, MAX_WEBHOOK_ORDERS),
    processed: store.processed.slice(0, 2000),
    writtenAt: Date.now(),
  });
  try {
    await Promise.race([
      fetch(ZEDY_ORDERS_SET, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // remoto opcional
  }
}

export async function getZedyCatalog(force = false): Promise<ZedyProduct[]> {
  const creds = readZedyCredentials();
  if (!creds) return [];
  if (!force && catalogCache && Date.now() - catalogCache.at < ZEDY_CATALOG_CACHE_MS) {
    return catalogCache.products;
  }
  const products = await listAllZedyProducts(creds);
  catalogCache = { at: Date.now(), products };
  return products;
}

function variantSize(variant: ZedyVariant): string {
  const fromOption =
    variant.selectedOptions?.find((opt) => /tamanho|size/i.test(opt.name))?.value ?? "";
  return String(fromOption || variant.title || "").trim();
}

function findVariantForLine(
  catalog: ZedyProduct[],
  productId: number,
  title: string,
  size?: string,
  skuBase?: string,
): { variant: ZedyVariant; product: ZedyProduct; matchedBy: ZedyMatch["matchedBy"] } | null {
  const sizeNorm = normalizeName(size ?? "");
  const skuCandidates = [
    size ? `${productId}-${size}` : "",
    size && skuBase ? `${skuBase}-${size}` : "",
    skuBase ?? "",
    String(productId),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  for (const product of catalog) {
    for (const variant of product.variants ?? []) {
      const sku = (variant.sku ?? "").trim();
      if (sku && skuCandidates.some((c) => normalizeName(c) === normalizeName(sku))) {
        return { variant, product, matchedBy: "sku" };
      }
    }
  }

  const titleNorm = normalizeName(title);
  const byTitle = catalog.filter((p) => {
    const n = normalizeName(p.title);
    return n === titleNorm || n.includes(titleNorm) || titleNorm.includes(n);
  });

  for (const product of byTitle) {
    if (sizeNorm) {
      const variant = (product.variants ?? []).find((v) => normalizeName(variantSize(v)) === sizeNorm);
      if (variant) return { variant, product, matchedBy: "title+size" };
    }
    const only = product.variants?.length === 1 ? product.variants[0] : null;
    if (only && !sizeNorm) return { variant: only, product, matchedBy: "title" };
  }

  return null;
}

export async function mapCartToZedy(lines: CartLineInput[]): Promise<{
  matches: ZedyMatch[];
  checkoutItems: { variantId: number; quantity: number }[];
  missing: ZedyMatch[];
}> {
  const catalog = await getZedyCatalog();
  const matches: ZedyMatch[] = [];
  const checkoutItems: { variantId: number; quantity: number }[] = [];

  for (const line of lines.slice(0, MAX_CHECKOUT_LINES)) {
    const product = getProduct(line.id);
    const qty = Math.min(99, Math.max(1, Math.floor(Number(line.qty) || 0)));
    const base: ZedyMatch = {
      productId: line.id,
      productTitle: product?.titulo ?? `Produto ${line.id}`,
      size: line.size,
      qty,
      skuHint: line.size ? `${line.id}-${line.size}` : String(line.id),
      variantId: null,
      zedyProductId: null,
      zedyTitle: null,
      matchedBy: null,
    };
    if (!product) {
      matches.push({ ...base, error: "Produto local não encontrado." });
      continue;
    }
    if (!qty) {
      matches.push({ ...base, error: "Quantidade inválida." });
      continue;
    }
    const sizes = getSizes(product);
    if (sizes.length && !line.size) {
      matches.push({ ...base, error: "Selecione o tamanho." });
      continue;
    }
    const hit = findVariantForLine(catalog, product.id, product.titulo, line.size, String(product.id));
    if (!hit) {
      matches.push({
        ...base,
        error: catalog.length
          ? "Variação não encontrada no catálogo Zedy."
          : "Catálogo Zedy vazio ou secrets não configurados.",
      });
      continue;
    }
    const variantIdNum = Number(hit.variant.id);
    matches.push({
      ...base,
      variantId: String(hit.variant.id),
      zedyProductId: hit.product.id,
      zedyTitle: hit.product.title,
      matchedBy: hit.matchedBy,
    });
    if (Number.isFinite(variantIdNum)) {
      checkoutItems.push({ variantId: variantIdNum, quantity: qty });
    } else {
      matches[matches.length - 1].error = "variantId inválido na Zedy.";
    }
  }

  return {
    matches,
    checkoutItems,
    missing: matches.filter((m) => !m.variantId || m.error),
  };
}

export async function buildCatalogStatus() {
  const creds = readZedyCredentials();
  let catalog: ZedyProduct[] = [];
  let catalogError = "";
  if (!creds) {
    catalogError = "Configure ZEDY_API_TOKEN e ZEDY_STORE_ID.";
  } else {
    try {
      catalog = await getZedyCatalog(true);
    } catch (error) {
      catalogError = error instanceof Error ? error.message : "Falha ao listar catálogo Zedy.";
    }
  }

  const mapped = storeProducts.map((product) => {
    const sizes = getSizes(product);
    const variants = (sizes.length ? sizes : [""]).map((size) => {
      const hit = catalog.length
        ? findVariantForLine(catalog, product.id, product.titulo, size || undefined, String(product.id))
        : null;
      return {
        size: size || "Único",
        skuHint: size ? `${product.id}-${size}` : String(product.id),
        variantId: hit ? String(hit.variant.id) : null,
        matchedBy: hit?.matchedBy ?? null,
        zedyTitle: hit?.product.title ?? null,
        ok: Boolean(hit),
      };
    });
    return {
      productId: product.id,
      title: product.titulo,
      ok: variants.every((v) => v.ok),
      variants,
    };
  });

  return {
    configured: Boolean(creds),
    catalogCount: catalog.length,
    catalogError,
    mapped,
    unmatched: mapped.filter((p) => !p.ok),
    webhookTokenConfigured: Boolean(readZedyWebhookToken()),
  };
}

const checkoutInput = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        size: z.string().optional(),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(MAX_CHECKOUT_LINES),
});

export async function runZedyStoreCheckout(items: z.infer<typeof checkoutInput>["items"]) {
  const localMissing = items
    .map((line) => {
      const product = getProduct(line.id);
      if (product) return null;
      return {
        productId: line.id,
        title: `Produto ${line.id}`,
        size: line.size,
        error: "Produto local não encontrado.",
      };
    })
    .filter(Boolean) as {
    productId: number;
    title: string;
    size?: string;
    error: string;
  }[];
  if (localMissing.length) {
    return {
      ok: false as const,
      error: "Alguns itens não estão cadastrados na loja.",
      missing: localMissing,
    };
  }

  const creds = readZedyCredentials();
  if (!creds) {
    return {
      ok: false as const,
      error: "Zedy não configurada. Cadastre ZEDY_API_TOKEN e ZEDY_STORE_ID.",
    };
  }
  try {
    const mapped = await mapCartToZedy(items);
    if (mapped.missing.length) {
      return {
        ok: false as const,
        error: "Alguns itens não estão cadastrados na Zedy.",
        missing: mapped.missing.map((m) => ({
          productId: m.productId,
          title: m.productTitle,
          size: m.size,
          error: m.error,
        })),
      };
    }
    if (!mapped.checkoutItems.length) {
      return { ok: false as const, error: "Carrinho sem itens válidos." };
    }
    const checkout = await createZedyCheckout(creds, mapped.checkoutItems);
    const url = checkout.checkout_direct_url || checkout.checkoutUrl;
    if (!url) {
      return {
        ok: false as const,
        error: checkout.message || "A Zedy não retornou URL de checkout.",
      };
    }
    return {
      ok: true as const,
      checkoutUrl: url,
      matches: mapped.matches,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Falha ao criar checkout na Zedy.",
    };
  }
}

export const createZedyStoreCheckout = createServerFn({ method: "POST" })
  .validator(checkoutInput)
  .handler(async ({ data }) => runZedyStoreCheckout(data.items));

export const getZedyCatalogStatus = createServerFn({ method: "GET" }).handler(async () =>
  buildCatalogStatus(),
);

export const listZedyWebhookOrders = createServerFn({ method: "GET" }).handler(async () => {
  const store = await loadWebhookStore();
  return {
    orders: store.orders.slice(0, 100),
    abandoned: store.orders.filter((o) =>
      ["CART_ABANDONED", "PIX_CREATED", "BILLET_CREATED"].includes(o.eventType),
    ),
  };
});

function mapWebhookStatus(eventType: string, status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "paid" || eventType === "ORDER_PAID") return "paid";
  if (s === "refused" || eventType === "ORDER_REFUSED") return "refused";
  if (s === "refunded") return "refunded";
  if (eventType === "CART_ABANDONED") return "abandoned";
  return s || "waiting_payment";
}

function sanitizeTracking(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      out[key] = raw;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export async function handleZedyWebhook(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
      },
    });
  }
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method" }, { status: 405 });
  }

  const expected = readZedyWebhookToken();
  if (!expected) {
    return Response.json({ ok: false, error: "webhook_not_configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const orderId = String(body.orderId ?? "").trim();
  const eventType = String(body.eventType ?? "").trim();
  if (!orderId || !eventType) {
    return Response.json({ ok: false, error: "missing_fields" }, { status: 422 });
  }

  const eventKey = `${orderId}::${eventType}`;
  const store = await loadWebhookStore();
  if (store.processed.includes(eventKey)) {
    return Response.json({ ok: true, deduped: true });
  }

  const customer = (body.customer ?? {}) as Record<string, unknown>;
  const products = Array.isArray(body.products) ? body.products : [];
  const entry: ZedyWebhookOrder = {
    orderId,
    eventType,
    status: mapWebhookStatus(eventType, String(body.status ?? "")),
    paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : undefined,
    createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    customer: {
      name: typeof customer.name === "string" ? customer.name : undefined,
      email: typeof customer.email === "string" ? customer.email : undefined,
      phone: typeof customer.phone === "string" ? customer.phone : undefined,
      document: typeof customer.document === "string" ? customer.document : undefined,
    },
    products: products.map((p) => {
      const row = (p ?? {}) as Record<string, unknown>;
      return {
        id: row.id as number | string | undefined,
        name: typeof row.name === "string" ? row.name : undefined,
        quantity: typeof row.quantity === "number" ? row.quantity : undefined,
        priceInCents: typeof row.priceInCents === "number" ? row.priceInCents : undefined,
        image: typeof row.image === "string" ? row.image : undefined,
      };
    }),
    commission: (body.commission ?? undefined) as ZedyWebhookOrder["commission"],
    abandonouNa: typeof body.abandonouNa === "string" ? body.abandonouNa : undefined,
    pixQrCode: typeof body.pixQrCode === "string" ? body.pixQrCode : undefined,
    trackingParameters: sanitizeTracking(body.trackingParameters),
    rawEventKey: eventKey,
  };

  try {
    const without = store.orders.filter((o) => o.orderId !== orderId || o.eventType !== eventType);
    const next: WebhookStore = {
      orders: [entry, ...without].slice(0, MAX_WEBHOOK_ORDERS),
      processed: [eventKey, ...store.processed.filter((k) => k !== eventKey)].slice(0, 2000),
    };
    await saveWebhookStore(next);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "persist_failed" }, { status: 500 });
  }
}

export async function handleZedyCreateCheckoutHttp(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }
  try {
    const json = (await request.json()) as unknown;
    const parsed = checkoutInput.safeParse(json);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "Carrinho inválido." }, { status: 400 });
    }
    const result = await runZedyStoreCheckout(parsed.data.items);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "fail" },
      { status: 500 },
    );
  }
}
