import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { CheckoutShell } from "@/components/CheckoutShell";
import { useCart } from "@/lib/cart";
import {
  emptyCheckout,
  fetchCep,
  getShippingMethod,
  loadCheckoutDraft,
  maskCep,
  maskCpf,
  maskPhone,
  persistOrder,
  saveCheckoutDraft,
  shippingMethods,
  splitCustomerName,
  type CheckoutData,
  type OrderSummary,
} from "@/lib/checkout";
import { createMagicPayPix } from "@/lib/magicpay";
import {
  formatBRL,
  getProduct,
  parsePrice,
} from "@/lib/products";
import { pingStorePresence } from "@/lib/live-ping";
import { getAttribution, getSessionId, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Finalizar compra — ASICS Brasil" },
      {
        name: "description",
        content: "Identificação, entrega e pagamento com a experiência ASICS.",
      },
    ],
  }),
  component: CheckoutPage,
});

type Step = "identificacao" | "entrega" | "pagamento";

const steps: { id: Step; label: string }[] = [
  { id: "identificacao", label: "Identificação" },
  { id: "entrega", label: "Entrega" },
  { id: "pagamento", label: "Pagamento" },
];

function CheckoutPage() {
  const { items, clear } = useCart();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("identificacao");
  const [data, setData] = useState<CheckoutData>(emptyCheckout);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cepLoading, setCepLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  const began = useRef(false);

  useEffect(() => {
    const draft = loadCheckoutDraft();
    setData({ ...draft, payment: "pix" });
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveCheckoutDraft(data);
  }, [data, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      pingStorePresence({
        email: data.email.trim() || undefined,
        name: data.name.trim() || undefined,
        phone: data.phone.trim() || undefined,
        city: data.city.trim() || undefined,
        state: data.state.trim() || undefined,
        shipping: data.shippingMethod || undefined,
        lastEvent: "begin_checkout",
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [ready, data.email, data.name, data.phone, data.city, data.state, data.shippingMethod, items]);

  const detailed = items
    .map((i) => ({ item: i, product: getProduct(i.id) }))
    .filter((d) => d.product);

  const subtotal = detailed.reduce(
    (acc, d) => acc + parsePrice(d.product!.preco) * d.item.qty,
    0,
  );
  const compare = detailed.reduce(
    (acc, d) =>
      acc +
      Math.max(parsePrice(d.product!.preco_comparacao), parsePrice(d.product!.preco)) *
        d.item.qty,
    0,
  );
  const productDiscount = Math.max(0, compare - subtotal);
  const shippingOption = getShippingMethod(data.shippingMethod);
  const shipping = shippingOption.price;
  const total = Math.max(0, subtotal + shipping);

  useEffect(() => {
    if (!ready || began.current || items.length === 0) return;
    began.current = true;
    track("begin_checkout", {
      value: subtotal,
      content_ids: detailed.map((d) => String(d.item.id)),
    });
  }, [ready, items, subtotal, detailed]);

  const patch = (partial: Partial<CheckoutData>) =>
    setData((prev) => ({ ...prev, ...partial }));

  const validateId = () => {
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) next.email = "Informe um e-mail válido";
    if (data.name.trim().split(/\s+/).filter(Boolean).length < 2) {
      next.name = "Informe o nome completo";
    }
    if (data.cpf.replace(/\D/g, "").length !== 11) next.cpf = "Informe um CPF válido";
    if (data.phone.replace(/\D/g, "").length < 10) next.phone = "Informe um telefone válido";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validateShip = () => {
    const next: Record<string, string> = {};
    if (data.cep.replace(/\D/g, "").length !== 8) next.cep = "Informe um CEP válido";
    if (data.street.trim().length < 2) next.street = "Informe o endereço";
    if (!data.number.trim()) next.number = "Informe o número";
    if (data.neighborhood.trim().length < 2) next.neighborhood = "Informe o bairro";
    if (data.city.trim().length < 2) next.city = "Informe a cidade";
    if (data.state.trim().length !== 2) next.state = "UF";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validatePay = () => {
    setErrors({});
    return true;
  };

  const onCep = async (value: string) => {
    const masked = maskCep(value);
    patch({ cep: masked });
    if (masked.replace(/\D/g, "").length === 8) {
      setCepLoading(true);
      const result = await fetchCep(masked);
      setCepLoading(false);
      if (result) {
        patch({
          cep: masked,
          street: result.logradouro,
          neighborhood: result.bairro,
          city: result.localidade,
          state: result.uf,
          complement: result.complemento,
        });
      }
    }
  };

  const finish = async () => {
    if (!validatePay()) return;
    setPayError("");
    const orderId = `PD${Date.now().toString().slice(-8)}`;
    const orderItems = detailed.map(({ item, product }) => ({
      id: item.id,
      size: item.size,
      qty: item.qty,
      title: product!.titulo,
      price: parsePrice(product!.preco),
      photo: product!.fotos[0],
    }));
    const nameParts = splitCustomerName(data.name);
    const checkoutData: CheckoutData = {
      ...data,
      name: data.name.trim(),
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      payment: "pix",
    };
    const order = {
      id: orderId,
      createdAt: new Date().toISOString(),
      data: checkoutData,
      items: orderItems,
      subtotal,
      shipping,
      discount: productDiscount,
      total,
      status: "pending" as const,
    };

    if (checkoutData.payment === "pix") {
      setPaying(true);
      const amountCents = Math.round(total * 100);
      const shippingCents = Math.round(shipping * 100);
      const goodsCents = Math.max(0, amountCents - shippingCents);
      const weights = orderItems.map((item) => item.price * item.qty);
      const weightTotal = weights.reduce((acc, n) => acc + n, 0) || 1;
      let allocated = 0;
      const pixItems = orderItems.map((item, index) => {
        const share =
          index === orderItems.length - 1
            ? goodsCents - allocated
            : Math.round((weights[index] / weightTotal) * goodsCents);
        allocated += share;
        return {
          title: item.title,
          unitPrice: Math.max(0, Math.round(share / item.qty)),
          quantity: item.qty,
          externalRef: String(item.id),
        };
      });

      const pendingOrder: OrderSummary = {
        ...order,
        attribution: getAttribution(),
        sessionId: getSessionId(),
      };
      try {
        const result = await createMagicPayPix({
          data: {
            orderId,
            amountCents,
            shippingCents,
            customer: {
              name: checkoutData.name,
              email: checkoutData.email,
              phone: checkoutData.phone,
              cpf: checkoutData.cpf,
            },
            address: {
              street: checkoutData.street,
              streetNumber: checkoutData.number,
              neighborhood: checkoutData.neighborhood,
              city: checkoutData.city,
              state: checkoutData.state,
              zipCode: checkoutData.cep,
              complement: checkoutData.complement,
            },
            items: pixItems,
            order: pendingOrder,
          },
        });
        if (!result.ok) {
          setPayError(result.error);
          return;
        }
        await persistOrder({ ...pendingOrder, pix: result.pix });
        track("generate_pix", {
          order_id: orderId,
          value: total,
          content_ids: orderItems.map((item) => String(item.id)),
          email: checkoutData.email,
          name: checkoutData.name,
          phone: checkoutData.phone,
          city: checkoutData.city,
          state: checkoutData.state,
          shipping: checkoutData.shippingMethod,
        });
      } catch (error) {
        setPayError(
          error instanceof Error ? error.message : "Não foi possível gerar o PIX. Tente de novo.",
        );
        return;
      } finally {
        setPaying(false);
      }
    } else {
      await persistOrder(order);
    }

    void navigate({ to: "/pedido" });
    window.setTimeout(() => clear(), 50);
  };

  const empty = ready && detailed.length === 0;

  const summary = useMemo(
    () => (
      <aside className="h-fit border border-[#e4e5f3] p-5">
        <h2 className="text-[16px] font-semibold">Resumo do pedido</h2>
        <ul className="mt-4 space-y-3">
          {detailed.map(({ item, product }) => (
            <li key={`${item.id}-${item.size}`} className="flex gap-3">
              <img
                src={product!.fotos[0]}
                alt=""
                className="h-16 w-16 bg-[#f4f4f4] object-cover"
              />
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13px]">{product!.titulo}</p>
                {item.size && (
                  <p className="text-[12px] text-muted-foreground">Tam. {item.size}</p>
                )}
                <p className="text-[13px] font-semibold">
                  {item.qty}x {formatBRL(product!.preco)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-2 text-[14px]">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatBRL(subtotal + productDiscount)}</dd>
          </div>
          {productDiscount > 0 && (
            <div className="flex justify-between text-primary">
              <dt>Descontos</dt>
              <dd>-{formatBRL(productDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Frete</dt>
            <dd>{shipping === 0 ? "Grátis" : formatBRL(shipping)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-[16px] font-semibold">
            <dt>Total</dt>
            <dd>{formatBRL(total)}</dd>
          </div>
        </dl>
        <Link
          to="/carrinho"
          className="mt-4 inline-block text-[13px] text-primary underline underline-offset-2"
        >
          Voltar para o carrinho
        </Link>
      </aside>
    ),
    [detailed, productDiscount, shipping, subtotal, total],
  );

  if (!ready) return <CheckoutShell><p className="text-sm text-muted-foreground">Carregando...</p></CheckoutShell>;

  if (empty) {
    return (
      <CheckoutShell>
        <h1 className="text-[24px] font-bold text-[#222]">Finalizar compra</h1>
        <p className="mt-4 text-[14px] text-[#333]">
          Sua sacola está vazia. Escolha um produto para continuar.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-full bg-primary px-8 py-3 text-[14px] font-semibold text-white"
        >
          Escolher produtos
        </Link>
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell>
      <ol className="mb-6 flex flex-wrap items-center gap-1.5 text-[12px] sm:mb-8 sm:gap-2 sm:text-[13px]">
        {steps.map((s, i) => {
          const active = s.id === step;
          const done = steps.findIndex((x) => x.id === step) > i;
          return (
            <li key={s.id} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => {
                  if (done) setStep(s.id);
                }}
                className={cn(
                  "font-medium",
                  active ? "text-primary" : done ? "text-[#222]" : "text-muted-foreground",
                )}
              >
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          {step === "identificacao" && (
            <section>
              <h1 className="text-[20px] font-semibold leading-snug text-[#222] sm:text-[22px]">
                Para finalizar a compra, informe seu e-mail.
              </h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Rápido. Fácil. Seguro.
              </p>
              <h2 className="mt-6 text-[14px] font-semibold">
                Usamos seu e-mail de forma 100% segura para:
              </h2>
              <ul className="mt-2 space-y-1 text-[13px] text-[#444]">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-primary" /> Identificar seu perfil
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-primary" /> Notificar sobre o andamento do seu pedido
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-primary" /> Gerenciar seu histórico de compras
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-primary" /> Acelerar o preenchimento de suas informações
                </li>
              </ul>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <Field
                  className="sm:col-span-2"
                  label="E-mail"
                  value={data.email}
                  error={errors.email}
                  onChange={(v) => patch({ email: v })}
                  type="email"
                />
                <Field
                  className="sm:col-span-2"
                  label="Nome completo"
                  value={data.name}
                  error={errors.name}
                  onChange={(v) => {
                    const parts = splitCustomerName(v);
                    patch({ name: v, firstName: parts.firstName, lastName: parts.lastName });
                  }}
                />
                <Field
                  label="CPF"
                  value={data.cpf}
                  error={errors.cpf}
                  onChange={(v) => patch({ cpf: maskCpf(v) })}
                  inputMode="numeric"
                />
                <Field
                  label="Telefone"
                  value={data.phone}
                  error={errors.phone}
                  onChange={(v) => patch({ phone: maskPhone(v) })}
                  inputMode="tel"
                />
              </div>

              <label className="mt-5 flex items-start gap-2 text-[13px] text-[#444]">
                <input
                  type="checkbox"
                  checked={data.newsletter}
                  onChange={(e) => patch({ newsletter: e.target.checked })}
                  className="mt-0.5"
                />
                Quero receber e-mails com promoções.
              </label>

              <button
                type="button"
                onClick={() => {
                  if (validateId()) {
                    track("checkout_identify", {
                      email: data.email,
                      name: data.name.trim(),
                      phone: data.phone,
                      value: total,
                    });
                    setStep("entrega");
                  }
                }}
                className="mt-8 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white sm:w-auto sm:px-10"
              >
                Ir para a Entrega
              </button>
            </section>
          )}

          {step === "entrega" && (
            <section>
              <h1 className="text-[22px] font-semibold text-[#222]">Entrega</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Informe o CEP para calcular o prazo e o valor do frete.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-6">
                <Field
                  className="sm:col-span-2"
                  label="CEP"
                  value={data.cep}
                  error={errors.cep}
                  onChange={onCep}
                  inputMode="numeric"
                />
                <div className="flex items-end sm:col-span-4">
                  <a
                    href="https://buscacepinter.correios.com.br/app/endereco/index.php"
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 text-[13px] text-primary underline"
                  >
                    Não sei meu CEP
                  </a>
                </div>
                <Field
                  className="sm:col-span-4"
                  label="Endereço"
                  value={data.street}
                  error={errors.street}
                  onChange={(v) => patch({ street: v })}
                />
                <Field
                  className="sm:col-span-2"
                  label="Número"
                  value={data.number}
                  error={errors.number}
                  onChange={(v) => patch({ number: v })}
                />
                <Field
                  className="sm:col-span-3"
                  label="Complemento"
                  value={data.complement}
                  onChange={(v) => patch({ complement: v })}
                />
                <Field
                  className="sm:col-span-3"
                  label="Bairro"
                  value={data.neighborhood}
                  error={errors.neighborhood}
                  onChange={(v) => patch({ neighborhood: v })}
                />
                <Field
                  className="sm:col-span-4"
                  label="Cidade"
                  value={data.city}
                  error={errors.city}
                  onChange={(v) => patch({ city: v })}
                />
                <Field
                  className="sm:col-span-2"
                  label="UF"
                  value={data.state}
                  error={errors.state}
                  onChange={(v) => patch({ state: v.toUpperCase().slice(0, 2) })}
                />
              </div>
              {cepLoading && (
                <p className="mt-2 text-[12px] text-muted-foreground">Buscando CEP...</p>
              )}

              <div className="mt-6 space-y-3">
                {shippingMethods.map((method) => (
                  <label
                    key={method.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between border p-4",
                      data.shippingMethod === method.id
                        ? "border-primary"
                        : "border-[#e4e5f3]",
                    )}
                  >
                    <span className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="shipping"
                        checked={data.shippingMethod === method.id}
                        onChange={() => patch({ shippingMethod: method.id })}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-[14px] font-semibold">
                          {method.label}
                        </span>
                        <span className="text-[13px] text-muted-foreground">
                          {method.eta}
                        </span>
                      </span>
                    </span>
                    <span className="text-[14px] font-semibold">
                      {method.price === 0 ? "Grátis" : formatBRL(method.price)}
                    </span>
                  </label>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (validateShip()) {
                    track("checkout_shipping", {
                      shipping: data.shippingMethod,
                      city: data.city,
                      state: data.state,
                      name: data.name.trim(),
                      email: data.email,
                      phone: data.phone,
                      value: total,
                    });
                    track("checkout_payment", {
                      shipping: data.shippingMethod,
                      city: data.city,
                      name: data.name.trim(),
                      email: data.email,
                      phone: data.phone,
                      value: total,
                    });
                    setStep("pagamento");
                  }
                }}
                className="mt-8 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white sm:w-auto sm:px-10"
              >
                Ir para o Pagamento
              </button>
            </section>
          )}

          {step === "pagamento" && (
            <section>
              <h1 className="text-[22px] font-semibold text-[#222]">Pagamento</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Pagamento exclusivo via PIX.
              </p>

              <div className="mt-6">
                <PayOption
                  active
                  onSelect={() => patch({ payment: "pix" })}
                  title="PIX"
                  subtitle={formatBRL(total)}
                />
              </div>

              {payError && (
                <p className="mt-4 text-[13px] text-destructive">{payError}</p>
              )}

              <button
                type="button"
                onClick={() => void finish()}
                disabled={paying}
                className="mt-8 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-white disabled:opacity-60"
              >
                {paying ? "Gerando PIX..." : "Finalizar compra"}
              </button>
            </section>
          )}
        </div>
        {summary}
      </div>
    </CheckoutShell>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  className,
  type = "text",
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
  type?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[12px] font-medium text-[#666]">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-11 w-full border-b bg-transparent text-[15px] outline-none",
          error ? "border-destructive" : "border-[#ccc] focus:border-primary",
        )}
      />
      {error && <span className="mt-1 block text-[12px] text-destructive">{error}</span>}
    </label>
  );
}

function PayOption({
  active,
  onSelect,
  title,
  subtitle,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between border p-4 text-left",
        active ? "border-primary" : "border-[#e4e5f3]",
      )}
    >
      <span>
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full border",
          active ? "border-primary" : "border-[#ccc]",
        )}
      >
        {active && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
    </button>
  );
}
