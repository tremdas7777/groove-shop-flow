import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Star, Truck, ShieldCheck, ShoppingCart, Flame } from "lucide-react";
import { categories, formatBRL, products } from "@/lib/products";
import { Header } from "@/components/Header";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ASICS Outlet — Tênis com até 50% OFF" },
      {
        name: "description",
        content:
          "Tênis ASICS masculinos, femininos e unissex com descontos de até 50%. Frete grátis e compra segura.",
      },
      { property: "og:title", content: "ASICS Outlet — Tênis com até 50% OFF" },
      {
        property: "og:description",
        content:
          "Tênis ASICS masculinos, femininos e unissex com descontos de até 50%.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [category, setCategory] = useState<(typeof categories)[number]>("Todos");
  const { add } = useCart();

  const filtered =
    category === "Todos"
      ? products
      : products.filter((p) => p.categoria === category);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Banner promocional estilo TikTok Shop */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-3 text-center">
          <Flame className="h-5 w-5" />
          <p className="text-sm font-extrabold uppercase tracking-wide sm:text-base">
            Mega Oferta — até 50% OFF + Frete Rápido
          </p>
        </div>
      </section>

      {/* Filtro de categorias fixo */}
      <div className="sticky top-14 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                category === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Feed de produtos estilo TikTok Shop */}
      <main className="mx-auto max-w-6xl px-3 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <article
              key={p.id}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <Link
                to="/produto/$id"
                params={{ id: String(p.id) }}
                className="group block"
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img
                    src={p.fotos[0]}
                    alt={p.titulo}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {parseFloat(p.desconto) > 0 && (
                    <span className="absolute left-2 top-2 rounded-md bg-destructive px-2 py-0.5 text-xs font-extrabold text-destructive-foreground">
                      -{Math.round(parseFloat(p.desconto))}%
                    </span>
                  )}
                </div>
              </Link>
              <div className="p-3">
                <Link to="/produto/$id" params={{ id: String(p.id) }}>
                  <h2 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                    {p.titulo}
                  </h2>
                </Link>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-primary text-primary" />
                  {p.notas}
                  <span className="text-muted-foreground/70">
                    · 1 mil+ vendidos
                  </span>
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-lg font-extrabold text-foreground">
                    {formatBRL(p.preco)}
                  </span>
                  {parseFloat(p.preco_comparacao) > parseFloat(p.preco) && (
                    <span className="pb-0.5 text-xs text-muted-foreground line-through">
                      {formatBRL(p.preco_comparacao)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => add(p.id)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <ShoppingCart className="h-4 w-4" />
                  Comprar
                </button>
              </div>
            </article>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <div className="mb-3 flex items-center justify-center gap-4">
          <span className="inline-flex items-center gap-1">
            <Truck className="h-4 w-4 text-primary" /> Frete rápido
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-4 w-4 text-primary" /> Compra segura
          </span>
        </div>
        <p>ASICS Outlet — Ofertas por tempo limitado.</p>
      </footer>
    </div>
  );
}
