import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Header, MobileBottomNav, StoreFooter } from "@/components/Header";

function hideMobileNav(path: string) {
  const p = path.toLowerCase();
  return (
    p.startsWith("/produto") ||
    p.startsWith("/checkout") ||
    p.startsWith("/pedido") ||
    p.startsWith("/obrigado") ||
    p.startsWith("/carrinho")
  );
}

export function StoreLayout({
  children,
  onSelectCategory,
}: {
  children: ReactNode;
  onSelectCategory?: (category: string) => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const noBottomNav = hideMobileNav(pathname);

  return (
    <div
      className={
        noBottomNav
          ? "min-h-dvh bg-background"
          : "min-h-dvh bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0"
      }
    >
      <Header onSelectCategory={onSelectCategory} />
      {children}
      <StoreFooter />
      {!noBottomNav && <MobileBottomNav />}
    </div>
  );
}
