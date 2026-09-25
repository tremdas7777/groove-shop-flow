import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Menu, Search, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AsicsWordmark } from "@/components/Logo";
import { useCart } from "@/lib/cart";
import { formatBRL, products } from "@/lib/products";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Feminino", category: "Feminino" },
  { label: "Masculino", category: "Masculino" },
  { label: "Unisex", category: "Unisex" },
  { label: "Lançamentos", category: "Todos" },
  { label: "Outlet", category: "Outlet" },
] as const;

const OPEN_MENU_EVENT = "asics-open-menu";

export function Header({
  onSelectCategory,
}: {
  onSelectCategory?: (category: string) => void;
}) {
  const { count, setOpen } = useCart();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const open = () => setMenuOpen(true);
    window.addEventListener(OPEN_MENU_EVENT, open);
    return () => window.removeEventListener(OPEN_MENU_EVENT, open);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) => p.titulo.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query]);

  const goCategory = (category: string) => {
    onSelectCategory?.(category);
    setMenuOpen(false);
    void navigate({
      to: "/",
      search: (prev) => ({ ...prev, cat: category === "Todos" ? undefined : category }),
    });
  };

  return (
    <>
      <div className="bg-gold text-gold-foreground">
        <p className="mx-auto max-w-[1280px] px-4 py-1.5 text-center text-[12px] font-medium sm:py-2 sm:text-[13px]">
          <span className="underline underline-offset-2">
            Frete grátis, padrão ou expresso no checkout
          </span>
        </p>
      </div>

      <header className="sticky top-0 z-50 border-b border-[#e4e5f3] bg-white">
        <div className="relative mx-auto grid h-14 max-w-[1280px] grid-cols-[1fr_auto_1fr] items-center px-3 sm:h-16 sm:px-4 lg:flex lg:justify-between">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center justify-self-start lg:hidden"
            aria-label="Abrir menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-6 w-6 text-primary" />
          </button>

          <Link
            to="/"
            search={(prev) => prev}
            className="justify-self-center lg:justify-self-start"
            aria-label="ASICS — ir para a home"
          >
            <AsicsWordmark className="h-7 w-[78px] sm:h-9 sm:w-[100px]" />
          </Link>

          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => goCategory(item.category)}
                className="text-[14px] font-medium text-foreground transition-colors hover:text-primary"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center justify-end justify-self-end gap-1 sm:gap-3">
            <button
              type="button"
              aria-label="Pesquisar produto"
              onClick={() => setSearchOpen(true)}
              className="flex h-11 w-11 items-center justify-center text-primary"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Ver notificações"
              className="relative hidden text-primary sm:inline-flex"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2ea44f] px-1 text-[10px] font-bold text-white">
                4
              </span>
            </button>
            <button
              type="button"
              aria-label="Ver sacola"
              onClick={() => setOpen(true)}
              className="relative flex h-11 w-11 items-center justify-center text-primary"
            >
              <ShoppingBag className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="fixed inset-0 z-[60] bg-white pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex max-w-[720px] flex-col px-4 py-5">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <Search className="h-5 w-5 shrink-0 text-primary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="O que você procura?"
                className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                aria-label="Fechar busca"
                className="flex h-11 w-11 items-center justify-center"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
              >
                <X className="h-5 w-5 text-primary" />
              </button>
            </div>
            <div className="mt-6">
              {results.length === 0 && query.length >= 2 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum produto encontrado.
                </p>
              )}
              <ul className="space-y-3">
                {results.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/produto/$id"
                      params={{ id: String(p.id) }}
                      onClick={() => {
                        setSearchOpen(false);
                        setQuery("");
                      }}
                      className="flex items-center gap-3"
                    >
                      <img
                        src={p.fotos[0]}
                        alt=""
                        className="h-16 w-16 object-cover bg-[#f4f4f4]"
                      />
                      <div>
                        <p className="text-sm font-medium">{p.titulo}</p>
                        <p className="text-sm font-semibold">
                          {formatBRL(p.preco)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-white pt-[env(safe-area-inset-top)] lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-border px-3 sm:h-16 sm:px-4">
            <AsicsWordmark className="h-7 w-[80px]" />
            <button
              type="button"
              aria-label="Fechar menu"
              className="flex h-11 w-11 items-center justify-center"
              onClick={() => setMenuOpen(false)}
            >
              <X className="h-6 w-6 text-primary" />
            </button>
          </div>
          <nav className="flex flex-col px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => goCategory(item.category)}
                className="min-h-12 border-b border-border py-4 text-left text-[16px] font-medium"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setOpen(true);
              }}
              className="border-b border-border py-4 text-left text-[16px] font-medium"
            >
              Minha Sacola
            </button>
          </nav>
        </div>
      )}
    </>
  );
}

