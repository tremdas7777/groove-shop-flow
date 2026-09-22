import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const heroSlides = [
  {
    alt: "MEGABLAST™ — Aniversário OneASICS™",
    desktop:
      "https://www.asics.com.br/arquivos/BANNER-DESKTOP-NIVER-ONE-ASICS-MEGABLAST.png?v=639238841933600000",
    mobile:
      "https://www.asics.com.br/arquivos/BANNER-MOBILE-NIVER-ONE-ASICS-MEGABLAST-brasil-set-2026.png?v=639238827706900000",
  },
  {
    alt: "Sportstyle com 50% de bônus de volta",
    desktop:
      "https://www.asics.com.br/arquivos/Desk01920x740-SPS.jpg?v=639255828325700000",
    mobile:
      "https://www.asics.com.br/arquivos/Mob-768x910-SPS.jpg?v=639255828324970000",
  },
  {
    alt: "Selecionados especiais para OneASICS™",
    desktop:
      "https://www.asics.com.br/arquivos/SPS-ANIVER-ONE-ASICS-DESKTOP.png?v=639255833663270000",
    mobile:
      "https://www.asics.com.br/arquivos/SPS-ANIVER-ONE-ASICS-MOBILE.png?v=639255833629470000",
  },
  {
    alt: "100% de bônus de volta em produtos selecionados",
    desktop:
      "https://www.asics.com.br/arquivos/BANNER-DESKTOP-NIVER-ONE-ASICS-100DEVOLTA.png?v=639238752740730000",
    mobile:
      "https://www.asics.com.br/arquivos/BANNER-MOBILE-NIVER-ONE-ASICS-100DEVOLTA-brasil-set-2026.png?v=639238752739030000",
  },
];

const categories = [
  {
    title: "Corrida",
    img: "https://www.asics.com.br/arquivos/Categories-desk-480x348-Corrida.png?v=639237877180000000",
  },
  {
    title: "Tennis",
    img: "https://www.asics.com.br/arquivos/Categories-desk-480x348-Tennis.png?v=639237877177970000",
  },
  {
    title: "Academia",
    img: "https://www.asics.com.br/arquivos/Categories-desk-480x348-Acad.png?v=639237877174370000",
  },
  {
    title: "Sportstyle",
    img: "https://www.asics.com.br/arquivos/Categories-desk-480x348-SPS.png?v=639237877170000000",
  },
];

const campaignBanners = [
  {
    alt: "Platinum Pack 2026",
    desktop:
      "https://www.asics.com.br/arquivos/BannersPlatinumPack-Desk-1920x740.jpg?v=639204082515200000",
    mobile:
      "https://www.asics.com.br/arquivos/BannersPlatinumPack-Mob-768x910.jpg?v=639204082514570000",
  },
  {
    alt: "SP Open 2026",
    desktop:
      "https://www.asics.com.br/arquivos/SPOpen2026-Ecomm-Hero-Desk01920x740.jpg?v=639248024901300000",
    mobile:
      "https://www.asics.com.br/arquivos/SPOpen2026-Ecomm-HeroMob-768x910-v2.jpg?v=639248024899300000",
  },
  {
    alt: "GEL-NYC",
    desktop:
      "https://www.asics.com.br/arquivos/NYC2.0-Ecomm-Hero-Desk01920x740.jpg?v=639246550430470000",
    mobile:
      "https://www.asics.com.br/arquivos/NYC2.0-Ecomm-HeroMob-768x910.jpg?v=639246550430470000",
  },
  {
    alt: "METASPEED™ SERIES",
    desktop:
      "https://www.asics.com.br/arquivos/MetaSpeed-Desk-1920x740.jpg?v=639185884017670000",
    mobile:
      "https://www.asics.com.br/arquivos/MetaSpeed-Mob-768x910.jpg?v=639185884015330000",
  },
  {
    alt: "BLAZEBLAST™",
    desktop:
      "https://www.asics.com.br/arquivos/Blazeblast-Ecommerce-Hero-Desk01920x740.jpg?v=639222179265970000",
    mobile:
      "https://www.asics.com.br/arquivos/Blazeblast-Mob-768x910.jpg?v=639234239270470000",
  },
];

function BannerPicture({
  desktop,
  mobile,
  alt,
  className,
}: {
  desktop: string;
  mobile: string;
  alt: string;
  className?: string;
}) {
  return (
    <picture>
      <source media="(min-width: 768px)" srcSet={desktop} />
        <img
          src={mobile}
          alt={alt}
          className={cn("h-full w-full object-cover object-center", className)}
        />
    </picture>
  );
}

export function HomeHeroBanner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % heroSlides.length);
    }, 6000);
    return () => window.clearInterval(id);
  }, []);

  const go = (next: number) => {
    setIndex((next + heroSlides.length) % heroSlides.length);
  };

  return (
    <section className="relative overflow-hidden bg-[#d8dde8]">
      <div className="relative">
        {heroSlides.map((slide, i) => (
          <a
            key={slide.desktop}
            href="#produtos"
            className={cn(
              "block",
              i === index ? "relative" : "absolute inset-0 hidden",
            )}
            aria-hidden={i !== index}
          >
            <BannerPicture
              desktop={slide.desktop}
              mobile={slide.mobile}
              alt={slide.alt}
              className="aspect-[768/910] max-md:max-h-[min(70dvh,34rem)] md:aspect-[1920/740]"
            />
          </a>
        ))}

        <button
          type="button"
          aria-label="Banner anterior"
          onClick={() => go(index - 1)}
          className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm md:left-6"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Próximo banner"
          onClick={() => go(index + 1)}
          className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm md:right-6"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 md:bottom-4">
          {heroSlides.map((slide, i) => (
            <button
              key={slide.desktop}
              type="button"
              aria-label={`Ir para o banner ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "flex h-8 items-center justify-center px-1",
              )}
            >
              <span
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === index ? "w-8 bg-primary" : "w-2 bg-white/80",
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeCategoryBanners() {
  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-2 px-3 py-6 sm:gap-3 sm:px-4 sm:py-8 md:grid-cols-4 md:gap-4">
        {categories.map((cat) => (
          <a key={cat.title} href="#produtos" className="group block">
            <div className="overflow-hidden">
              <img
                src={cat.img}
                alt={cat.title}
                className="aspect-[480/348] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            </div>
            <p className="mt-1.5 text-center text-[13px] font-semibold text-primary sm:mt-2 sm:text-[15px]">
              {cat.title}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

export function HomeCampaignBanners() {
  return (
    <section className="bg-white">
      <div className="space-y-3 md:space-y-4">
        {campaignBanners.map((banner) => (
          <a key={banner.alt} href="#produtos" className="block">
            <BannerPicture
              desktop={banner.desktop}
              mobile={banner.mobile}
              alt={banner.alt}
              className="aspect-[768/910] max-md:max-h-[min(70dvh,34rem)] md:aspect-[1920/740]"
            />
          </a>
        ))}
      </div>
    </section>
  );
}

export function HomeOneAsicsBanner() {
  return (
    <section className="bg-white">
      <a href="#produtos" className="block">
        <picture>
          <source
            media="(min-width: 768px)"
            srcSet="https://www.asics.com.br/arquivos/2024_OneASICS_Highlight.png?v=638971657989600000"
          />
          <img
            src="https://www.asics.com.br/arquivos/2024_OneASICS_Highlight_13_group_mobile.png?v=638971659554270000"
            alt="Vá além com OneASICS™"
            className="w-full object-cover"
          />
        </picture>
      </a>
    </section>
  );
}
