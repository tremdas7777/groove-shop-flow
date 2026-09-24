import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  emptyCheckout,
  splitCustomerName,
  type OrderSummary,
  type ShippingMethodId,
} from "@/lib/checkout";
import { compactAttribution, type Attribution } from "@/lib/tracking";

export type PixStatus = "pending" | "paid" | "refused" | "refunded" | "unknown";

export interface MagicPayPix {
  transactionId: number | string;
  qrcode: string;
  expirationDate?: string;
  status: PixStatus;
}

const createPixInput = z.object({
  orderId: z.string(),
  amountCents: z.number().int().positive(),
  shippingCents: z.number().int().nonnegative(),
  customer: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(10),
    cpf: z.string().min(11),
  }),
  address: z.object({
    street: z.string().min(2),
    streetNumber: z.string().min(1),
    neighborhood: z.string().min(2),
    city: z.string().min(2),
    state: z.string().min(2),
    zipCode: z.string().min(8),
    complement: z.string().optional(),
  }),
  items: z.array(
    z.object({
      title: z.string(),
      unitPrice: z.number().int().nonnegative(),
      quantity: z.number().int().positive(),
      externalRef: z.string(),
    }),
  ),
  order: z.custom<import("@/lib/checkout").OrderSummary>().optional(),
});

function authHeader() {
  const publicKey = (process.env.MAGICPAY_PUBLIC_KEY ?? "").trim();
  const secretKey = (process.env.MAGICPAY_SECRET_KEY ?? "").trim();
  if (!publicKey || !secretKey) return null;
  const token = btoa(`${publicKey}:${secretKey}`);
  return `Basic ${token}`;
}

function apiUrl() {
  return (process.env.MAGICPAY_API_URL ?? "").trim() || "https://api.dashboardmagicpay.com";
}

function normalizeStatus(status: unknown): PixStatus {
  const value = String(status ?? "").toLowerCase().trim();
  if (value === "paid" || value === "pago") return "paid";
  if (["refused", "rejected", "failed", "canceled", "cancelled"].includes(value)) {
    return "refused";
  }
  if (["refunded", "chargedback"].includes(value)) return "refunded";
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

function parsePix(payload: Record<string, unknown>): MagicPayPix {
  const pix = (payload.pix ?? {}) as Record<string, unknown>;
  const qrcode = String(
    pix.qrcode ?? pix.qrCode ?? pix.copyPaste ?? pix.emv ?? "",
  );
  return {
    transactionId: (payload.id as number | string) ?? "",
    qrcode,
    expirationDate:
      typeof pix.expirationDate === "string" ? pix.expirationDate : undefined,
    status: normalizeStatus(payload.status),
  };
}

async function magicPayFetch(path: string, init?: RequestInit) {
  const authorization = authHeader();
  if (!authorization) {
    throw new Error(
      "Configure MAGICPAY_PUBLIC_KEY e MAGICPAY_SECRET_KEY no ambiente.",
    );
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("A MagicPay demorou demais para gerar o PIX. Tente de novo.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      `MagicPay recusou a transação (${res.status}).`;
    throw new Error(message);
  }
  return body;
}

export const createMagicPayPix = createServerFn({ method: "POST" })
  .validator(createPixInput)
  .handler(async ({ data }) => {
    try {
      const payload = {
        amount: data.amountCents,
        paymentMethod: "pix",
        pix: { expiresInDays: 1 },
        items: data.items.map((item) => ({
          title: gatewayTitle(item.title),
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          tangible: true,
          externalRef: item.externalRef,
        })),
        shipping: {
          fee: data.shippingCents,
          address: {
            street: data.address.street,
            streetNumber: data.address.streetNumber,
            neighborhood: data.address.neighborhood,
            city: data.address.city,
            state: data.address.state.toUpperCase().slice(0, 2),
            zipCode: data.address.zipCode.replace(/\D/g, ""),
            country: "BR",
            complement: data.address.complement ?? "",
          },
        },
        customer: {
          name: data.customer.name,
          email: data.customer.email,
          phone: data.customer.phone.replace(/\D/g, ""),
          document: {
            number: data.customer.cpf.replace(/\D/g, ""),
            type: "cpf",
          },
        },
        externalRef: data.orderId,
        metadata: JSON.stringify({
          orderId: data.orderId,
          sessionId: data.order?.sessionId,
          attribution: compactAttribution(data.order?.attribution),
        }),
      };

      const body = await magicPayFetch("/v1/transactions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const pix = parsePix(body);
      if (!pix.qrcode) {
        return {
          ok: false as const,
          error: "A MagicPay não devolveu o QR Code PIX.",
        };
      }
      if (data.order) {
        void import("@/lib/admin-api")
          .then(({ commitStoreOrder }) =>
            commitStoreOrder(
              { ...data.order!, pix, status: data.order?.status ?? "pending", gateway: "magicpay" },
              true,
            ),
          )
          .catch(() => undefined);
      }
      return { ok: true as const, pix };
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível gerar o PIX.",
      };
    }
  });

export const getMagicPayPix = createServerFn({ method: "GET" })
  .validator(z.object({ transactionId: z.union([z.string(), z.number()]) }))
  .handler(async ({ data }) => {
    try {
      const body = await magicPayFetch(
        `/v1/transactions/${encodeURIComponent(String(data.transactionId))}`,
      );
      const pix = parsePix(body);
      if (pix.status === "paid") {
        try {
          const { commitStoreOrder } = await import("@/lib/admin-api");
          const fromGateway = orderFromMagicPayTx(body);
          if (fromGateway) {
            await commitStoreOrder({ ...fromGateway, pix, status: "paid" }, true);
          }
        } catch {
          // o /pedido ainda tenta gravar o pagamento
        }
      }
      return { ok: true as const, pix };
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o PIX.",
      };
    }
  });

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return {};
}

