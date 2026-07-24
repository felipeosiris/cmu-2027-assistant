# APIs externas (asistente CMU)

APIs conectadas al Asistente CMU 2027 para respuestas proactivas (clima, comida cerca del CIC).

## Sede de referencia

**Centro Internacional de Convenciones de Puerto Vallarta (CIC)**

| | |
|---|---|
| Lat | 20.6534 |
| Lon | -105.2253 |
| Ciudad | Puerto Vallarta, Jalisco |
| Congreso | [[Congreso-2026/50-Congreso-CMU-2026]] |

## Clima — Open-Meteo (gratis, sin API key)

- Docs: https://open-meteo.com/
- Endpoint: `https://api.open-meteo.com/v1/forecast`
- Uso: temperatura, sensación térmica, precipitación, código de clima para el CIC.
- El asistente debe sugerir ropa (ligera / abrigo / paraguas) según temperatura y lluvia antes de una ponencia.

## Restaurantes / lugares — Google Places (FanPass Mundial)

- Misma key que FanPass 2026 (`GOOGLE_PLACES_API_KEY` en `.env` del servidor; no versionar la key).
- Nearby Search cerca del CIC: comida antes/después de ponencias, cafés, etc.
- Radio típico: 1000–1500 m.

## Cómo usa el asistente estas APIs

1. El backend pide clima y/o restaurantes en vivo.
2. Inyecta el JSON resumido en el contexto de la pregunta.
3. El agente combina eso con el programa ([[Congreso-2026/]]) y las [[Personas/Personas (índice)|personas]].

## Proactividad esperada

- Si hay calor (>28 °C sensación): sugerir ropa ligera / hidratación.
- Si hay lluvia: llevar paraguas entre CIC y hoteles.
- Si preguntan por comida o hay hueco entre sesiones: 3–5 restaurantes cercanos con rating.
- Si preguntan por una ponencia concreta: cruzar horario del programa + clima de esa franja + comida cercana.
