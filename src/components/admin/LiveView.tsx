import { useMemo, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  JOURNEY_STEPS,
  LIVE_WINDOWS,
  buildLiveSessions,
  eventLabel,
  inLiveWindow,
  journeyNextLabel,
  money,
  pageLabel,
  relativeTime,
  sessionDuration,
  sourceLabel,
  summarizeLiveWindow,
  type AdminSnapshot,
  type LiveSession,
  type LiveWindowId,
} from "@/lib/admin";
import type { OrderSummary } from "@/lib/checkout";
import { cn } from "@/lib/utils";

type StageFilter = "todos" | "online" | "product" | "cart" | "checkout" | "pix";

const filters: { id: StageFilter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "online", label: "Online" },
  { id: "product", label: "Produto" },
  { id: "cart", label: "Sacola" },
  { id: "checkout", label: "Checkout" },
  { id: "pix", label: "PIX" },
];

function matchesFilter(session: LiveSession, filter: StageFilter) {
  if (filter === "todos") return true;
  if (filter === "online") return session.online;
  if (filter === "product") return session.stepIndex === 1;
  if (filter === "cart") return session.stepIndex === 2;
  if (filter === "checkout") return session.stepIndex >= 3 && session.stepIndex <= 5;
  return session.stepIndex >= 6;
}

function DeviceIcon({ device }: { device: LiveSession["device"] }) {
  const Icon = device === "desktop" ? Monitor : device === "tablet" ? Tablet : Smartphone;
  return <Icon className="h-3.5 w-3.5" />;
}

