import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CheckoutShell } from "@/components/CheckoutShell";
import { loadOrder } from "@/lib/checkout";
import { runningKits, type RunningKit } from "@/lib/kits";
import { formatBRL } from "@/lib/products";
import { useCart } from "@/lib/cart";
import { track } from "@/lib/tracking";
import { orderStatus } from "@/lib/admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/obrigado")({
  head: () => ({
    meta: [{ title: "Obrigado — ASICS Brasil" }],
  }),
  component: ThankYouPage,
});

function ThankYouPage() {
  const navigate = useNavigate();
  const { add, clear } = useCart();
  const [order, setOrder] = useState(() => (typeof window === "undefined" ? null : loadOrder()));
  const [picked, setPicked] = useState<number | null>(null);
  const [clothes, setClothes] = useState<Record<number, string>>({
    90001: "M",
    90002: "M",
  });
  const [shoes, setShoes] = useState<Record<number, string>>({
    90001: "41",
    90002: "37",
  });

  useEffect(() => {
    const saved = loadOrder();
    if (!saved) return;
    setOrder(saved);
    if (orderStatus(saved) !== "paid") {
      void navigate({ to: "/pedido" });
    }
  }, [navigate]);

  useEffect(() => {
    if (!order) return;
    track("page_view", { page: "obrigado", order_id: order.id }, "/obrigado");
  }, [order]);

  if (!order) {
    return (
      <CheckoutShell>
        <h1 className="text-[22px] font-semibold">Pedido não encontrado</h1>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          Voltar à loja
        </Link>
      </CheckoutShell>
    );
  }

  const alreadyKit = order.items.some((item) => item.id === 90001 || item.id === 90002);

  const chooseKit = (kit: RunningKit) => {
    const size = `${clothes[kit.id] ?? "M"} / ${shoes[kit.id] ?? "40"}`;
    clear();
    add(kit.id, 1, size);
    track("add_to_cart", {
      content_ids: [String(kit.id)],
      content_name: kit.title,
      value: kit.price,
      size,
      upsell: true,
    });
    setPicked(kit.id);
    void navigate({ to: "/checkout" });
  };

  return (
    <CheckoutShell>
      <div className="mx-auto max-w-3xl text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f7ee] text-[#0d7a3f]">
          <Check className="h-7 w-7" />
        </span>
        <p className="mt-4 text-[13px] font-medium uppercase tracking-wide text-primary">
          Pedido {order.id} pago
        </p>
        <h1 className="mt-2 text-[26px] font-semibold text-[#222] sm:text-[32px]">
          Obrigado, {order.data.firstName}
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-[#444]">
          Pagamento confirmado. Enviamos os detalhes para {order.data.email}. Seu pedido segue para
          separação com o frete escolhido.
        </p>
      </div>

      {!alreadyKit && (
        <section className="mt-10">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
              Oferta exclusiva
            </p>
            <h2 className="mt-2 text-[22px] font-semibold text-[#222]">
              Complete seu treino com o kit de corrida
            </h2>
            <p className="mt-2 text-[14px] text-[#555]">
              Roupa + tênis + meia no mesmo envio. Escolha o kit masculino ou feminino.
            </p>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {runningKits.map((kit) => (
              <article
                key={kit.id}
                className={cn(
                  "border border-[#e4e5f3] p-4 sm:p-5",
                  picked === kit.id && "border-primary",
                )}
              >
                <img src={kit.photo} alt="" className="aspect-[4/3] w-full bg-[#f4f4f4] object-contain" />
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {kit.gender === "masculino" ? "Masculino" : "Feminino"}
                </p>
                <h3 className="mt-1 text-[18px] font-semibold text-[#222]">{kit.title}</h3>
                <p className="text-[13px] text-[#666]">{kit.subtitle}</p>
                <ul className="mt-4 grid grid-cols-2 gap-2">
                  {kit.pieces.map((piece) => (
                    <li key={piece.name} className="flex items-center gap-2 text-[12px] text-[#444]">
                      <img src={piece.photo} alt="" className="h-10 w-10 bg-[#f4f4f4] object-cover" />
                      {piece.name}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-left text-[12px] text-[#666]">
                    Roupa
                    <select
                      value={clothes[kit.id]}
                      onChange={(e) => setClothes((prev) => ({ ...prev, [kit.id]: e.target.value }))}
                      className="mt-1 h-11 w-full border border-[#e4e5f3] px-2 text-[14px] text-[#222]"
                    >
                      {kit.clothesSizes.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-left text-[12px] text-[#666]">
                    Tênis
                    <select
                      value={shoes[kit.id]}
                      onChange={(e) => setShoes((prev) => ({ ...prev, [kit.id]: e.target.value }))}
                      className="mt-1 h-11 w-full border border-[#e4e5f3] px-2 text-[14px] text-[#222]"
                    >
                      {kit.shoeSizes.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-[13px] text-[#888] line-through">{formatBRL(kit.compareAt)}</p>
                    <p className="text-[22px] font-semibold text-[#222]">{formatBRL(kit.price)}</p>
                  </div>
                  <p className="text-[12px] text-[#0d7a3f]">ou 10x de {formatBRL(kit.price / 10)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => chooseKit(kit)}
                  className="mt-4 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white"
                >
                  Quero este kit
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 text-center">
        <Link to="/" className="text-[14px] text-primary underline">
          Voltar para a loja
        </Link>
      </div>
    </CheckoutShell>
  );
}
