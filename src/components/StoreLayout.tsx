import type { ReactNode } from "react";
import { Header, MobileBottomNav, StoreFooter } from "@/components/Header";

export function StoreLayout({
  children,
  onSelectCategory,
}: {
  children: ReactNode;
  onSelectCategory?: (category: string) => void;
}) {
  return (
    <div className="min-h-dvh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <Header onSelectCategory={onSelectCategory} />
      {children}
      <StoreFooter />
      <MobileBottomNav />
    </div>
  );
}
