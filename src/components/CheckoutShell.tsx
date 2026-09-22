import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { AsicsWordmark } from "@/components/Logo";
import { PaymentMarks } from "@/components/Header";

export function CheckoutShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-40 border-b border-[#e4e5f3] bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-12 max-w-[1100px] items-center justify-between px-4 sm:h-[51px]">
          <Link to="/" aria-label="ASICS" className="flex h-11 items-center">
            <AsicsWordmark className="h-7 w-[78px]" />
          </Link>
          <p className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-primary sm:gap-2 sm:text-[13px]">
            <Lock className="h-4 w-4 shrink-0" />
            Compra segura
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:py-8">
        {children}
      </main>
      <footer className="mt-8 border-t border-[#e4e5f3] sm:mt-10">
        <div className="mx-auto max-w-[1100px] px-4 py-6 sm:py-8">
          <PaymentMarks className="flex-wrap" pixOnly />
          <p className="mt-4 max-w-3xl text-[11px] leading-relaxed text-[#666]">
            Copyright © {new Date().getFullYear()} ASICS America Corporation.
            TODOS OS DIREITOS RESERVADOS. As fotos aqui veiculadas, logotipo e
            marca são de propriedade de ASICS America Corporation. É vetada a
            sua reprodução, total ou parcial, sem prévia autorização.
          </p>
        </div>
      </footer>
    </div>
  );
}
