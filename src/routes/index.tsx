import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  HomeCampaignBanners,
  HomeCategoryBanners,
  HomeHeroBanner,
  HomeOneAsicsBanner,
} from "@/components/HomeBanners";
import { ProductCard } from "@/components/ProductCard";
import { StoreLayout } from "@/components/StoreLayout";
import { products } from "@/lib/products";
import { pickTrackingSearch, type TrackingSearch } from "@/lib/tracking";
import { cn } from "@/lib/utils";

type HomeSearch = TrackingSearch & {
  cat?: string;
  q?: string;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    cat: typeof search.cat === "string" ? search.cat : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    ...pickTrackingSearch(search),
  }),
  head: () => ({
    meta: [
      { title: "ASICS Brasil — Tênis de corrida, treino e lifestyle" },
      {
        name: "description",
        content:
          "Tênis ASICS masculinos, femininos e unissex. Mais velocidade, energia e conforto para movimentar corpo e mente.",
      },
      { property: "og:title", content: "ASICS Brasil" },
      {
        property: "og:description",
        content:
          "Tênis ASICS masculinos, femininos e unissex. Frete para todo o Brasil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

const chips = ["Todos", "Masculino", "Feminino", "Unisex", "Outlet"] as const;

function HomePage() {
  const search = Route.useSearch();
  const [category, setCategory] = useState(search.cat ?? "Todos");

  useEffect(() => {
    if (search.cat) setCategory(search.cat);
  }, [search.cat]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    return products.filter((p) => {
      const matchCat =
        category === "Todos"
          ? true
          : category === "Outlet"
            ? parseFloat(p.desconto) > 0
            : p.categoria === category;
      const matchQ = !q || p.titulo.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [category, search.q]);

  return (
    <StoreLayout onSelectCategory={setCategory}>
      <HomeHeroBanner />
      <HomeCategoryBanners />

      <section id="produtos" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-4 py-8 pb-12 sm:py-10 sm:pb-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-[22px] font-semibold text-[#222] sm:text-[28px]">
                Tênis em destaque
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground sm:text-[14px]">
                Os mesmos produtos, agora com a experiência oficial da marca.
              </p>
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-colors",
                    category === c
                      ? "border-primary bg-primary text-white"
                      : "border-border bg-white text-foreground hover:border-primary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 sm:mt-8 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-10 lg:grid-cols-4">
            {filtered.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      <HomeCampaignBanners />
      <HomeOneAsicsBanner />
    </StoreLayout>
  );
}
