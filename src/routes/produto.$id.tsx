import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ShoppingCart, Star, Truck, ShieldCheck, ChevronLeft } from "lucide-react";
import { formatBRL, getProduct, products } from "@/lib/products";
import { useCart } from "@/lib/cart";
import { Header } from "@/components/Header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/produto/$id")({
  loader: ({ params }) => {
    const product = getProduct(Number(params.id));
    if (!product) throw notFound();
    return { product };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.product.titulo} — ASICS Outlet` },
          {
            name: "description",
            content: loaderData.product.descricao.slice(0, 155),
          },
          { property: "og:title", content: loaderData.product.titulo },
          {
            property: "og:description",
            content: `${formatBRL(loaderData.product.preco)} — ASICS Outlet`,
          },
          { property: "og:type", content: "product" },
          { property: "og:image", content: loaderData.product.fotos[0] },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:image", content: loaderData.product.fotos[0] },
        ]
      : [{ title: "Produto não encontrado — ASICS Outlet" }],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { product } = Route.useLoaderData();
  const { add } = useCart();
  const [foto, setFoto] = useState(0);
  const [added, setAdded] = useState(false);

  const relacionados = products
    .filter((p) => p.categoria === product.categoria && p.id !== product.id)
    .slice(0, 4);

  const handleAdd = () => {
    add(product.id);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Voltar à loja
        </Link>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Galeria */}
          <div>
            <div className="aspect-square overflow-hidden rounded-xl border border-border bg-muted">
              <img
                src={product.fotos[foto]}
                alt={product.titulo}
                className="h-full w-full object-cover"
              />
            </div>
            {product.fotos.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {product.fotos.map((f, i) => (
                  <button
                    key={f}
                    onClick={() => setFoto(i)}
                    className={cn(
                      "h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2",
                      i === foto ? "border-primary" : "border-border",
                    )}
                    aria-label={`Foto ${i + 1}`}
                  >
                    <img src={f} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              {product.categoria}
            </span>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              {product.titulo}
            </h1>
            <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-primary text-primary" />
              {product.notas} · Mais de 1.000 avaliações
            </div>

            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              {parseFloat(product.preco_comparacao) >
                parseFloat(product.preco) && (
                <span className="text-sm text-muted-foreground line-through">
                  {formatBRL(product.preco_comparacao)}
                </span>
              )}
              <div className="flex items-end gap-2">
                <span className="text-3xl font-extrabold text-foreground">
                  {formatBRL(product.preco)}
                </span>
                {parseFloat(product.desconto) > 0 && (
                  <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
                    -{Math.round(parseFloat(product.desconto))}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                em até 6x sem juros
              </p>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={handleAdd}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-primary px-6 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {added ? "Adicionado!" : "Adicionar ao carrinho"}
                </button>
                <Link
                  to="/carrinho"
                  onClick={() => add(product.id)}
                  className="inline-flex flex-1 items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Comprar agora
                </Link>
              </div>

              <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary" /> Envio para todo o
                  Brasil
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Troca grátis
                  em até 30 dias
                </span>
              </div>
            </div>

            {product.descricao && (
              <div className="mt-6">
                <h2 className="text-lg font-bold text-foreground">Descrição</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {product.descricao}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Relacionados */}
        {relacionados.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold text-foreground">
              Você também pode gostar
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {relacionados.map((p) => (
                <Link
                  key={p.id}
                  to="/produto/$id"
                  params={{ id: String(p.id) }}
                  className="group overflow-hidden rounded-xl border border-border bg-card"
                >
                  <div className="aspect-square overflow-hidden bg-muted">
                    <img
                      src={p.fotos[0]}
                      alt={p.titulo}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-3">
                    <h3 className="line-clamp-2 text-sm font-medium text-foreground">
                      {p.titulo}
                    </h3>
                    <span className="mt-1 block text-sm font-bold text-foreground">
                      {formatBRL(p.preco)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
