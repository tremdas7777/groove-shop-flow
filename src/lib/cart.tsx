import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CartItem {
  id: number;
  size?: string;
  qty: number;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (id: number, qty?: number, size?: string) => void;
  remove: (id: number, size?: string) => void;
  setQty: (id: number, qty: number, size?: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "asics-shop-cart";
const OPEN_KEY = "asics-shop-cart-open";

function sameLine(a: CartItem, id: number, size?: string) {
  return a.id === id && (a.size ?? "") === (size ?? "");
}

function clampQty(qty: number) {
  return Math.min(99, Math.max(0, Math.floor(qty)));
}

function writeCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignora falha de storage
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpenState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartItem[];
        setItems(
          parsed
            .filter((i) => i && Number.isFinite(i.id) && i.qty > 0)
            .map((i) => ({ ...i, qty: clampQty(i.qty) || 1 })),
        );
      }
      const wasOpen = window.localStorage.getItem(OPEN_KEY);
      if (wasOpen === "1") setOpenState(true);
    } catch {
      // carrinho vazio se storage inválido
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeCart(items);
  }, [items, hydrated]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const add = useCallback(
    (id: number, qty = 1, size?: string) => {
      setItems((prev) => {
        const addQty = clampQty(qty) || 1;
        const existing = prev.find((i) => sameLine(i, id, size));
        const next = existing
          ? prev.map((i) =>
              sameLine(i, id, size) ? { ...i, qty: clampQty(i.qty + addQty) || 1 } : i,
            )
          : [...prev, { id, qty: addQty, size }];
        writeCart(next);
        return next;
      });
      setOpen(true);
    },
    [setOpen],
  );

  const remove = useCallback((id: number, size?: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => !sameLine(i, id, size));
      writeCart(next);
      return next;
    });
  }, []);

  const setQty = useCallback((id: number, qty: number, size?: string) => {
    setItems((prev) => {
      const nextQty = clampQty(qty);
      const next =
        nextQty <= 0
          ? prev.filter((i) => !sameLine(i, id, size))
          : prev.map((i) => (sameLine(i, id, size) ? { ...i, qty: nextQty } : i));
      writeCart(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    writeCart([]);
    setItems([]);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count: items.reduce((acc, i) => acc + i.qty, 0),
      open,
      setOpen,
      add,
      remove,
      setQty,
      clear,
    }),
    [items, open, setOpen, add, remove, setQty, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart deve ser usado dentro de CartProvider");
  return ctx;
}

export function cartLineKey(item: CartItem) {
  return `${item.id}-${item.size ?? "default"}`;
}
