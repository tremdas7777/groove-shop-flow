import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Star, Truck, ShieldCheck } from "lucide-react";
import { categories, formatBRL, products } from "@/lib/products";
import { Header } from "@/components/Header";
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

  const filtered =
    category === "Todos"
      ? products
      : products.filter((p) => p.categoria === category);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-10 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Tênis em movimento
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            ASICS com até <span className="text-primary">50% OFF</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Modelos masculinos, femininos e unissex selecionados. Estoque
            limitado — garanta o seu antes que acabe.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Truck className="h-4 w-4 text-primary" /> Frete rápido
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-primary" /> Compra segura
            </span>
            <span className="inline-flex items-center gap-1">
              <Star className="h-4 w-4 text-primary" /> 4.7/5 avaliações
            </span>
          </div>
        </div>
      </section>

      {/* Filtro de categorias */}
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <div className="flex gap-2 overflow-x-auto pb-2">
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

      {/* Vitrine */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to="/produto/$id"
              params={{ id: String(p.id) }}
              className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-lg"
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={p.fotos[0]}
                  alt={p.titulo}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {parseFloat(p.desconto) > 0 && (
                  <span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
                    -{Math.round(parseFloat(p.desconto))}%
                  </span>
                )}
              </div>
              <div className="p-3">
                <h2 className="line-clamp-2 text-sm font-medium text-foreground">
                  {p.titulo}
                </h2>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-primary text-primary" />
                  {p.notas}
                </div>
                <div className="mt-2">
                  <span className="text-base font-bold text-foreground">
                    {formatBRL(p.preco)}
                  </span>
                  {parseFloat(p.preco_comparacao) > parseFloat(p.preco) && (
                    <span className="ml-2 text-xs text-muted-foreground line-through">
                      {formatBRL(p.preco_comparacao)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>ASICS Outlet — Ofertas por tempo limitado.</p>
      </footer>
    </div>
  );
}
