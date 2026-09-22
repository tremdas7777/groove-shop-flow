import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { CheckoutShell } from "@/components/CheckoutShell";
import { ProductCard } from "@/components/ProductCard";
import { cartLineKey, useCart } from "@/lib/cart";
import { formatBRL, getProduct, parsePrice, products } from "@/lib/products";
import { track } from "@/lib/tracking";

export const Route = createFileRoute("/carrinho")({
  head: () => ({
    meta: [
      { title: "Minha Sacola — ASICS Brasil" },
      { name: "description", content: "Revise os itens da sua sacola ASICS." },
      { property: "og:title", content: "Minha Sacola — ASICS Brasil" },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const { items, setQty, remove } = useCart();

  const detailed = items
    .map((i) => ({ item: i, product: getProduct(i.id) }))
    .filter((d) => d.product);

  const subtotal = detailed.reduce(
    (acc, d) => acc + parsePrice(d.product!.preco) * d.item.qty,
    0,
  );
  const compare = detailed.reduce(
    (acc, d) =>
      acc +
      Math.max(parsePrice(d.product!.preco_comparacao), parsePrice(d.product!.preco)) *
        d.item.qty,
    0,
  );
  const discount = Math.max(0, compare - subtotal);

  const recommended = products.slice(0, 8);

  useEffect(() => {
    track("view_cart", {
      value: subtotal,
      content_ids: detailed.map((d) => String(d.item.id)),
    });
    // só no mount da sacola
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CheckoutShell>
      <h1 className="text-[22px] font-bold text-[#222] sm:text-[28px]">
        Minha Sacola
      </h1>

      {detailed.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-16 text-center">
          <svg
            width="72"
            height="48"
            viewBox="0 0 72 48"
            fill="none"
            className="text-primary"
            aria-hidden
          >
            <path
              d="M10 34c6-2 12 1 18 1s14-4 22-2c6 1 12 4 16 3"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M14 30c1-8 5-14 14-16 10-2 16 2 22 1 6-1 10-5 16-4"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M20 22c4-1 8 2 14 1M28 18c3 .2 6 2 10 1"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle cx="22" cy="36" r="5" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="54" cy="36" r="5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <h2 className="mt-6 text-[22px] font-semibold text-primary">
            Sua sacola está vazia
          </h2>
          <p className="mt-2 max-w-sm text-[14px] text-[#333]">
            Descubra tênis, roupas e acessórios para elevar o seu desempenho.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-full bg-primary px-8 py-3 text-[14px] font-semibold text-white"
          >
            Explorar produtos
          </Link>

          <div className="mt-16 w-full text-left">
            <h3 className="text-[20px] font-semibold text-primary">
              Produtos recomendados
            </h3>
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
              {recommended.slice(0, 4).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 sm:mt-8 lg:grid-cols-[1fr_340px] lg:gap-10">
          <ul className="divide-y divide-border border-y border-border">
            {detailed.map(({ item, product }) => (
              <li
                key={cartLineKey(item)}
                className="flex gap-3 py-4 sm:gap-4 sm:py-5"
              >
                <Link
                  to="/produto/$id"
                  params={{ id: String(product!.id) }}
                  className="h-20 w-20 shrink-0 bg-[#f4f4f4] sm:h-[104px] sm:w-[104px]"
                >
                  <img
                    src={product!.fotos[0]}
                    alt={product!.titulo}
                    className="h-full w-full object-contain"
                  />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    to="/produto/$id"
                    params={{ id: String(product!.id) }}
                    className="line-clamp-2 text-[13px] font-medium text-[#222] hover:underline sm:text-[14px]"
                  >
                    {product!.titulo}
                  </Link>
                  {item.size && (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Tamanho: {item.size}
                    </p>
                  )}
                  <p className="mt-2 text-[15px] font-semibold">
                    {formatBRL(product!.preco)}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="inline-flex items-center rounded-full bg-[#f3f3f3]">
                      <button
                        type="button"
                        onClick={() => setQty(item.id, item.qty - 1, item.size)}
                        className="flex h-11 w-11 items-center justify-center text-primary"
                        aria-label="Diminuir quantidade"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-medium">
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQty(item.id, item.qty + 1, item.size)}
                        className="flex h-11 w-11 items-center justify-center text-primary"
                        aria-label="Aumentar quantidade"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(item.id, item.size)}
                      className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive"
                      aria-label="Remover item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <aside className="h-fit border border-[#e4e5f3] p-5">
            <h2 className="text-[16px] font-semibold">Resumo do pedido</h2>
            <dl className="mt-4 space-y-2 text-[14px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{formatBRL(subtotal + discount)}</dd>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-primary">
                  <dt>Descontos</dt>
                  <dd>-{formatBRL(discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Frete</dt>
                <dd>Grátis, padrão ou expresso</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-3 text-[16px] font-semibold">
                <dt>Total</dt>
                <dd>{formatBRL(subtotal)}</dd>
              </div>
            </dl>
            <Link
              to="/checkout"
              className="mt-5 flex h-12 items-center justify-center rounded-full bg-primary text-[14px] font-semibold text-white"
            >
              Finalizar compra
            </Link>
            <Link
              to="/"
              className="mt-3 flex h-10 items-center justify-center text-[13px] text-primary underline underline-offset-2"
            >
              Escolher produtos
            </Link>
          </aside>
        </div>
      )}
    </CheckoutShell>
  );
}
