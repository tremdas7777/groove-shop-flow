import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { OrderSummary } from "@/lib/checkout";
import { createMagicPayPix, getMagicPayPix, type MagicPayPix } from "@/lib/magicpay";
import {
  createWappiPixTransaction,
  envWappiCredentials,
  getWappiPixTransaction,
  type WappiCredentials,
} from "@/lib/wappi";

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
  order: z.custom<OrderSummary>().optional(),
});

async function resolveGateway() {
  const { getPaymentGatewayConfig } = await import("@/lib/admin-api");
  return getPaymentGatewayConfig();
}

function withGateway(pix: MagicPayPix, gateway: "magicpay" | "wappi") {
  return { ...pix, gateway };
}

export const createStorePix = createServerFn({ method: "POST" })
  .validator(createPixInput)
  .handler(async ({ data }) => {
    const config = await resolveGateway();
    const gateway = config.provider;

    if (gateway === "wappi") {
      try {
        const result = await createWappiPixTransaction(data, config.wappi);
        if (!result.ok) return result;
        if (data.order) {
          void import("@/lib/admin-api")
            .then(({ commitStoreOrder }) =>
              commitStoreOrder(
                {
                  ...data.order!,
                  gateway: "wappi",
                  pix: result.pix,
                  status: data.order?.status ?? "pending",
                },
                true,
              ),
            )
            .catch(() => undefined);
        }
        return { ok: true as const, pix: withGateway(result.pix, "wappi"), gateway: "wappi" as const };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Não foi possível gerar o PIX na Wappi.",
        };
      }
    }

    const result = await createMagicPayPix({ data });
    if (!result.ok) return result;
    return {
      ok: true as const,
      pix: withGateway(result.pix, "magicpay"),
      gateway: "magicpay" as const,
    };
  });

export const getStorePix = createServerFn({ method: "GET" })
  .validator(
    z.object({
      transactionId: z.union([z.string(), z.number()]),
      gateway: z.enum(["magicpay", "wappi"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const config = await resolveGateway();
    const gateway = data.gateway || config.provider;

    if (gateway === "wappi") {
      try {
        const result = await getWappiPixTransaction(data.transactionId, config.wappi);
        return { ok: true as const, pix: withGateway(result.pix, "wappi"), gateway: "wappi" as const };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Não foi possível consultar o PIX na Wappi.",
        };
      }
    }

    const result = await getMagicPayPix({ data: { transactionId: data.transactionId } });
    if (!result.ok) return result;
    return {
      ok: true as const,
      pix: withGateway(result.pix, "magicpay"),
      gateway: "magicpay" as const,
    };
  });

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
