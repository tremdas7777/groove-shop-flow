import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckoutShell } from "@/components/CheckoutShell";
import {
  customerFirstName,
  customerName,
  getShippingMethod,
  loadOrder,
  persistOrder,
  updateOrderPix,
  type OrderSummary,
} from "@/lib/checkout";
import { getMagicPayPix } from "@/lib/magicpay";
import { formatBRL } from "@/lib/products";
import { track } from "@/lib/tracking";

export const Route = createFileRoute("/pedido")({
  head: () => ({
    meta: [{ title: "Pedido confirmado — ASICS Brasil" }],
  }),
  component: OrderPage,
});

function OrderPage() {
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderSummary | null>(() =>
    typeof window === "undefined" ? null : loadOrder(),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = loadOrder();
    if (saved) setOrder(saved);
  }, []);

  useEffect(() => {
    const transactionId = order?.pix?.transactionId;
    if (!transactionId || order?.pix?.status === "paid") return;

    let cancelled = false;
    const poll = async () => {
      const result = await getMagicPayPix({ data: { transactionId } });
      if (cancelled || !result.ok) return;
      const next = updateOrderPix(result.pix);
      if (next) {
        if (result.pix.status === "paid" && !next.purchaseTracked) {
          track("purchase", {
            order_id: next.id,
            event_id: next.id,
            value: next.total,
            content_ids: next.items.map((item) => String(item.id)),
            content_name: next.items.map((item) => item.title).join(", "),
          });
          void persistOrder({ ...next, purchaseTracked: true, status: "paid" });
          void navigate({ to: "/obrigado" });
          return;
        }
        setOrder(next);
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [order?.pix?.transactionId, order?.pix?.status, navigate]);

  useEffect(() => {
    if (!order) return;
    const paid = order.status === "paid" || order.pix?.status === "paid";
    if (paid) void navigate({ to: "/obrigado" });
  }, [order, navigate]);

  const copyPix = async () => {
    if (!order?.pix?.qrcode) return;
    try {
      await navigator.clipboard.writeText(order.pix.qrcode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (!order) {
    return (
      <CheckoutShell>
        <h1 className="text-[22px] font-semibold">Nenhum pedido encontrado</h1>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          Voltar à loja
        </Link>
      </CheckoutShell>
    );
  }

  const pixPending = order.data.payment === "pix" && order.pix?.status !== "paid";
  const pixPaid = order.data.payment === "pix" && order.pix?.status === "paid";

  return (
    <CheckoutShell>
      <p className="text-[13px] font-medium uppercase tracking-wide text-primary">
        Pedido {order.id}
      </p>
      <h1 className="mt-2 text-[24px] font-semibold text-[#222] sm:text-[28px]">
        {pixPending ? "Pague com PIX" : "Pedido confirmado"}
      </h1>
      <p className="mt-2 max-w-xl text-[15px] text-[#444]">
        {pixPaid &&
          `Pagamento confirmado. Obrigado, ${customerFirstName(order.data)}. Enviamos os detalhes para ${order.data.email}.`}
        {pixPending &&
          "Escaneie o QR Code ou copie o código no app do seu banco. A página atualiza sozinha quando o pagamento cair."}
      </p>

      {order.pix?.qrcode && pixPending && (
        <section className="mt-8 max-w-md border border-[#e4e5f3] p-5">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(order.pix.qrcode)}`}
            alt="QR Code PIX"
            width={240}
            height={240}
            className="mx-auto h-60 w-60 bg-white"
          />
          <p className="mt-4 text-center text-[13px] text-muted-foreground">
            Valor: {formatBRL(order.total)}
          </p>
          <button
            type="button"
            onClick={() => void copyPix()}
            className="mt-4 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white"
          >
            {copied ? "Código copiado" : "Copiar código PIX"}
          </button>
          <p className="mt-3 break-all text-[11px] leading-relaxed text-[#666]">
            {order.pix.qrcode}
          </p>
        </section>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="border border-[#e4e5f3] p-5">
            <h2 className="text-[15px] font-semibold">Entrega</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#444]">
              {customerName(order.data)}
              <br />
              {order.data.street}, {order.data.number}
              {order.data.complement ? ` — ${order.data.complement}` : ""}
              <br />
              {order.data.neighborhood} · {order.data.city}/{order.data.state}
              <br />
              CEP {order.data.cep}
              <br />
              {getShippingMethod(order.data.shippingMethod).label}
              {" — "}
              {order.shipping === 0 ? "Grátis" : formatBRL(order.shipping)}
              {" · "}
              {getShippingMethod(order.data.shippingMethod).eta}
            </p>
          </section>
          <section className="border border-[#e4e5f3] p-5">
            <h2 className="text-[15px] font-semibold">Pagamento</h2>
            <p className="mt-2 text-[14px] text-[#444]">
              {pixPaid
                ? "PIX — pagamento confirmado pela MagicPay"
                : "PIX — aguardando pagamento"}
            </p>
          </section>
        </div>
        <aside className="h-fit border border-[#e4e5f3] p-5">
          <h2 className="text-[15px] font-semibold">Itens</h2>
          <ul className="mt-3 space-y-3">
            {order.items.map((item) => (
              <li key={`${item.id}-${item.size}`} className="flex gap-3">
                <img src={item.photo} alt="" className="h-14 w-14 object-cover" />
                <div>
                  <p className="text-[13px]">{item.title}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {item.qty}x {formatBRL(item.price)}
                    {item.size ? ` · Tam. ${item.size}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-border pt-3 text-[16px] font-semibold">
            <span>Total</span>
            <span>{formatBRL(order.total)}</span>
          </div>
        </aside>
      </div>

      <Link
        to="/"
        className="mt-8 inline-flex rounded-full bg-primary px-8 py-3 text-[14px] font-semibold text-white"
      >
        Continuar comprando
      </Link>
    </CheckoutShell>
  );
}
