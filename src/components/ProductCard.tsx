import { Link } from "@tanstack/react-router";
import {
  formatBRL,
  installmentOf,
  parsePrice,
  type Product,
} from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  const price = parsePrice(product.preco);
  const compare = parsePrice(product.preco_comparacao);
  const off = parseFloat(product.desconto);

  return (
    <Link
      to="/produto/$id"
      params={{ id: String(product.id) }}
      className="group block"
    >
      <div className="relative aspect-square overflow-hidden bg-[#f4f4f4]">
        <img
          src={product.fotos[0]}
          alt={product.titulo}
          loading="lazy"
          className="h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.03] sm:p-3"
        />
        {off > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-sale px-2.5 py-1 text-[11px] font-semibold text-sale-foreground">
            -{Math.round(off)}%
          </span>
        )}
      </div>
      <div className="pt-3">
        <h3 className="line-clamp-2 min-h-9 text-[12px] font-medium leading-snug text-foreground sm:min-h-10 sm:text-[13px]">
          {product.titulo}
        </h3>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {compare > price && (
            <span className="text-[13px] text-muted-foreground line-through">
              {formatBRL(compare)}
            </span>
          )}
          <span className="text-[15px] font-semibold text-foreground">
            {formatBRL(price)}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          ou em até 10x de {installmentOf(price)}
        </p>
      </div>
    </Link>
  );
}