function storeOrderRef(tx: Record<string, unknown>) {
  const meta = parseMetadata(tx.metadata);
  return String(tx.externalRef ?? meta.orderId ?? "").trim();
}

function isStoreTransaction(tx: Record<string, unknown>) {
  return /^PD/i.test(storeOrderRef(tx));
}

function guessShipping(cents: number): ShippingMethodId {
  if (cents >= 3490) return "expresso";
  if (cents >= 1990) return "padrao";
  return "gratis";
}

function orderStatusFromPix(status: PixStatus): NonNullable<OrderSummary["status"]> {
  if (status === "paid") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "refused") return "refused";
  return "pending";
}

export async function getMagicPayTransaction(transactionId: string | number) {
  return magicPayFetch(`/v1/transactions/${encodeURIComponent(String(transactionId))}`);
}

export async function listMagicPayTransactions() {
  const rows: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 8) {
    const body = await magicPayFetch(`/v1/transactions?page=${page}`);
    const data = Array.isArray(body.data) ? body.data : [];
    for (const row of data) {
      if (row && typeof row === "object") rows.push(row as Record<string, unknown>);
    }
    const pagination = asRecord(body.pagination);
    totalPages = Math.max(1, Number(pagination.totalPages) || 1);
    page += 1;
  }
  return rows;
}

function attributionFromTx(tx: Record<string, unknown>): Attribution {
  const meta = parseMetadata(tx.metadata);
  const raw = meta.attribution && typeof meta.attribution === "object" ? (meta.attribution as Attribution) : {};
  return compactAttribution(raw);
}

function sessionFromTx(tx: Record<string, unknown>, fallback: string) {
  const meta = parseMetadata(tx.metadata);
  const sessionId = String(meta.sessionId ?? "").trim();
  return sessionId || fallback;
}

export function orderFromMagicPayTx(tx: Record<string, unknown>): OrderSummary | null {
  if (!isStoreTransaction(tx)) return null;
  const ref = storeOrderRef(tx);
  const customer = asRecord(tx.customer);
  const address = asRecord(customer.address);
  const document = asRecord(customer.document);
  const pix = asRecord(tx.pix);
  const name = String(customer.name ?? "").trim();
  const parts = splitCustomerName(name);
  const items = (Array.isArray(tx.items) ? tx.items : [])
    .map((entry) => {
      const item = asRecord(entry);
      const unit = Number(item.unitPrice ?? item.price ?? 0);
      const qty = Math.max(1, Number(item.quantity) || 1);
      const rawId = Number(item.externalRef);
      return {
        id: Number.isFinite(rawId) ? rawId : 0,
        title: String(item.title ?? "Produto"),
        qty,
        price: unit / 100,
        photo: "",
      };
    })
    .filter((item) => item.title);
  const total = Number(tx.amount ?? 0) / 100;
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shipping = Math.max(0, Number((Number(tx.amount ?? 0) - Math.round(subtotal * 100)).toFixed(0)));
  const status = orderStatusFromPix(normalizeStatus(tx.status));
  const createdAt = String(tx.createdAt ?? tx.paidAt ?? new Date().toISOString());
  return {
    id: ref || `MP${tx.id ?? Date.now()}`,
    createdAt,
    data: {
      ...emptyCheckout,
      email: String(customer.email ?? ""),
      name,
      firstName: parts.firstName,
      lastName: parts.lastName,
      cpf: String(document.number ?? "").replace(/\D/g, ""),
      phone: String(customer.phone ?? "").replace(/\D/g, ""),
      cep: String(address.zipCode ?? "").replace(/\D/g, ""),
      street: String(address.street ?? ""),
      number: String(address.streetNumber ?? ""),
      complement: String(address.complement ?? ""),
      neighborhood: String(address.neighborhood ?? ""),
      city: String(address.city ?? ""),
      state: String(address.state ?? "").toUpperCase().slice(0, 2),
      shippingMethod: guessShipping(shipping),
      payment: "pix",
    },
    items,
    subtotal,
    shipping: shipping / 100,
    discount: 0,
    total,
    pix: {
      transactionId: (tx.id as number | string) ?? "",
      qrcode: String(pix.qrcode ?? ""),
      expirationDate: typeof pix.expirationDate === "string" ? pix.expirationDate : undefined,
      status,
    },
    status,
    sessionId: sessionFromTx(tx, `mp_${tx.id ?? ref}`),
    attribution: attributionFromTx(tx),
  };
}
