/** Cliente HTTP da Loja API v1 (somente servidor). Nunca importe no browser. */

const ZEDY_API_BASE = "https://app.zedy.com.br/api/loja/v1";

export type ZedyVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: number;
  compareAtPrice: number | null;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  selectedOptions: { name: string; value: string }[];
};

export type ZedyProduct = {
  id: string;
  handle: string;
  title: string;
  description?: string;
  status?: string;
  price: number;
  compareAtPrice: number | null;
  images?: { url: string; altText?: string; position?: number }[];
  variants: ZedyVariant[];
};

export type ZedyCredentials = {
  token: string;
  storeId: string;
};

export function readZedyCredentials(): ZedyCredentials | null {
  const token = (process.env.ZEDY_API_TOKEN ?? "").trim();
  const storeId = (process.env.ZEDY_STORE_ID ?? "").trim();
  if (!token || !storeId) return null;
  return { token, storeId };
}

export function readZedyWebhookToken(): string {
  return (process.env.ZEDY_WEBHOOK_TOKEN ?? "").trim();
}

function authHeaders(creds: ZedyCredentials): HeadersInit {
  return {
    Authorization: `Bearer ${creds.token}`,
    "X-Store-Id": creds.storeId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function zedyFetch(path: string, creds: ZedyCredentials, init?: RequestInit) {
  const res = await fetch(`${ZEDY_API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(creds),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : `Zedy HTTP ${res.status}`;
    const err = new Error(message);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json;
}

export async function listAllZedyProducts(creds: ZedyCredentials): Promise<ZedyProduct[]> {
  const products: ZedyProduct[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 40) {
    const data = (await zedyFetch(
      `/products?page=${page}&per_page=50&sort_by=title&sort_order=asc`,
      creds,
    )) as {
      products?: ZedyProduct[];
      pagination?: { totalPages?: number };
    };
    products.push(...(data.products ?? []));
    totalPages = Math.max(1, Number(data.pagination?.totalPages) || 1);
    page += 1;
  }
  return products;
}

export async function createZedyCheckout(
  creds: ZedyCredentials,
  items: { variantId: number | string; quantity: number }[],
): Promise<{
  active: boolean;
  skip_cart?: boolean;
  checkoutUrl: string | null;
  checkout_direct_url: string | null;
  message?: string;
}> {
  const data = (await zedyFetch("/cart/create-checkout", creds, {
    method: "POST",
    body: JSON.stringify({ items }),
  })) as {
    active?: boolean;
    skip_cart?: boolean;
    checkoutUrl?: string | null;
    checkout_direct_url?: string | null;
    message?: string;
  };
  return {
    active: Boolean(data.active ?? true),
    skip_cart: data.skip_cart,
    checkoutUrl: data.checkoutUrl ?? null,
    checkout_direct_url: data.checkout_direct_url ?? null,
    message: data.message,
  };
}
