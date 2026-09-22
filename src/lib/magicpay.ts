import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  const value = String(status ?? "").toLowerCase();
  if (["paid", "approved", "authorized", "complete", "completed"].includes(value)) {
    return "paid";
  }
  if (["refused", "rejected", "failed", "canceled", "cancelled"].includes(value)) {
    return "refused";
  }
  if (["refunded", "chargedback"].includes(value)) return "refunded";
  if (["pending", "waiting_payment", "waiting", "processing", "created"].includes(value)) {
    return "pending";
  }
  return value ? "unknown" : "pending";
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
  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
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
        metadata: JSON.stringify({ orderId: data.orderId }),
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
      return { ok: true as const, pix: parsePix(body) };
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
