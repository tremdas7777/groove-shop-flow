import { useEffect, useState } from "react";
import { RefreshCw, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import {
  getZedyCatalogStatus,
  listZedyWebhookOrders,
  type ZedyWebhookOrder,
} from "@/lib/zedy-server";
import { formatBRL } from "@/lib/products";
import { cn } from "@/lib/utils";

type CatalogStatus = Awaited<ReturnType<typeof getZedyCatalogStatus>>;

function statusLabel(status: string) {
  const map: Record<string, string> = {
    paid: "Pago",
    refused: "Recusado",
    refunded: "Reembolsado",
    abandoned: "Abandonado",
    waiting_payment: "Aguardando",
  };
  return map[status] ?? status;
}

export function ZedyPanel() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [orders, setOrders] = useState<ZedyWebhookOrder[]>([]);
  const [abandoned, setAbandoned] = useState<ZedyWebhookOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [showOnlyMissing, setShowOnlyMissing] = useState(true);

  const load = async () => {
    setBusy(true);
    try {
      const [catalog, webhook] = await Promise.all([
        getZedyCatalogStatus(),
        listZedyWebhookOrders(),
      ]);
      setStatus(catalog);
      setOrders(webhook.orders);
      setAbandoned(webhook.abandoned);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar Zedy.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = showOnlyMissing
    ? status?.unmatched ?? []
    : status?.mapped ?? [];

  const matchedCount = status?.mapped.filter((p) => p.ok).length ?? 0;
  const missingCount = status?.unmatched.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Loja Zedy</h2>
          <p className="mt-1 text-sm text-white/50">
            Mapeamento de variantes, checkout externo e pedidos do webhook.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
          Atualizar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="API configurada"
          value={status?.configured ? "Sim" : "Não"}
          tone={status?.configured ? "ok" : "bad"}
        />
        <Stat label="Produtos no catálogo Zedy" value={String(status?.catalogCount ?? "—")} />
        <Stat label="Relacionados OK" value={String(matchedCount)} tone="ok" />
        <Stat
          label="Sem match"
          value={String(missingCount)}
          tone={missingCount ? "bad" : "ok"}
        />
      </div>

      {!status?.configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Cadastre <code className="text-amber-50">ZEDY_API_TOKEN</code>,{" "}
          <code className="text-amber-50">ZEDY_STORE_ID</code> e{" "}
          <code className="text-amber-50">ZEDY_WEBHOOK_TOKEN</code> nos secrets do ambiente
          (Lovable / host). Nunca no frontend.
        </div>
      )}

      {status?.catalogError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {status.catalogError}
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
        <p className="font-medium text-white">Webhook público</p>
        <p className="mt-1 break-all font-mono text-[12px] text-white/80">
          https://asicsoficial.com/api/public/zedy-webhook
        </p>
        <p className="mt-2 text-white/50">
          Webhook token:{" "}
          {status?.webhookTokenConfigured ? "configurado" : "ainda não cadastrado"}
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Produtos × variantes Zedy</h3>
          <label className="flex items-center gap-2 text-sm text-white/60">
            <input
              type="checkbox"
              checked={showOnlyMissing}
              onChange={(e) => setShowOnlyMissing(e.target.checked)}
            />
            Só sem match
          </label>
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-white/50">
              <tr>
                <th className="px-3 py-2 font-medium">Produto</th>
                <th className="px-3 py-2 font-medium">Tamanho</th>
                <th className="px-3 py-2 font-medium">SKU hint</th>
                <th className="px-3 py-2 font-medium">variantId</th>
                <th className="px-3 py-2 font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((product) =>
                product.variants.map((v) => (
                  <tr
                    key={`${product.productId}-${v.size}`}
                    className="border-t border-white/5"
                  >
                    <td className="max-w-[240px] px-3 py-2">
                      <p className="line-clamp-2">{product.title}</p>
                      <p className="text-[11px] text-white/40">#{product.productId}</p>
                    </td>
                    <td className="px-3 py-2">{v.size}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{v.skuHint}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {v.variantId ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px]",
                          v.ok
                            ? "bg-emerald-500/20 text-emerald-200"
                            : "bg-red-500/20 text-red-200",
                        )}
                      >
                        {v.ok ? v.matchedBy : "não encontrado"}
                      </span>
                    </td>
                  </tr>
                )),
              )}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-white/40">
                    {busy
                      ? "Carregando…"
                      : showOnlyMissing
                        ? "Todos os produtos estão relacionados."
                        : "Sem dados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium">
          <ShoppingBag className="h-4 w-4" />
          Pedidos e eventos do webhook
        </h3>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-white/50">
              <tr>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Evento</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Recebido</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.rawEventKey} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-[12px]">{o.orderId}</td>
                  <td className="px-3 py-2">{o.eventType}</td>
                  <td className="px-3 py-2">{statusLabel(o.status)}</td>
                  <td className="px-3 py-2">
                    {o.customer?.name || o.customer?.email || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {o.commission?.totalPriceInCents != null
                      ? formatBRL(o.commission.totalPriceInCents / 100)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-white/50">
                    {new Date(o.receivedAt).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-white/40">
                    Nenhum evento recebido ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {abandoned.length > 0 && (
          <p className="text-sm text-white/50">
            Carrinhos abandonados / Pix ou boleto pendente: {abandoned.length}
          </p>
        )}
      </section>
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
  tone?: "ok" | "bad";
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-white/40">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "ok" && "text-emerald-300",
          tone === "bad" && "text-red-300",
        )}
      >
        {value}
      </p>
    </div>
  );
}
