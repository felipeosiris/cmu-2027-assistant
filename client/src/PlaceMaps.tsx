export type PlaceCard = {
  name: string;
  rating?: number;
  userRatings?: number;
  vicinity?: string;
  openNow?: boolean;
  category: string;
  lat: number;
  lon: number;
  mapEmbedUrl: string;
  googleMapsUrl: string;
  directionsFromCicUrl: string;
};

type Props = {
  places: PlaceCard[];
  venue?: PlaceCard | null;
};

export function PlaceMaps({ places, venue }: Props) {
  if (!places.length && !venue) return null;

  const cards = places.length ? places : venue ? [venue] : [];

  return (
    <div className="place-maps">
      <p className="place-maps-title">Mapas</p>
      <div className="place-maps-grid">
        {cards.map((p) => (
          <article
            key={`${p.name}-${p.lat}-${p.lon}`}
            className="place-card"
          >
            <header className="place-card-head">
              <div>
                <span className="place-cat">{p.category}</span>
                <h3>{p.name}</h3>
                {p.vicinity && <p className="place-vicinity">{p.vicinity}</p>}
              </div>
              <div className="place-meta">
                {p.rating != null && (
                  <span className="place-rating">
                    ★ {p.rating}
                    {p.userRatings != null ? ` (${p.userRatings})` : ""}
                  </span>
                )}
                {p.openNow != null && (
                  <span className={p.openNow ? "open-yes" : "open-no"}>
                    {p.openNow ? "Abierto" : "Cerrado"}
                  </span>
                )}
              </div>
            </header>
            <div className="place-map-frame">
              <iframe
                title={`Mapa ${p.name}`}
                src={p.mapEmbedUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <div className="place-actions">
              <a href={p.googleMapsUrl} target="_blank" rel="noreferrer">
                Abrir en Maps
              </a>
              {p.category !== "sede" && (
                <a
                  href={p.directionsFromCicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Cómo llegar desde el CIC
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
