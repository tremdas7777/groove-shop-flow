import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CheckoutShell } from "@/components/CheckoutShell";
import { customerFirstName, loadOrder, persistOrder, type OrderSummary } from "@/lib/checkout";
import { runningKits, type RunningKit } from "@/lib/kits";
import { createMagicPayPix } from "@/lib/magicpay";
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
      value: kit.price,
      content_ids: [String(kit.id)],
      content_name: kit.title,
      upsell: true,
      parent_order_id: order.id,
    });
    const result = await createMagicPayPix({
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
    });
    setPaying(false);
    if (!result.ok) {
      setPayError(result.error || "Não gerou o PIX do kit. Tente de novo.");
      return;
    }
    await persistOrder({ ...upsellOrder, pix: result.pix, status: "pending" }, true);
    void navigate({ to: "/pedido" });
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
                  disabled={paying}
                  onClick={() => void chooseKit(kit)}
                  className="mt-4 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white disabled:opacity-60"
                >
                  {paying && picked === kit.id ? "Gerando PIX do kit..." : "Quero este kit"}
                </button>
              </article>
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
