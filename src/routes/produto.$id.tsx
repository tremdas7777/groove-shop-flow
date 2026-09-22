import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Heart, Ruler, Share2, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/ProductCard";
import { StoreLayout } from "@/components/StoreLayout";
import { useCart } from "@/lib/cart";
import {
  formatBRL,
  getProduct,
  getSizes,
  installmentOf,
  parsePrice,
  products,
} from "@/lib/products";
import { track } from "@/lib/tracking";
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
          { title: `${loaderData.product.titulo} — ASICS Brasil` },
          {
            name: "description",
            content: loaderData.product.descricao.slice(0, 155),
          },
          { property: "og:title", content: loaderData.product.titulo },
          {
            property: "og:description",
            content: `${formatBRL(loaderData.product.preco)} — ASICS Brasil`,
          },
          { property: "og:type", content: "product" },
          { property: "og:image", content: loaderData.product.fotos[0] },
          { name: "twitter:card", content: "summary_large_image" },
          { name: "twitter:image", content: loaderData.product.fotos[0] },
        ]
      : [{ title: "Produto não encontrado — ASICS Brasil" }],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { product } = Route.useLoaderData();
  const { add } = useCart();
  const navigate = useNavigate();
  const [foto, setFoto] = useState(0);
  const [size, setSize] = useState<string>("");
  const [added, setAdded] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [tab, setTab] = useState<"sobre" | "tecnologias" | "cuidados">("sobre");

  const sizes = getSizes(product);
  const price = parsePrice(product.preco);
  const compare = parsePrice(product.preco_comparacao);
  const off = parseFloat(product.desconto);

  const relacionados = products
    .filter((p) => p.categoria === product.categoria && p.id !== product.id)
    .slice(0, 4);

  useEffect(() => {
    track("view_item", {
      content_ids: [String(product.id)],
      content_name: product.titulo,
      value: price,
    });
  }, [product.id, product.titulo, price]);

  const addToBag = () => {
    if (sizes.length && !size) {
      setSizeError(true);
      return false;
    }
    add(product.id, 1, size || undefined);
    track("add_to_cart", {
      content_ids: [String(product.id)],
      content_name: product.titulo,
      value: price,
      size,
    });
    return true;
  };

  const handleAdd = () => {
    if (!addToBag()) return;
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  };

  const handleBuyNow = () => {
    if (!addToBag()) return;
    void navigate({ to: "/checkout" });
  };

  return (
    <StoreLayout>
      <main className="mx-auto max-w-[1280px] px-4 py-4 lg:py-10">
        <p className="truncate text-[12px] text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            ASICS Brasil
          </Link>
          {" / "}
          <span>{product.categoria}</span>
          {" / "}
          <span className="text-foreground">{product.titulo}</span>
        </p>

        <div className="mt-4 grid gap-8 lg:mt-6 lg:grid-cols-2 lg:gap-10">
          <div>
            <div className="relative aspect-square overflow-hidden bg-[#f4f4f4]">
              <img
                src={product.fotos[foto]}
                alt={product.titulo}
                className="h-full w-full object-contain"
              />
              {off > 0 && (
                <span className="absolute left-3 top-3 rounded-full bg-sale px-3 py-1 text-[12px] font-semibold text-white">
                  -{Math.round(off)}%
                </span>
              )}
            </div>
            {product.fotos.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                {product.fotos.map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFoto(i)}
                    className={cn(
                      "h-16 w-16 shrink-0 overflow-hidden border bg-[#f4f4f4] sm:h-[72px] sm:w-[72px]",
                      i === foto ? "border-primary" : "border-transparent",
                    )}
                    aria-label={`Foto ${i + 1}`}
                  >
                    <img src={f} alt="" className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-[22px] font-semibold leading-snug text-[#222] sm:text-[26px]">
                {product.titulo}
              </h1>
              <div className="-mr-2 flex shrink-0 text-primary">
                <button
                  type="button"
                  aria-label="Adicionar aos favoritos"
                  className="flex h-11 w-11 items-center justify-center"
                >
                  <Heart className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Compartilhar este produto"
                  className="flex h-11 w-11 items-center justify-center"
                >
                  <Share2 className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-baseline gap-2">
              {compare > price && (
                <span className="text-[15px] text-muted-foreground line-through">
                  {formatBRL(compare)}
                </span>
              )}
              <span className="text-[22px] font-semibold text-[#222]">
                {formatBRL(price)}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              ou em até 10x de {installmentOf(price)}
            </p>

            {sizes.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-semibold">Tamanho</p>
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                    <Ruler className="h-3.5 w-3.5" />
                    Guia de medidas
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {sizes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSize(s);
                        setSizeError(false);
                      }}
                      className={cn(
                        "h-11 min-w-11 rounded-full px-3 text-[13px] font-medium",
                        size === s
                          ? "bg-primary text-white"
                          : "bg-[#f3f3f3] text-[#222] hover:bg-[#e8e8e8]",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {sizeError && (
                  <p className="mt-2 text-[12px] text-destructive">
                    Selecione o tamanho
                  </p>
                )}
              </div>
            )}

            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={handleAdd}
                className="h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white"
              >
                {added ? "Adicionado à sacola" : "Adicionar à sacola"}
              </button>
              <button
                type="button"
                onClick={handleBuyNow}
                className="flex h-12 w-full items-center justify-center rounded-full border border-primary text-[14px] font-semibold text-primary"
              >
                Comprar agora
              </button>
            </div>

            <div className="mt-6 flex items-start gap-3 text-[13px] text-muted-foreground">
              <Truck className="mt-0.5 h-4 w-4 text-primary" />
              <p>
                Envio para todo o Brasil. Informe o CEP no checkout para
                calcular o prazo.
              </p>
            </div>

            <div className="mt-8 border-t border-border pt-4">
              <div className="flex gap-5 text-[13px] font-semibold">
                {(
                  [
                    ["sobre", "Sobre"],
                    ["tecnologias", "Tecnologias"],
                    ["cuidados", "Cuidados"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      "pb-2",
                      tab === key
                        ? "border-b-2 border-primary text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-[#444]">
                {tab === "sobre" &&
                  (product.descricao ||
                    "Tênis ASICS com amortecimento e conforto para o seu ritmo.")}
                {tab === "tecnologias" &&
                  "Tecnologia ASICS de amortecimento e retorno de energia, cabedal respirável e solado com tração para asfalto e esteira."}
                {tab === "cuidados" &&
                  "Lave com pano úmido e sabão neutro. Evite máquina de lavar e secadora. Seque à sombra."}
              </div>
            </div>
          </div>
        </div>

        {relacionados.length > 0 && (
          <section className="mt-12 lg:mt-16">
            <h2 className="text-[20px] font-semibold text-[#222] sm:text-[22px]">
              Você também pode gostar
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-8 sm:mt-6 sm:grid-cols-4 sm:gap-x-4 sm:gap-y-10">
              {relacionados.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </main>

    </StoreLayout>
  );
}
