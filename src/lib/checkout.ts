import { compactAttribution, getAttribution, getSessionId, type Attribution } from "@/lib/tracking";

export type PaymentMethod = "pix" | "card" | "boleto";
export type ShippingMethodId = "gratis" | "padrao" | "expresso";

export const shippingMethods = [
  {
    id: "gratis" as const,
    label: "Frete grátis",
    eta: "8 a 12 dias úteis",
    price: 0,
  },
  {
    id: "padrao" as const,
    label: "Frete padrão",
    eta: "5 a 8 dias úteis",
    price: 19.9,
  },
  {
    id: "expresso" as const,
    label: "Frete expresso",
    eta: "2 a 4 dias úteis",
    price: 34.9,
  },
];

export function getShippingMethod(id?: string) {
  return shippingMethods.find((method) => method.id === id) ?? shippingMethods[0];
}

export interface CheckoutData {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  cpf: string;
  phone: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  shippingMethod: ShippingMethodId;
  payment: PaymentMethod;
  cardNumber: string;
  cardName: string;
  cardExpiry: string;
  cardCvv: string;
  coupon: string;
  newsletter: boolean;
}

export const emptyCheckout: CheckoutData = {
  email: "",
  name: "",
  firstName: "",
  lastName: "",
  cpf: "",
  phone: "",
  cep: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  shippingMethod: "gratis",
  payment: "pix",
  cardNumber: "",
  cardName: "",
  cardExpiry: "",
  cardCvv: "",
  coupon: "",
  newsletter: true,
};

export interface OrderPix {
  transactionId: number | string;
  qrcode: string;
  expirationDate?: string;
  status: "pending" | "paid" | "refused" | "refunded" | "unknown";
}

export interface OrderSummary {
  id: string;
  createdAt: string;
  data: CheckoutData;
  items: { id: number; size?: string; qty: number; title: string; price: number; photo: string }[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  pix?: OrderPix;
  status?: "pending" | "paid" | "refused" | "refunded";
  attribution?: Attribution;
  sessionId?: string;
  notes?: string;
  parentOrderId?: string;
  upsell?: boolean;
  purchaseTracked?: boolean;
  gateway?: "magicpay" | "wappi";
  pixelsSent?: {
    addPaymentInfo?: boolean;
    purchase?: boolean;
  };
  utmfySent?: {
    waiting_payment?: boolean;
    paid?: boolean;
    refused?: boolean;
    refunded?: boolean;
    createdAt?: string;
    tracked?: boolean;
  };
}

const CHECKOUT_KEY = "asics-checkout-draft";
const ORDER_KEY = "asics-last-order";
const ORDERS_KEY = "asics-orders-ledger";

export function splitCustomerName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export function customerName(data: {
  name?: string;
  firstName?: string;
  lastName?: string;
}) {
  return (data.name || `${data.firstName ?? ""} ${data.lastName ?? ""}`)
    .replace(/\s+/g, " ")
    .trim();
}

export function customerFirstName(data: {
  name?: string;
  firstName?: string;
  lastName?: string;
}) {
  return splitCustomerName(customerName(data)).firstName;
}

export function customerLastName(data: {
  name?: string;
  firstName?: string;
  lastName?: string;
}) {
  return splitCustomerName(customerName(data)).lastName;
}

export function loadCheckoutDraft(): CheckoutData {
  try {
    const raw = window.localStorage.getItem(CHECKOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CheckoutData;
      const name = customerName(parsed);
      const parts = splitCustomerName(name);
      return {
        ...emptyCheckout,
        ...parsed,
        name,
        firstName: parts.firstName,
        lastName: parts.lastName,
        payment: "pix",
      };
    }
  } catch {
    // ignore
  }
  return emptyCheckout;
}

export function saveCheckoutDraft(data: CheckoutData) {
  try {
    window.localStorage.setItem(CHECKOUT_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadOrders(): OrderSummary[] {
  try {
    const raw = window.localStorage.getItem(ORDERS_KEY);
    return raw ? (JSON.parse(raw) as OrderSummary[]) : [];
  } catch {
    return [];
  }
}

function writeOrders(orders: OrderSummary[]) {
  try {
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 500)));
  } catch {
    // ignore
  }
}

export async function persistOrder(order: OrderSummary, notify = true) {
  const next: OrderSummary = {
    ...order,
    attribution: compactAttribution({
      ...(typeof window === "undefined" ? {} : getAttribution()),
      ...order.attribution,
    }),
    sessionId: order.sessionId ?? (typeof window === "undefined" ? undefined : getSessionId()),
    status: order.status ?? (order.pix?.status === "paid" ? "paid" : "pending"),
  };
  saveOrder(next);
  void (async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const { upsertStoreOrder } = await import("@/lib/admin-api");
        await upsertStoreOrder({ data: { order: next, notify } });
        return;
      } catch {
        if (attempt < 5) await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  })();
  return next;
}

export function saveOrder(order: OrderSummary) {
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
  const orders = loadOrders().filter((item) => item.id !== order.id);
  writeOrders([order, ...orders]);
}

export function updateOrderPix(pix: OrderPix) {
  const order = loadOrder();
  if (!order) return null;
  const paid = pix.status === "paid";
  const next: OrderSummary = {
    ...order,
    pix: { ...order.pix, ...pix },
    status: paid ? "paid" : order.status ?? (pix.status === "unknown" ? "pending" : pix.status),
  };
  const sameStatus = (order.pix?.status ?? order.status ?? "pending") === (paid ? "paid" : pix.status);
  if (!paid && sameStatus && String(order.pix?.transactionId ?? "") === String(pix.transactionId ?? "")) {
    return next;
  }
  void persistOrder(next);
  return next;
}

export function loadOrder(): OrderSummary | null {
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (raw) return JSON.parse(raw) as OrderSummary;
  } catch {
    // ignore
  }
  return null;
}

export function maskCpf(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function maskPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export function maskCep(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.replace(/(\d{5})(\d)/, "$1-$2");
}

export function maskCard(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 16);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function maskExpiry(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 4);
  return d.replace(/(\d{2})(\d)/, "$1/$2");
}

export interface ViaCepResult {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}

export async function fetchCep(cep: string): Promise<ViaCepResult | null> {
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return null;
  const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
  if (!res.ok) return null;
  const data = (await res.json()) as ViaCepResult;
  if (data.erro) return null;
  return data;
}
