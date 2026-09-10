import produtosJson from "../data-produtos.json";

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
}

export const products = produtosJson as unknown as Product[];

export function getProduct(id: number): Product | undefined {
  return products.find((p) => p.id === id);
}

export function formatBRL(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const categories = ["Todos", "Masculino", "Feminino", "Unisex"] as const;
