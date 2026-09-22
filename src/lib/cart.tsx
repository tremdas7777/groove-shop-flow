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
  add: (id: number, qty?: number, size?: string) => void;
  remove: (id: number, size?: string) => void;
  setQty: (id: number, qty: number, size?: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "asics-shop-cart";

function sameLine(a: CartItem, id: number, size?: string) {
  return a.id === id && (a.size ?? "") === (size ?? "");
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
    } catch {
      // carrinho vazio se storage inválido
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignora falha de storage
    }
  }, [items, hydrated]);

  const add = useCallback((id: number, qty = 1, size?: string) => {
    setItems((prev) => {
      const existing = prev.find((i) => sameLine(i, id, size));
      if (existing) {
        return prev.map((i) =>
          sameLine(i, id, size) ? { ...i, qty: i.qty + qty } : i,
        );
      }
      return [...prev, { id, qty, size }];
    });
  }, []);

  const remove = useCallback((id: number, size?: string) => {
    setItems((prev) => prev.filter((i) => !sameLine(i, id, size)));
  }, []);

  const setQty = useCallback((id: number, qty: number, size?: string) => {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((i) => !sameLine(i, id, size))
        : prev.map((i) => (sameLine(i, id, size) ? { ...i, qty } : i)),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count: items.reduce((acc, i) => acc + i.qty, 0),
      add,
      remove,
      setQty,
      clear,
    }),
    [items, add, remove, setQty, clear],
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
