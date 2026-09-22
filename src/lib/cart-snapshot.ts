import { getProduct, parsePrice } from "@/lib/products";

const STORAGE_KEY = "asics-shop-cart";

export interface StoredCartLine {
  id: number;
  size?: string;
  qty: number;
}

export interface CartSnapshotItem {
  id: number;
  title: string;
  size?: string;
  qty: number;
  price: number;
  photo?: string;
}

export function readStoredCart(): StoredCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredCartLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => Number.isFinite(item?.id) && item.qty > 0) : [];
  } catch {
    return [];
  }
}

export function describeCart(lines: StoredCartLine[] = readStoredCart()): {
  items: CartSnapshotItem[];
  value: number;
  qty: number;
  content_ids: string[];
} {
  const items = lines
    .map((line) => {
      const product = getProduct(line.id);
      if (!product) return null;
      return {
        id: line.id,
        title: product.titulo,
        size: line.size,
        qty: line.qty,
        price: parsePrice(product.preco),
        photo: product.fotos[0],
      } satisfies CartSnapshotItem;
    })
    .filter((item): item is CartSnapshotItem => Boolean(item));
  return {
    items,
    value: items.reduce((acc, item) => acc + item.price * item.qty, 0),
    qty: items.reduce((acc, item) => acc + item.qty, 0),
    content_ids: items.map((item) => String(item.id)),
  };
}

export function cartTrackingProps(lines?: StoredCartLine[]) {
  const cart = describeCart(lines ?? readStoredCart());
  if (cart.items.length === 0) return {};
  return {
    value: cart.value,
    content_ids: cart.content_ids,
    cart_items: cart.items,
    cart_qty: cart.qty,
  };
}
