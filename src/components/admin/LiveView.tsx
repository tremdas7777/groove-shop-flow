import { useMemo, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import {
  JOURNEY_STEPS,
  buildLiveSessions,
  eventLabel,
  journeyNextLabel,
  money,
  pageLabel,
  relativeTime,
  sessionDuration,
  sourceLabel,
  type AdminSnapshot,
  type LiveSession,
  type Period,
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
  period,
}: {
  visitors: AdminSnapshot["visitors"];
  events: AdminSnapshot["events"];
  orders: OrderSummary[];
  period: Period;
}) {
  const [filter, setFilter] = useState<StageFilter>("todos");
  const [openId, setOpenId] = useState<string | null>(null);
  const sessions = useMemo(
    () => buildLiveSessions(events, orders, visitors, Date.now(), period),
    [events, orders, visitors, period],
  );
  const visible = sessions.filter((session) => matchesFilter(session, filter));
  const online = sessions.filter((session) => session.online);
  const counts = {
    online: online.length,
    product: sessions.filter((session) => session.stepIndex === 1).length,
    cart: sessions.filter((session) => session.stepIndex === 2).length,
    checkout: sessions.filter((session) => session.stepIndex >= 3 && session.stepIndex <= 5).length,
    pix: sessions.filter((session) => session.stepIndex >= 6 && session.step.id !== "paid").length,
  };
  const feed = [...events].reverse().slice(0, 80);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Live view</h2>
        <p className="text-sm text-white/50">
          O fluxo inteiro fica salvo por até 60 dias. Use o período no topo para ver hoje, 7 dias, 30
          dias ou tudo. Quem está na loja agora aparece como online; o restante é histórico.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <LiveStat label="Online agora" value={String(counts.online)} tone="emerald" />
        <LiveStat label="Pararam no produto" value={String(counts.product)} />
        <LiveStat label="Pararam na sacola" value={String(counts.cart)} />
        <LiveStat label="Pararam no checkout" value={String(counts.checkout)} />
        <LiveStat label="PIX sem pagar" value={String(counts.pix)} tone="gold" />
      </div>

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

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-3">
          {visible.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-white/40">
              Ninguém neste recorte. Troque o período no topo ou abra a loja em outra aba.
            </div>
          )}
          {visible.map((session) => (
            <VisitorCard
              key={session.sessionId}
              session={session}
              open={openId === session.sessionId}
              onToggle={() => setOpenId((prev) => (prev === session.sessionId ? null : session.sessionId))}
            />
          ))}
        </section>

        <section>
          <h3 className="text-sm font-medium text-white/70">Atividade em tempo real</h3>
          <div className="mt-3 space-y-2">
            {feed.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-white/40">
                Os cliques da loja aparecem aqui.
              </div>
            )}
            {feed.map((event) => (
              <div key={event.id} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#E0B761]">{eventLabel(event.name)}</span>
                  <span className="text-[11px] text-white/40">{relativeTime(event.ts)}</span>
                </div>
                <p className="mt-0.5 text-xs text-white/50">
                  {pageLabel(event.path)}
                  {event.props?.["name"] ? ` · ${String(event.props["name"])}` : ""}
                  {event.props?.["email"] ? ` · ${String(event.props["email"])}` : ""}
                  {event.props?.["phone"] ? ` · ${String(event.props["phone"])}` : ""}
                  {event.props?.["content_name"] ? ` · ${String(event.props["content_name"])}` : ""}
                  {` · ${event.device} · ${sourceLabel(event.attribution)}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function LiveStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "gold";
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10182a] p-4">
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
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
}: {
  session: LiveSession;
  open: boolean;
  onToggle: () => void;
}) {
  const progress = ((session.stepIndex + 1) / JOURNEY_STEPS.length) * 100;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full rounded-2xl border border-white/10 bg-[#10182a] p-4 text-left transition hover:border-white/20"
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
          <p className="mt-2 truncate font-medium">
            {session.identity || pageLabel(session.path)}
          </p>
          {session.identity && (
            <p className="mt-0.5 truncate text-xs text-white/50">{pageLabel(session.path)}</p>
          )}
          {session.productName && session.stepIndex > 0 && (
            <p className="mt-0.5 truncate text-xs text-white/50">{session.productName}</p>
          )}
          {(session.email || session.phone) && (
            <p className="mt-1 truncate text-xs text-white/75">
              {[session.email, session.phone].filter(Boolean).join(" · ")}
            </p>
          )}
          {(session.city || session.state) && (
            <p className="truncate text-xs text-white/40">
              {[session.city, session.state].filter(Boolean).join(" / ")}
            </p>
          )}
          <p className="mt-1 text-xs text-white/40">
            {sourceLabel(session.attribution)}
            {session.attribution.utm_campaign ? ` · ${session.attribution.utm_campaign}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs text-white/50">
          <p className="inline-flex items-center gap-1 capitalize">
            <DeviceIcon device={session.device} /> {session.device}
          </p>
          <p className="mt-1">{relativeTime(session.lastTs)}</p>
          {session.value ? <p className="mt-1 text-white/70">{money(session.value)}</p> : null}
        </div>
      </div>

      <JourneyTrack stepIndex={session.stepIndex} />

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-white/45">
        <span>
          {eventLabel(session.lastEvent)} · {Math.round(progress)}% da jornada
        </span>
        <span>{sessionDuration(session.startedAt, session.lastTs)} na loja</span>
      </div>
      {session.step.id !== "paid" && (
        <p className="mt-1 text-[11px] text-white/35">Próximo: {journeyNextLabel(session.stepIndex).toLowerCase()}</p>
      )}

      {open && (
        <ol className="mt-4 space-y-2 border-t border-white/8 pt-3">
          {(session.identity || session.email || session.phone) && (
            <li className="rounded-xl bg-white/6 px-3 py-2 text-xs text-white/80">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#E0B761]">
                Dados digitados
              </span>
              {session.identity && <span className="mt-1 block">{session.identity}</span>}
              {session.email && <span className="block text-white/65">{session.email}</span>}
              {session.phone && <span className="block text-white/65">{session.phone}</span>}
              {(session.city || session.state) && (
                <span className="block text-white/45">
                  {[session.city, session.state].filter(Boolean).join(" / ")}
                </span>
              )}
            </li>
          )}
          {session.events.length === 0 && (
            <li className="text-xs text-white/40">Ainda sem eventos desta sessão.</li>
          )}
          {[...session.events].reverse().slice(0, 12).map((event) => (
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
