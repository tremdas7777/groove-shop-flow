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
}

const CHECKOUT_KEY = "asics-checkout-draft";
const ORDER_KEY = "asics-last-order";

export function loadCheckoutDraft(): CheckoutData {
  try {
    const raw = window.localStorage.getItem(CHECKOUT_KEY);
    if (raw) return { ...emptyCheckout, ...(JSON.parse(raw) as CheckoutData) };
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

export function saveOrder(order: OrderSummary) {
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
}

export function updateOrderPix(pix: OrderPix) {
  const order = loadOrder();
  if (!order) return null;
  const next = { ...order, pix: { ...order.pix, ...pix } };
  saveOrder(next);
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
