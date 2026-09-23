import { useMemo, useState } from "react";
import { Mail, MapPin, MessageCircle, Monitor, Smartphone, Tablet } from "lucide-react";
import {
  JOURNEY_STEPS,
  abandonedStageLabel,
  buildAbandonedCarts,
  eventLabel,
  money,
  pageLabel,
  relativeTime,
  sessionDuration,
  sourceLabel,
  type AbandonedCart,
  type AbandonedStage,
  type AdminSnapshot,
} from "@/lib/admin";
import { shippingMethods, type OrderSummary } from "@/lib/checkout";
import { cn } from "@/lib/utils";

type Filter = "todos" | "contato" | AbandonedStage;

const filters: { id: Filter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "contato", label: "Com contato" },
  { id: "product", label: "Produto" },
  { id: "cart", label: "Sacola" },
  { id: "checkout", label: "Identificação" },
  { id: "identify", label: "Entrega" },
  { id: "shipping", label: "Pagamento" },
  { id: "pix", label: "PIX" },
];

function matches(cart: AbandonedCart, filter: Filter) {
  if (filter === "todos") return true;
  if (filter === "contato") return Boolean(cart.email || cart.phone);
  if (filter === "shipping") return cart.dropOff.id === "shipping" || cart.dropOff.id === "payment";
  return cart.dropOff.id === filter;
}

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

function shippingLabel(id?: string) {
  return shippingMethods.find((method) => method.id === id)?.label ?? id ?? "—";
}

function DeviceIcon({ device }: { device: AbandonedCart["device"] }) {
  const Icon = device === "desktop" ? Monitor : device === "tablet" ? Tablet : Smartphone;
  return <Icon className="h-3.5 w-3.5" />;
}

