import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { formatBRL, getProduct } from "@/lib/products";
import { useCart } from "@/lib/cart";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/carrinho")({
  head: () => ({
    meta: [
      { title: "Carrinho — ASICS Outlet" },
      { name: "description", content: "Revise os itens do seu carrinho." },
      { property: "og:title", content: "Carrinho — ASICS Outlet" },
      { property: "og:description", content: "Revise os itens do seu carrinho." },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const { items, setQty, remove, clear } = useCart();

  const detailed = items
    .map((i) => ({ item: i, product: getProduct(i.id) }))
    .filter((d) => d.product);

  const total = detailed.reduce(
    (acc, d) => acc + parseFloat(d.product!.preco) * d.item.qty,
    0,
  );

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
          Seu carrinho
        </h1>

        {detailed.length === 0 ? (
          <div className="mt-12 flex flex-col items-center text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              Seu carrinho está vazio.
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              Ver ofertas
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-6 space-y-4">
              {detailed.map(({ item, product }) => (
                <li
                  key={item.id}
                  className="flex gap-4 rounded-xl border border-border bg-card p-3"
                >
                  <Link
                    to="/produto/$id"
                    params={{ id: String(product!.id) }}
                    className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted"
                  >
                    <img
                      src={product!.fotos[0]}
                      alt={product!.titulo}
                      className="h-full w-full object-cover"
                    />
                  </Link>
                  <div className="flex flex-1 flex-col">
                    <Link
                      to="/produto/$id"
                      params={{ id: String(product!.id) }}
                      className="line-clamp-2 text-sm font-medium text-foreground hover:underline"
                    >
                      {product!.titulo}
                    </Link>
                    <span className="mt-1 text-base font-bold text-foreground">
                      {formatBRL(product!.preco)}
                    </span>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="inline-flex items-center rounded-full border border-border">
                        <button
                          onClick={() => setQty(item.id, item.qty - 1)}
                          className="p-2 text-muted-foreground hover:text-foreground"
                          aria-label="Diminuir quantidade"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium text-foreground">
                          {item.qty}
                        </span>
                        <button
                          onClick={() => setQty(item.id, item.qty + 1)}
                          className="p-2 text-muted-foreground hover:text-foreground"
                          aria-label="Aumentar quantidade"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => remove(item.id)}
                        className="p-2 text-muted-foreground hover:text-destructive"
                        aria-label="Remover item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-xl font-extrabold text-foreground">
                  {formatBRL(total)}
                </span>
              </div>
              <button
                className="mt-4 w-full rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                onClick={() =>
                  alert(
                    "Checkout em breve! Esta é uma demonstração da vitrine.",
                  )
                }
              >
                Finalizar compra
              </button>
              <button
                onClick={clear}
                className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Limpar carrinho
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
