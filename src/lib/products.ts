import produtosJson from "../data-produtos.json";
import { kitProducts } from "@/lib/kits";

export interface Variation {
  id: number;
  tipo: string;
  titulo: string;
  preco: string;
  preco_comparacao: string;
  desconto: string;
  imagem?: string;
}

export interface Product {
  id: number;
  titulo: string;
  preco: string;
  preco_comparacao: string;
  desconto: string;
  categoria: string;
  notas: string;
  descricao: string;
  fotos: string[];
  variacoes?: Variation[];
}

export const products = [...(produtosJson as unknown as Product[])].sort(
  (a, b) => parsePrice(a.preco) - parsePrice(b.preco),
);

export function getProduct(id: number): Product | undefined {
  return products.find((p) => p.id === id) ?? kitProducts.find((p) => p.id === id);
}

export function formatBRL(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parsePrice(value: string | number): number {
  return typeof value === "string" ? parseFloat(value) : value;
}

export function getSizes(product: Product): string[] {
  const sizes = (product.variacoes ?? [])
    .filter((v) => v.tipo === "tamanho")
    .map((v) => v.titulo);
  return [...new Set(sizes)];
}

export function installmentOf(price: number, times = 10): string {
  return formatBRL(price / times);
}

export const categories = ["Todos", "Masculino", "Feminino", "Unisex"] as const;

export type Category = (typeof categories)[number];