export function AbandonedCarts({
  events,
  orders,
  visitors,
}: {
  events: AdminSnapshot["events"];
  orders: OrderSummary[];
  visitors: AdminSnapshot["visitors"];
}) {
  const [filter, setFilter] = useState<Filter>("todos");
  const [openId, setOpenId] = useState<string | null>(null);
  const carts = useMemo(
    () => buildAbandonedCarts(events, orders, visitors),
    [events, orders, visitors],
  );
  const visible = carts.filter((cart) => matches(cart, filter));
  const withContact = carts.filter((cart) => cart.email || cart.phone).length;
  const value = carts.reduce((acc, cart) => acc + cart.value, 0);
  const byStage = carts.reduce(
    (acc, cart) => {
      const key = cart.dropOff.id === "payment" ? "shipping" : cart.dropOff.id;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Carrinhos abandonados</h2>
        <p className="text-sm text-white/50">
          Quem digitou qualquer dado no checkout entra aqui na hora. O restante da sacola aparece depois de alguns minutos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Abandonados" value={String(carts.length)} />
        <Stat label="Valor em risco" value={money(value)} tone="gold" />
        <Stat label="Com e-mail ou WhatsApp" value={String(withContact)} />
        <Stat
          label="Maior vazamento"
          value={
            carts.length === 0
              ? "—"
              : abandonedStageLabel(
                  (Object.entries(byStage).sort((a, b) => b[1] - a[1])[0]?.[0] as AbandonedStage) ?? "cart",
                )
          }
        />
      </div>

      {carts.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(["product", "cart", "checkout", "identify", "shipping", "pix"] as AbandonedStage[]).map((id) => {
            const count = id === "shipping" ? (byStage.shipping ?? 0) + (byStage.payment ?? 0) : (byStage[id] ?? 0);
            const sample = carts.find((cart) => matches(cart, id));
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left",
                  filter === id ? "border-[#E0B761]/50 bg-[#E0B761]/10" : "border-white/10 bg-[#10182a] hover:border-white/20",
                )}
              >
                <p className="text-[11px] uppercase tracking-wide text-white/45">{abandonedStageLabel(id)}</p>
                <p className="mt-1 text-lg font-semibold">{count}</p>
                {sample && <p className="mt-1 truncate text-[11px] text-white/40">{sample.dropOff.hint}</p>}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs",
              filter === item.id ? "bg-white text-[#070b14]" : "bg-white/8 text-white/65 hover:bg-white/12",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-white/40">
            Nenhum carrinho abandonado neste recorte. Quem digitar nome, e-mail ou telefone no checkout aparece aqui na hora.
          </div>
        )}
        {visible.map((cart) => (
          <CartCard
            key={cart.sessionId}
            cart={cart}
            open={openId === cart.sessionId}
            onToggle={() => setOpenId((prev) => (prev === cart.sessionId ? null : cart.sessionId))}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gold";
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight", tone === "gold" && "text-[#E0B761]")}>
        {value}
      </p>
    </div>
  );
}

function CartCard({
  cart,
  open,
  onToggle,
}: {
  cart: AbandonedCart;
  open: boolean;
  onToggle: () => void;
}) {
  const preview = cart.items.slice(0, 3);
  return (
    <article className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                {cart.dropOff.label}
              </span>
              {cart.order && (
                <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/55">
                  {cart.order.id}
                </span>
              )}
            </div>
            <p className="mt-2 font-medium">
              {cart.name || cart.email || "Visitante sem identificação"}
            </p>
            <p className="mt-0.5 text-xs text-white/50">{cart.dropOff.hint}</p>
            <p className="mt-1 text-xs text-white/40">
              {sourceLabel(cart.attribution)}
              {cart.attribution.utm_campaign ? ` · ${cart.attribution.utm_campaign}` : ""}
              {` · ${pageLabel(cart.path)}`}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-white/50">
            <p className="inline-flex items-center gap-1 capitalize">
              <DeviceIcon device={cart.device} /> {cart.device}
            </p>
            <p className="mt-1">{relativeTime(cart.lastTs)}</p>
            <p className="mt-1 text-sm font-semibold text-white">{money(cart.value)}</p>
          </div>
        </div>

        {preview.length > 0 && (
          <ul className="mt-3 space-y-2">
            {preview.map((item, index) => (
              <li key={`${item.id}-${item.size}-${index}`} className="flex items-center gap-3 text-sm">
                {item.photo ? (
                  <img src={item.photo} alt="" className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <span className="h-12 w-12 rounded-lg bg-white/8" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1">{item.title}</span>
                  <span className="block text-[11px] text-white/40">
                    {item.qty}x{item.size ? ` · Tam. ${item.size}` : ""} · {money(item.price * item.qty)}
                  </span>
                </span>
              </li>
            ))}
            {cart.items.length > 3 && (
              <li className="text-[11px] text-white/40">+{cart.items.length - 3} item(ns)</li>
            )}
          </ul>
        )}

        <JourneyMini stepIndex={cart.stepIndex} />
        <p className="mt-2 text-[11px] text-white/40">
          {eventLabel(cart.lastEvent)} · {sessionDuration(cart.startedAt, cart.lastTs)} na loja
        </p>
      </button>

      {(cart.email || cart.phone) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {cart.phone && (
            <a
              href={waLink(cart.phone)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 text-xs text-emerald-200 hover:bg-emerald-500/25"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </a>
          )}
          {cart.email && (
            <a
              href={`mailto:${cart.email}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/8 px-3 text-xs text-white/70 hover:bg-white/12"
            >
              <Mail className="h-3.5 w-3.5" />
              {cart.email}
            </a>
          )}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-4 border-t border-white/8 pt-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <Info label="Onde abandonou" value={cart.dropOff.label} />
            <Info label="Última página" value={pageLabel(cart.path)} />
            <Info label="Última ação" value={eventLabel(cart.lastEvent)} />
            <Info label="Há" value={relativeTime(cart.lastTs)} />
            <Info label="Nome" value={cart.name || "—"} />
            <Info label="E-mail" value={cart.email || "—"} />
            <Info label="Telefone" value={cart.phone || "—"} />
            <Info label="Frete" value={shippingLabel(cart.shipping)} />
            <Info
              label="Cidade"
              value={cart.city ? `${cart.city}${cart.state ? `/${cart.state}` : ""}` : "—"}
            />
            <Info label="Origem" value={sourceLabel(cart.attribution)} />
            <Info label="Campanha" value={cart.attribution.utm_campaign || "—"} />
            <Info label="Medium" value={cart.attribution.utm_medium || "—"} />
          </dl>
          {cart.city && (
            <p className="flex items-center gap-1.5 text-xs text-white/45">
              <MapPin className="h-3.5 w-3.5" />
              {cart.city}/{cart.state || "—"}
            </p>
          )}
          {cart.events.length > 0 && (
            <ol className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-white/45">Percurso até sair</p>
              {[...cart.events]
                .reverse()
                .filter((event) => event.name !== "heartbeat")
                .slice(0, 10)
                .map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-xs">
                    <span>
                      <span className="text-white/80">{eventLabel(event.name)}</span>
                      <span className="mt-0.5 block text-white/40">{pageLabel(event.path)}</span>
                    </span>
                    <span className="shrink-0 text-white/35">{relativeTime(event.ts)}</span>
                  </li>
                ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-white/35">{label}</dt>
      <dd className="mt-0.5 break-all text-white/80">{value}</dd>
    </div>
  );
}

function JourneyMini({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="mt-4 flex items-center">
      {JOURNEY_STEPS.map((step, index) => (
        <div key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
          <div
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              index <= stepIndex ? "bg-[#E0B761]" : "bg-white/15",
              index === stepIndex && "ring-2 ring-[#E0B761]/40",
            )}
            title={step.label}
          />
          {index < JOURNEY_STEPS.length - 1 && (
            <div className={cn("mx-0.5 h-0.5 flex-1 rounded-full", index < stepIndex ? "bg-[#E0B761]" : "bg-white/10")} />
          )}
        </div>
      ))}
    </div>
  );
}
