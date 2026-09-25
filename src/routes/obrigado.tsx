import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CheckoutShell } from "@/components/CheckoutShell";
import { customerFirstName, loadOrder, persistOrder, type OrderSummary } from "@/lib/checkout";
import { runningKits, type KitPiece, type RunningKit } from "@/lib/kits";
import { createStorePix } from "@/lib/magicpay";
import { formatBRL } from "@/lib/products";
import { getAttribution, getSessionId, track } from "@/lib/tracking";
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
  const [order, setOrder] = useState(() => (typeof window === "undefined" ? null : loadOrder()));
  const [picked, setPicked] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
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

  const alreadyKit = order.items.some((item) => item.id === 90001 || item.id === 90002) || Boolean(order.upsell);

  const chooseKit = async (kit: RunningKit) => {
    const size = `${clothes[kit.id] ?? "M"} / ${shoes[kit.id] ?? "40"}`;
    setPicked(kit.id);
    setPaying(true);
    setPayError("");
    track("add_to_cart", {
      content_ids: [String(kit.id)],
      content_name: kit.title,
      value: kit.price,
      size,
      upsell: true,
      parent_order_id: order.id,
    });
    const orderId = `PD${Date.now().toString().slice(-8)}`;
    const upsellOrder: OrderSummary = {
      id: orderId,
      createdAt: new Date().toISOString(),
      data: { ...order.data, shippingMethod: "gratis", payment: "pix" },
      items: [
        {
          id: kit.id,
          size,
          qty: 1,
          title: kit.title,
          price: kit.price,
          photo: kit.photo,
        },
      ],
      subtotal: kit.price,
      shipping: 0,
      discount: Math.max(0, kit.compareAt - kit.price),
      total: kit.price,
      status: "pending",
      attribution: order.attribution ?? getAttribution(),
      sessionId: order.sessionId ?? getSessionId(),
      parentOrderId: order.id,
      upsell: true,
      notes: `Upsell do pedido ${order.id}`,
    };
    track("generate_pix", {
      order_id: orderId,
      event_id: `${orderId}-AddPaymentInfo`,
      value: kit.price,
      content_ids: [String(kit.id)],
      content_name: kit.title,
      num_items: 1,
      cart_items: [{ id: kit.id, title: kit.title, qty: 1, price: kit.price }],
      email: order.data.email,
      name: order.data.name,
      phone: order.data.phone,
      city: order.data.city,
      state: order.data.state,
      upsell: true,
      parent_order_id: order.id,
    });
    try {
      const result = await Promise.race([
        createStorePix({
          data: {
            orderId,
            amountCents: Math.round(kit.price * 100),
            shippingCents: 0,
            customer: {
              name: order.data.name,
              email: order.data.email,
              phone: order.data.phone,
              cpf: order.data.cpf,
            },
            address: {
              street: order.data.street,
              streetNumber: order.data.number,
              neighborhood: order.data.neighborhood,
              city: order.data.city,
              state: order.data.state,
              zipCode: order.data.cep,
              complement: order.data.complement,
            },
            items: [
              {
                title: kit.title,
                unitPrice: Math.round(kit.price * 100),
                quantity: 1,
                externalRef: String(kit.id),
              },
            ],
            order: upsellOrder,
          },
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("Demorou demais para gerar o PIX. Tente de novo.")),
            20000,
          ),
        ),
      ]);
      if (!result.ok) {
        setPayError(result.error || "Não gerou o PIX do kit. Tente de novo.");
        return;
      }
      await persistOrder(
        { ...upsellOrder, pix: result.pix, gateway: result.gateway, status: "pending" },
        true,
      );
      void navigate({ to: "/pedido" });
    } catch (error) {
      setPayError(
        error instanceof Error ? error.message : "Não gerou o PIX do kit. Tente de novo.",
      );
    } finally {
      setPaying(false);
    }
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
          Obrigado, {customerFirstName(order.data)}
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-[#444]">
          Pagamento confirmado. Enviamos os detalhes para {order.data.email}. Seu pedido segue para
          separação com o frete escolhido.
        </p>
      </div>

      {!alreadyKit && (
        <section className="mt-10">
          <div className="text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
              Oferta exclusiva
            </p>
            <h2 className="mt-2 text-[22px] font-semibold text-[#222] sm:text-[28px]">
              Complete seu treino com o kit de corrida
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-[14px] text-[#555]">
              Roupa + tênis + meia no mesmo envio. Toque na peça para ver a foto real da ASICS.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            {runningKits.map((kit) => (
              <KitCard
                key={kit.id}
                kit={kit}
                clothes={clothes[kit.id] ?? "M"}
                shoes={shoes[kit.id] ?? "40"}
                paying={paying}
                selected={picked === kit.id}
                onClothes={(value) => setClothes((prev) => ({ ...prev, [kit.id]: value }))}
                onShoes={(value) => setShoes((prev) => ({ ...prev, [kit.id]: value }))}
                onBuy={() => void chooseKit(kit)}
              />
            ))}
          </div>
          {payError && <p className="mt-4 text-center text-[14px] text-red-600">{payError}</p>}
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

function KitCard({
  kit,
  clothes,
  shoes,
  paying,
  selected,
  onClothes,
  onShoes,
  onBuy,
}: {
  kit: RunningKit;
  clothes: string;
  shoes: string;
  paying: boolean;
  selected: boolean;
  onClothes: (value: string) => void;
  onShoes: (value: string) => void;
  onBuy: () => void;
}) {
  const [focus, setFocus] = useState<KitPiece>(kit.pieces.find((piece) => piece.kind === "tenis") ?? kit.pieces[0]);
  return (
    <article
      className={cn(
        "flex flex-col border border-[#e4e5f3] bg-white p-3 sm:p-4",
        selected && "border-primary",
      )}
    >
      <div className="relative aspect-square bg-[#f4f4f4]">
        <img src={focus.photo} alt={focus.name} className="h-full w-full object-contain p-4" />
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
          {kit.gender === "masculino" ? "Masculino" : "Feminino"}
        </span>
      </div>
      <p className="mt-3 text-center text-[13px] font-medium text-[#222]">{focus.name}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {kit.pieces.map((piece) => {
          const active = focus.name === piece.name;
          return (
            <li key={piece.name}>
              <button
                type="button"
                onClick={() => setFocus(piece)}
                className={cn(
                  "w-full border bg-[#f7f7f9] p-2 text-left",
                  active ? "border-primary" : "border-[#e4e5f3]",
                )}
              >
                <img src={piece.photo} alt={piece.name} className="aspect-square w-full object-contain" />
                <span className="mt-1.5 block text-[12px] font-medium leading-tight text-[#222]">
                  {piece.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <h3 className="mt-4 text-[18px] font-semibold leading-snug text-[#222]">{kit.title}</h3>
      <p className="mt-1 text-[13px] text-[#666]">{kit.subtitle}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-left text-[12px] text-[#666]">
          Roupa
          <select
            value={clothes}
            onChange={(e) => onClothes(e.target.value)}
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
            value={shoes}
            onChange={(e) => onShoes(e.target.value)}
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
        disabled={paying}
        onClick={onBuy}
        className="mt-4 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white disabled:opacity-60"
      >
        {paying && selected ? "Gerando PIX do kit..." : "Quero este kit"}
      </button>
    </article>
  );
}