export function MobileBottomNav({
  onOpenMenu,
}: {
  onOpenMenu?: () => void;
}) {
  const { count, setOpen } = useCart();
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
      <Link
        to="/"
        search={(prev) => prev}
        aria-label="Ir para a home"
        className="pointer-events-auto flex h-11 w-11 items-center justify-center text-primary"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
          />
        </svg>
      </Link>
      <button
        type="button"
        aria-label="Abrir menu"
        className="pointer-events-auto flex h-11 w-11 items-center justify-center text-primary"
        onClick={() => {
          onOpenMenu?.();
          window.dispatchEvent(new Event(OPEN_MENU_EVENT));
        }}
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Ver sacola"
        onClick={() => setOpen(true)}
        className="pointer-events-auto relative flex h-11 w-11 items-center justify-center text-primary"
      >
        <ShoppingBag className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>
    </nav>
  );
}

export function StoreFooter() {
  return (
    <footer className="mt-10 border-t border-border bg-white pb-8 sm:mt-16 lg:pb-0">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <AsicsWordmark className="h-8 w-[90px]" />
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
            Anima Sana In Corpore Sano. Tênis de corrida, treino e lifestyle para
            movimentar corpo e mente.
          </p>
        </div>
        <div>
          <h2 className="text-[14px] font-semibold">Sobre a ASICS</h2>
          <ul className="mt-3 space-y-2 text-[13px] text-muted-foreground">
            <li>Sustentabilidade</li>
            <li>Tecnologias ASICS</li>
            <li>Trabalhe Conosco</li>
            <li>Termos de Uso</li>
          </ul>
        </div>
        <div>
          <h2 className="text-[14px] font-semibold">Atendimento</h2>
          <ul className="mt-3 space-y-2 text-[13px] text-muted-foreground">
            <li>Central de Relacionamento</li>
            <li>Trocas e Devoluções</li>
            <li>Lojas ASICS</li>
            <li>Política de Privacidade</li>
          </ul>
        </div>
        <div>
          <h2 className="text-[14px] font-semibold">Vá além com OneASICS™</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Quem faz parte do clube, sempre sai ganhando. Acumule bônus em cada
            compra e troque por descontos.
          </p>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Copyright © {new Date().getFullYear()} ASICS. Todos os direitos
            reservados.
          </p>
          <PaymentMarks />
        </div>
      </div>
    </footer>
  );
}

export function PaymentMarks({
  className,
  pixOnly,
}: {
  className?: string;
  pixOnly?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span className="text-[11px] text-muted-foreground">Formas de pagamento:</span>
      {pixOnly ? (
        <span className="text-[11px] font-semibold">PIX</span>
      ) : (
        <>
          <span className="text-[11px] font-semibold tracking-wide">VISA</span>
          <span className="text-[11px] font-semibold">Mastercard</span>
          <span className="text-[11px] font-semibold">Amex</span>
          <span className="text-[11px] font-semibold">Elo</span>
          <span className="text-[11px] font-semibold">PIX</span>
        </>
      )}
    </div>
  );
}
