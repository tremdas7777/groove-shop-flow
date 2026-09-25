/** Reexporta o gateway de PIX (MagicPay / Wappi). Definição em magicpay.ts. */
export { createStorePix, getStorePix } from "@/lib/magicpay";
export { resolveWappiCredentials, type WappiCredentials } from "@/lib/wappi";
