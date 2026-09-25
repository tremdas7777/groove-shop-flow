import { Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cartLineKey, useCart } from "@/lib/cart";
import { formatBRL, getProduct, parsePrice } from "@/lib/products";
import { createZedyStoreCheckout } from "@/lib/zedy-server";
import { cn } from "@/lib/utils";

export function CartDrawer() {
  const { items, open, setOpen, setQty, remove, count } = useCart();
  const [busy, setBusy] = useState(false);

  const detailed = items
    .map((i) => ({ item: i, product: getProduct(i.id) }))
    .filter((d) => d.product);

  const subtotal = detailed.reduce(
    (acc, d) => acc + parsePrice(d.product!.preco) * d.item.qty,
    0,
  );

  const checkout = async () => {
    if (!detailed.length) {
      toast.error("Sua sacola está vazia.");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const result = await createZedyStoreCheckout({
        data: {
          items: detailed.map(({ item }) => ({
            id: item.id,
            size: item.size,
            qty: item.qty,
          })),
        },
      });
      if (!result.ok) {
        const missing = "missing" in result && Array.isArray(result.missing) ? result.missing : [];
        if (missing.length) {
          toast.error(
            `Não encontrado na Zedy: ${missing
              .slice(0, 3)
              .map((m) => `${m.title}${m.size ? ` (${m.size})` : ""}`)
              .join(", ")}`,
          );
        } else {
          toast.error(result.error || "Não foi possível criar o checkout.");
        }
        return;
      }
      window.location.href = result.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no checkout Zedy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[70] bg-black/40 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-[80] flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-[#e4e5f3] px-4 py-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[#001E62]">Sacola</h2>
            <p className="text-[12px] text-muted-foreground">
              {count} {count === 1 ? "item" : "itens"} · subtotal {formatBRL(subtotal)}
            </p>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#f3f3f3]"
            onClick={() => setOpen(false)}
            aria-label="Fechar sacola"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {detailed.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-[15px] font-medium text-[#001E62]">Sua sacola está vazia</p>
              <button
                type="button"
                className="mt-4 text-[13px] text-primary underline"
                onClick={() => setOpen(false)}
              >
                Continuar comprando
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {detailed.map(({ item, product }) => (
                <li key={cartLineKey(item)} className="flex gap-3 px-4 py-4">
                  <img
                    src={product!.fotos[0]}
                    alt={product!.titulo}
                    className="h-20 w-20 shrink-0 object-contain bg-[#f4f4f4]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] font-medium text-[#222]">
                      {product!.titulo}
                    </p>
                    {item.size && (
                      <p className="mt-1 text-[12px] text-muted-foreground">Tamanho: {item.size}</p>
                    )}
                    <p className="mt-1 text-[14px] font-semibold">{formatBRL(product!.preco)}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="inline-flex items-center rounded-full bg-[#f3f3f3]">
                        <button
                          type="button"
                          className="flex h-9 w-9 items-center justify-center"
                          onClick={() => setQty(item.id, item.qty - 1, item.size)}
                          aria-label="Diminuir"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-7 text-center text-sm">{item.qty}</span>
                        <button
                          type="button"
                          className="flex h-9 w-9 items-center justify-center"
                          onClick={() => setQty(item.id, Math.min(99, item.qty + 1), item.size)}
                          aria-label="Aumentar"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-destructive"
                        onClick={() => remove(item.id, item.size)}
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[#e4e5f3] p-4">
          <div className="mb-3 flex justify-between text-[14px]">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-semibold">{formatBRL(subtotal)}</span>
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground">
            O valor final (frete e descontos) é calculado no checkout seguro da Zedy.
          </p>
          <button
            type="button"
            disabled={!detailed.length || busy}
            onClick={() => void checkout()}
            className="flex h-12 w-full items-center justify-center rounded-full bg-primary text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Abrindo checkout…" : "Finalizar compra"}
          </button>
          <Link
            to="/carrinho"
            onClick={() => setOpen(false)}
            className="mt-2 flex h-10 items-center justify-center text-[13px] text-primary underline"
          >
            Ver sacola completa
          </Link>
        </div>
      </aside>
    </>
  );
}
