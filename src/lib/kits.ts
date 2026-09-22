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

const img = (id: string, file: string) =>
  `https://asicsbr.vteximg.com.br/arquivos/ids/${id}-800-800/${file}`;

const MALE_SHOE = "https://imgcentauro-a.akamaihd.net/1300x1300/M178TS29A1.jpg";
const FEMALE_SHOE = "https://imgcentauro-a.akamaihd.net/1300x1300/992317FPA2.jpg";

export const runningKits: RunningKit[] = [
  {
    id: 90001,
    gender: "masculino",
    title: "Kit Corrida Completo Masculino",
    subtitle: "Camiseta Road + shorts Match 7\" + Novablast 5 + meia",
    price: 397,
    compareAt: 897,
    photo: MALE_SHOE,
    clothesSizes: ["P", "M", "G", "GG"],
    shoeSizes: ["39", "40", "41", "42", "43", "44"],
    pieces: [
      {
        name: "Camiseta ASICS Road",
        kind: "roupa",
        photo: img("3243848", "2011C992_001_GM_FT_GLOBAL.jpg"),
      },
      {
        name: "Shorts ASICS Match 7\"",
        kind: "roupa",
        photo: img("3560696", "2041A357_001_GM_FT_GLOBAL.jpg"),
      },
      {
        name: "Tênis Novablast 5 Masculino",
        kind: "tenis",
        photo: MALE_SHOE,
      },
      {
        name: "Meia ASICS Basic",
        kind: "meia",
        photo: img("270717", "ZKB4056.90-1.jpg"),
      },
    ],
  },
  {
    id: 90002,
    gender: "feminino",
    title: "Kit Corrida Completo Feminino",
    subtitle: "Top Nagino Flex + shorts Icon 4\" + Novablast 5 + meia",
    price: 397,
    compareAt: 897,
    photo: FEMALE_SHOE,
    clothesSizes: ["PP", "P", "M", "G"],
    shoeSizes: ["34", "35", "36", "37", "38", "39"],
    pieces: [
      {
        name: "Top ASICS Nagino Flex",
        kind: "roupa",
        photo: img("3639201", "2032D389_002_GF_FT_GLOBAL.jpg"),
      },
      {
        name: "Shorts ASICS Icon 4\"",
        kind: "roupa",
        photo: img("3704851", "2012D361_001_GF_FT_GLOBAL.jpg"),
      },
      {
        name: "Tênis Novablast 5 Feminino",
        kind: "tenis",
        photo: FEMALE_SHOE,
      },
      {
        name: "Meia ASICS Basic",
        kind: "meia",
        photo: img("270717", "ZKB4056.90-1.jpg"),
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
