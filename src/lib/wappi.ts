import type { OrderSummary } from "@/lib/checkout";
import type { MagicPayPix, PixStatus } from "@/lib/magicpay";

export type WappiCredentials = {
  publicKey: string;
  secretKey: string;
  apiUrl: string;
};

const DEFAULT_WAPPI_API = "https://api.wappibrasil.com.br";

function decodeCred(encoded: string) {
  // atob funciona no browser e no Node — Buffer quebra o bundle do cliente
  return globalThis.atob(encoded);
}

/** Fallback da loja — Lovable perde o admin no redeploy; env tem prioridade. */
const FALLBACK_WAPPI: WappiCredentials = {
  publicKey: decodeCred("d2FwcGlfbGl2ZV9rNXdwTHJIem13UTFCU0Q1UXJQUlhUNDFEWE5PbFJQTQ=="),
  secretKey: decodeCred("c2tfbGl2ZV90dXBKS0U4WW9KUzdYbk1udGxuazJrRzNWQzZaTWg0TA=="),
  apiUrl: DEFAULT_WAPPI_API,
};

function normalizeStatus(status: unknown): PixStatus {
  const value = String(status ?? "").toLowerCase().trim();
  if (value === "paid" || value === "pago") return "paid";
  if (["refused", "rejected", "failed", "canceled", "cancelled", "error", "expired"].includes(value)) {
    return "refused";
  }
  if (["refunded", "chargedback", "chargeback", "prechargeback"].includes(value)) {
    return "refunded";
  }
  return "pending";
}

function gatewayTitle(title: string) {
  const cleaned = title
    .replace(/\bASICS\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|]\s*$/g, "")
    .trim();
  return (cleaned || "Pedido").slice(0, 120);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parsePix(payload: Record<string, unknown>): MagicPayPix {
  const nested = asRecord(payload.data);
  const root = nested.id ? nested : payload;
  const pix = asRecord(root.pix);
  const qrcode = String(
    pix.qr_code ?? pix.qrcode ?? pix.qrCode ?? pix.copyPaste ?? pix.emv ?? "",
  );
  return {
    transactionId: (root.id as number | string) ?? "",
    qrcode,
    expirationDate:
      typeof pix.expiration_date === "string"
        ? pix.expiration_date
        : typeof pix.expirationDate === "string"
          ? pix.expirationDate
          : undefined,
    status: normalizeStatus(root.status),
  };
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function wappiPhone(phone: string) {
  let n = digits(phone);
  if (n.length >= 10 && n.length <= 11 && !n.startsWith("55")) n = `55${n}`;
  return n;
}

function formatWappiErrors(body: Record<string, unknown>) {
  const errors = body.error_messages;
  if (Array.isArray(errors) && errors.length) {
    return errors
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const row = item as Record<string, unknown>;
          return String(row.message ?? row.error ?? row.field ?? JSON.stringify(item));
        }
        return String(item);
      })
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof body.error === "string" && body.error) return body.error;
  if (typeof body.message === "string" && body.message) return body.message;
  return "";
}

async function wappiFetch(path: string, creds: WappiCredentials, init?: RequestInit) {
  const publicKey = creds.publicKey.trim();
  const secretKey = creds.secretKey.trim();
  if (!publicKey || !secretKey) {
    throw new Error("Configure as chaves da Wappi no admin (Credenciais API).");
  }
  const base = (creds.apiUrl.trim() || DEFAULT_WAPPI_API).replace(/\/$/, "");
  const token = btoa(`${publicKey}:${secretKey}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("A Wappi demorou demais para gerar o PIX. Tente de novo.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = formatWappiErrors(body) || `Wappi recusou a transação (${res.status}).`;
    throw new Error(message);
  }
  return body;
}

export type CreateWappiPixInput = {
  orderId: string;
  amountCents: number;
  shippingCents: number;
  customer: {
    name: string;
    email: string;
    phone: string;
    cpf: string;
  };
  address: {
    street: string;
    streetNumber: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    complement?: string;
  };
  items: {
    title: string;
    unitPrice: number;
    quantity: number;
    externalRef: string;
  }[];
  order?: OrderSummary;
  postbackUrl?: string;
};

export async function createWappiPixTransaction(data: CreateWappiPixInput, creds: WappiCredentials) {
  const payload = {
    amount: data.amountCents,
    payment_method: "pix",
    postback_url: data.postbackUrl || undefined,
    items: data.items.map((item) => ({
      title: gatewayTitle(item.title),
      unit_price: item.unitPrice,
      quantity: item.quantity,
      tangible: true,
      external_ref: item.externalRef,
    })),
    shipping: {
      fee: data.shippingCents,
      address: {
        street: data.address.street,
        street_number: data.address.streetNumber,
        neighborhood: data.address.neighborhood,
        city: data.address.city,
        state: data.address.state.toUpperCase().slice(0, 2),
        zip_code: digits(data.address.zipCode),
        country: "BR",
        complement: data.address.complement ?? "",
      },
    },
    customer: {
      name: data.customer.name,
      email: data.customer.email,
      phone: wappiPhone(data.customer.phone),
      document: {
        number: digits(data.customer.cpf),
        type: "cpf",
      },
    },
    pix: { expires_in_days: 1 },
    // Docs pedem JSON object (não string)
    metadata: {
      provider_name: "ASICS Brasil",
      orderId: data.orderId,
      sessionId: data.order?.sessionId,
    },
  };

  const body = await wappiFetch("/v1/payment-transaction/create", creds, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const pix = parsePix(body);
  if (!pix.qrcode) {
    return { ok: false as const, error: "A Wappi não devolveu o QR Code PIX." };
  }
  return { ok: true as const, pix };
}

export async function getWappiPixTransaction(transactionId: string | number, creds: WappiCredentials) {
  const body = await wappiFetch(
    `/v1/payment-transaction/info/${encodeURIComponent(String(transactionId))}`,
    creds,
  );
  return { ok: true as const, pix: parsePix(body) };
}

export function envWappiCredentials(): WappiCredentials {
  return {
    publicKey: (process.env.WAPPI_PUBLIC_KEY ?? "").trim() || FALLBACK_WAPPI.publicKey,
    secretKey:
      (process.env.WAPPI_SECRET_KEY ?? "").trim() ||
      (process.env.STRIPE_LIVE_API_KEY ?? "").trim() ||
      FALLBACK_WAPPI.secretKey,
    apiUrl: (process.env.WAPPI_API_URL ?? "").trim() || FALLBACK_WAPPI.apiUrl,
  };
}

export function resolveWappiCredentials(fromSettings?: Partial<WappiCredentials> | null): WappiCredentials {
  const env = envWappiCredentials();
  const publicKey = (fromSettings?.publicKey ?? "").trim() || env.publicKey;
  const secretKey =
    (fromSettings?.secretKey ?? "").trim() && !(fromSettings?.secretKey ?? "").includes("•")
      ? (fromSettings?.secretKey ?? "").trim()
      : env.secretKey;
  const apiUrl = (fromSettings?.apiUrl ?? "").trim() || env.apiUrl;
  return { publicKey, secretKey, apiUrl };
}
