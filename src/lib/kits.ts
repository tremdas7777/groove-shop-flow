export interface KitPiece {
  name: string;
  kind: "roupa" | "tenis" | "meia";
  photo: string;
}

export interface RunningKit {
  id: number;
  gender: "masculino" | "feminino";
  title: string;
  subtitle: string;
  price: number;
  compareAt: number;
  photo: string;
  clothesSizes: string[];
  shoeSizes: string[];
  pieces: KitPiece[];
}

const MALE_SHOE = "https://imgcentauro-a.akamaihd.net/1300x1300/M178TS29A1.jpg";
const FEMALE_SHOE = "https://imgcentauro-a.akamaihd.net/1300x1300/992317FPA2.jpg";

export const runningKits: RunningKit[] = [
  {
    id: 90001,
    gender: "masculino",
    title: "Kit Corrida Completo Masculino",
    subtitle: "Camiseta + shorts + Novablast 5 + meia",
    price: 397,
    compareAt: 897,
    photo: MALE_SHOE,
    clothesSizes: ["P", "M", "G", "GG"],
    shoeSizes: ["39", "40", "41", "42", "43", "44"],
    pieces: [
      {
        name: "Camiseta ASICS Core Run",
        kind: "roupa",
        photo: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Shorts ASICS 7\"",
        kind: "roupa",
        photo: "https://images.unsplash.com/photo-1517838277536-f4d4d36ea28c?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Tênis Novablast 5 Masculino",
        kind: "tenis",
        photo: MALE_SHOE,
      },
      {
        name: "Meia ASICS Performance",
        kind: "meia",
        photo: "https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
  {
    id: 90002,
    gender: "feminino",
    title: "Kit Corrida Completo Feminino",
    subtitle: "Top + shorts + Novablast 5 + meia",
    price: 397,
    compareAt: 897,
    photo: FEMALE_SHOE,
    clothesSizes: ["PP", "P", "M", "G"],
    shoeSizes: ["34", "35", "36", "37", "38", "39"],
    pieces: [
      {
        name: "Top ASICS Core Run",
        kind: "roupa",
        photo: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Shorts ASICS Feminino",
        kind: "roupa",
        photo: "https://images.unsplash.com/photo-1518310383802-640c2de311b2?auto=format&fit=crop&w=900&q=80",
      },
      {
        name: "Tênis Novablast 5 Feminino",
        kind: "tenis",
        photo: FEMALE_SHOE,
      },
      {
        name: "Meia ASICS Performance",
        kind: "meia",
        photo: "https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?auto=format&fit=crop&w=900&q=80",
      },
    ],
  },
];

export function getKit(id: number) {
  return runningKits.find((kit) => kit.id === id);
}

export function kitToProduct(kit: RunningKit) {
  return {
    id: kit.id,
    titulo: kit.title,
    preco: kit.price.toFixed(2),
    preco_comparacao: kit.compareAt.toFixed(2),
    desconto: String(Math.round((1 - kit.price / kit.compareAt) * 100)),
    categoria: kit.gender === "masculino" ? "Masculino" : "Feminino",
    notas: "5.0",
    descricao: `${kit.subtitle}. Frete junto com o pedido anterior ou em um novo envio.`,
    fotos: [kit.photo, ...kit.pieces.map((piece) => piece.photo)],
    variacoes: kit.clothesSizes.map((size, index) => ({
      id: kit.id * 10 + index,
      tipo: "tamanho",
      titulo: size,
      preco: kit.price.toFixed(2),
      preco_comparacao: kit.compareAt.toFixed(2),
      desconto: "56.00",
    })),
  };
}

export const kitProducts = runningKits.map(kitToProduct);
