import { Link } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/lib/cart";
import logo from "@/assets/asics-logo.jpg";

export function Header() {
  const { count } = useCart();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={logo}
            alt="ASICS"
            className="h-8 w-8 rounded-sm object-cover"
          />
          <span className="text-lg font-extrabold italic tracking-tight text-foreground">
            ASICS<span className="text-primary"> Outlet</span>
          </span>
        </Link>
        <Link
          to="/carrinho"
          className="relative inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          aria-label="Ver carrinho"
        >
          <ShoppingCart className="h-4 w-4" />
          <span className="hidden sm:inline">Carrinho</span>
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
              {count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