export function LiveView({
  visitors,
  events,
  orders,
}: {
  visitors: AdminSnapshot["visitors"];
  events: AdminSnapshot["events"];
  orders: OrderSummary[];
}) {
  const [windowId, setWindowId] = useState<LiveWindowId>("30m");
  const [filter, setFilter] = useState<StageFilter>("todos");
  const [openId, setOpenId] = useState<string | null>(null);
  const sessions = useMemo(
    () => buildLiveSessions(events, orders, visitors),
    [events, orders, visitors],
  );
  const windows = LIVE_WINDOWS.map((item) => ({
    ...item,
    stats: summarizeLiveWindow(sessions, item.ms),
  }));
  const selected = windows.find((item) => item.id === windowId) ?? windows[windows.length - 1];
  const scoped = selected.stats.sessions;
  const visible = scoped.filter((session) => matchesFilter(session, filter));
  const checkoutNow = visible.filter(
    (session) => session.online && session.stepIndex >= 3 && session.stepIndex <= 6,
  );
  const others = visible.filter((session) => !checkoutNow.some((item) => item.sessionId === session.sessionId));
  const stats = selected.stats;
  const chart = windows.map((item) => ({
    janela: item.label,
    visitantes: item.stats.visitors,
    online: item.stats.online,
    checkout: item.stats.checkout,
    pix: item.stats.pix,
  }));
  const feed = [...events]
    .filter((event) => inLiveWindow(event.ts, selected.ms))
    .reverse()
    .slice(0, 40);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Live view geral</h2>
          <p className="text-sm text-white/50">Últimos {selected.label} na loja.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-full bg-white/6 p-1">
          {windows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setWindowId(item.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold",
                item.id === windowId ? "bg-[#E0B761] text-[#001E62]" : "text-white/65 hover:bg-white/8",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Online agora" value={stats.online} tone="emerald" />
        <Kpi label="Na loja" value={stats.visitors} />
        <Kpi label="Com dados" value={stats.leads} tone="gold" />
        <Kpi label="No checkout" value={stats.checkout} />
        <Kpi label="PIX sem pagar" value={stats.pix} tone="gold" className="col-span-2 lg:col-span-1" />
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">
          Comparativo 5 · 10 · 15 · 30 min
        </p>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chart}
              barGap={2}
              onClick={(state) => {
                const label = String(state?.activeLabel ?? "");
                const match = LIVE_WINDOWS.find((item) => item.label === label);
                if (match) setWindowId(match.id);
              }}
            >
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="janela" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "#10182a",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                }}
              />
              <Bar dataKey="visitantes" name="Na loja" fill="#7dd3fc" radius={[4, 4, 0, 0]} />
              <Bar dataKey="online" name="Online" fill="#6ee7b7" radius={[4, 4, 0, 0]} />
              <Bar dataKey="checkout" name="Checkout" fill="#E0B761" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pix" name="PIX" fill="#fde68a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              Pessoas
              <span className="ml-2 font-normal text-white/40">
                {visible.length} neste recorte
              </span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px]",
                    filter === item.id ? "bg-white text-[#070b14]" : "bg-white/8 text-white/60 hover:bg-white/12",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {visible.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-white/40">
                Ninguém neste recorte. Troque para 15 ou 30 min.
              </div>
            )}
            {checkoutNow.length > 0 && (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#E0B761]">
                  No checkout agora
                </p>
                {checkoutNow.map((session) => (
                  <VisitorCard
                    key={session.sessionId}
                    session={session}
                    open={openId === session.sessionId}
                    onToggle={() => setOpenId((prev) => (prev === session.sessionId ? null : session.sessionId))}
                    highlight
                  />
                ))}
              </div>
            )}
            {others.map((session) => (
              <VisitorCard
                key={session.sessionId}
                session={session}
                open={openId === session.sessionId}
                onToggle={() => setOpenId((prev) => (prev === session.sessionId ? null : session.sessionId))}
              />
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-white">Atividade</h3>
          <div className="space-y-2">
            {feed.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-white/40">
                Os cliques da loja aparecem aqui.
              </div>
            )}
            {feed.map((event) => (
              <div key={event.id} className="rounded-xl border border-white/8 bg-[#10182a] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#E0B761]">{eventLabel(event.name)}</span>
                  <span className="shrink-0 text-[11px] text-white/40">{relativeTime(event.ts)}</span>
                </div>
                <p className="mt-0.5 text-xs text-white/70">
                  {typeof event.props?.name === "string" && event.props.name
                    ? event.props.name
                    : pageLabel(event.path)}
                </p>
                {(event.props?.email || event.props?.phone) && (
                  <p className="mt-0.5 text-xs text-white/50">
                    {[event.props?.email, event.props?.phone].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "gold";
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-white/10 bg-[#10182a] px-4 py-4", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{label}</p>
      <p
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight",
          tone === "emerald" && "text-emerald-300",
          tone === "gold" && "text-[#E0B761]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function VisitorCard({
  session,
  open,
  onToggle,
  highlight,
}: {
  session: LiveSession;
  open: boolean;
  onToggle: () => void;
  highlight?: boolean;
}) {
  const inCheckout = session.stepIndex >= 3 && session.stepIndex <= 6;
  const showBag = Boolean(session.cartItems?.length) || inCheckout;
  const contact = [session.email, session.phone].filter(Boolean).join(" · ");
  const place = [session.city, session.state].filter(Boolean).join(" / ");
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full rounded-2xl border p-4 text-left transition",
        highlight
          ? "border-[#E0B761]/50 bg-[#E0B761]/8 hover:border-[#E0B761]/70"
          : "border-white/10 bg-[#10182a] hover:border-white/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                session.online ? "bg-emerald-500/15 text-emerald-300" : "bg-white/8 text-white/45",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", session.online ? "bg-emerald-400" : "bg-white/30")} />
              {session.online ? "Online" : "Saiu"}
            </span>
            <span className="rounded-full bg-[#E0B761]/15 px-2 py-0.5 text-[10px] font-semibold text-[#E0B761]">
              {session.step.short}
            </span>
          </div>
          <p className="mt-2 truncate text-lg font-semibold">
            {session.identity || (inCheckout ? "Digitando no checkout" : "Visitante")}
          </p>
          {contact ? (
            <p className="mt-1 truncate text-sm text-white/90">{contact}</p>
          ) : (
            <p className="mt-1 text-sm text-white/35">Ainda sem e-mail ou telefone</p>
          )}
          {place && <p className="mt-0.5 truncate text-xs text-white/50">{place}</p>}
        </div>
        <div className="shrink-0 text-right">
          {session.value ? <p className="text-lg font-semibold text-[#E0B761]">{money(session.value)}</p> : null}
          <p className="mt-1 text-xs text-white/50">{relativeTime(session.lastTs)}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs capitalize text-white/40">
            <DeviceIcon device={session.device} /> {session.device}
          </p>
        </div>
      </div>

      {showBag && (
        <div className="mt-3 space-y-2 border-t border-white/8 pt-3">
          {(session.cartItems ?? []).map((item, index) => (
            <div key={`${item.id}-${item.size}-${index}`} className="flex items-center gap-3">
              {item.photo ? (
                <img src={item.photo} alt="" className="h-12 w-12 rounded-lg object-cover" />
              ) : (
                <span className="h-12 w-12 rounded-lg bg-white/8" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{item.title}</p>
                <p className="text-[11px] text-white/45">
                  {item.qty}x{item.size ? ` · Tam. ${item.size}` : ""} · {money(item.price)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium text-white">{money(item.price * item.qty)}</p>
            </div>
          ))}
          {session.value ? (
            <div className="flex items-center justify-between pt-1 text-sm">
              <span className="text-white/50">Total</span>
              <span className="font-semibold text-[#E0B761]">{money(session.value)}</span>
            </div>
          ) : null}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-white/8 pt-3">
          <JourneyTrack stepIndex={session.stepIndex} />
          <p className="text-[11px] text-white/40">
            {eventLabel(session.lastEvent)} · {sessionDuration(session.startedAt, session.lastTs)} na loja
            {session.step.id !== "paid" ? ` · próximo: ${journeyNextLabel(session.stepIndex).toLowerCase()}` : ""}
          </p>
          <p className="text-[11px] text-white/35">
            {sourceLabel(session.attribution)}
            {session.attribution.utm_campaign ? ` · ${session.attribution.utm_campaign}` : ""}
          </p>
          <ol className="space-y-2">
            {session.events.length === 0 && (
              <li className="text-xs text-white/40">Ainda sem eventos desta sessão.</li>
            )}
            {[...session.events].reverse().slice(0, 8).map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-white/80">{eventLabel(event.name)}</span>
                <span className="shrink-0 text-white/35">{relativeTime(event.ts)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </button>
  );
}

function JourneyTrack({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="mt-4">
      <div className="flex items-center">
        {JOURNEY_STEPS.map((step, index) => {
          const done = index <= stepIndex;
          const current = index === stepIndex;
          return (
            <div key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  done ? "bg-[#E0B761] text-[#001E62]" : "bg-white/10 text-white/35",
                  current && "ring-2 ring-[#E0B761]/50",
                )}
                title={step.label}
              >
                {index + 1}
              </div>
              {index < JOURNEY_STEPS.length - 1 && (
                <div className={cn("mx-1 h-0.5 flex-1 rounded-full", index < stepIndex ? "bg-[#E0B761]" : "bg-white/10")} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 hidden justify-between gap-1 sm:flex">
        {JOURNEY_STEPS.map((step, index) => (
          <span
            key={step.id}
            className={cn(
              "min-w-0 flex-1 truncate text-[9px] uppercase tracking-wide",
              index === 0 ? "text-left" : index === JOURNEY_STEPS.length - 1 ? "text-right" : "text-center",
              index <= stepIndex ? "text-white/70" : "text-white/30",
            )}
          >
            {step.short}
          </span>
        ))}
      </div>
    </div>
  );
}
