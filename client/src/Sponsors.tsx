/** Logos de patrocinadores — carrusel en landing. */

export type LandingSponsor = {
  name: string;
  logo: string;
  tier: "diamante" | "oro" | "plata";
  triviaId?: string;
};

export const LANDING_SPONSORS: LandingSponsor[] = [
  {
    name: "Adium",
    logo: "/assets/sponsors/logos/adium.png",
    tier: "diamante",
    triviaId: "adium-diamante",
  },
  {
    name: "Astellas",
    logo: "/assets/sponsors/logos/astellas.png",
    tier: "diamante",
    triviaId: "astellas-diamante",
  },
  {
    name: "Liomont",
    logo: "/assets/sponsors/logos/liomont.png",
    tier: "oro",
    triviaId: "liomont-oro",
  },
  {
    name: "Senosiain",
    logo: "/assets/sponsors/logos/senosiain.png",
    tier: "oro",
    triviaId: "senosiain-oro",
  },
  {
    name: "Siegfried Rhein",
    logo: "/assets/sponsors/logos/siegfried-rhein.png",
    tier: "oro",
    triviaId: "siegfried-oro",
  },
  {
    name: "Johnson & Johnson",
    logo: "/assets/sponsors/logos/johnson-johnson.png",
    tier: "plata",
    triviaId: "jj-plata",
  },
  {
    name: "Boston Scientific",
    logo: "/assets/sponsors/logos/boston-scientific.png",
    tier: "plata",
    triviaId: "boston-plata",
  },
  {
    name: "AstraZeneca",
    logo: "/assets/sponsors/logos/astrazeneca.png",
    tier: "plata",
    triviaId: "az-plata",
  },
  {
    name: "PiSA Farmacéutica",
    logo: "/assets/sponsors/logos/pisa.png",
    tier: "plata",
  },
  {
    name: "Global Care",
    logo: "/assets/sponsors/logos/global-care.png",
    tier: "plata",
  },
  {
    name: "Endoscopia Guadalajara",
    logo: "/assets/sponsors/logos/endoscopia-guadalajara.png",
    tier: "plata",
  },
];

type Props = {
  onOpenTrivia?: () => void;
};

/** Carrusel infinito debajo de las sugerencias. */
export function SponsorCarousel({ onOpenTrivia }: Props) {
  // Duplicamos la lista para el loop CSS seamless
  const loop = [...LANDING_SPONSORS, ...LANDING_SPONSORS];

  return (
    <div className="sponsor-carousel" aria-label="Patrocinadores del congreso">
      <p className="sponsor-carousel-kicker">Patrocinadores del congreso</p>
      <div className="sponsor-carousel-viewport">
        <div className="sponsor-carousel-track">
          {loop.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              className="sponsor-carousel-logo"
              title={s.name}
              aria-hidden={i >= LANDING_SPONSORS.length}
              tabIndex={i >= LANDING_SPONSORS.length ? -1 : 0}
              onClick={onOpenTrivia}
            >
              <img
                src={s.logo}
                alt={i < LANDING_SPONSORS.length ? s.name : ""}
                loading="lazy"
                draggable={false}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
