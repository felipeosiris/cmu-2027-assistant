# APIs externas (asistente CMU)

APIs conectadas al Asistente CMU 2027 para respuestas proactivas (clima, lugares cerca del CIC, mini mapas, evidencia médica educativa).

> **Disclaimer médico:** las APIs de fármacos/ensayos/PubMed son **educativas**. No sustituyen criterio clínico ni fichas COFEPRIS.

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

## Lugares — Google Places (FanPass Mundial)

- Misma key que FanPass 2026 (`GOOGLE_PLACES_API_KEY` en `.env` del servidor; no versionar la key).
- Nearby Search cerca del CIC: restaurant, cafe, lodging, parking, pharmacy, hospital, atm.
- Cada resultado incluye coords + `mapEmbedUrl` (OSM) + Google Maps / directions desde el CIC.
- La UI muestra mini mapas solo cuando la pregunta pide lugares.

## Mapas (sin API key extra)

- Embed OSM + enlaces a Google Maps.

---

## APIs médicas públicas (integradas)

Implementación: `cmu-ai/server/medical.ts`. Endpoints de prueba:

| Endpoint | Parámetro | Fuente |
|---|---|---|
| `GET /api/tools/medical?q=` | pregunta libre | orquesta todo |
| `GET /api/tools/rxnorm?name=` | fármaco | RxNorm NLM |
| `GET /api/tools/openfda?name=` | fármaco | OpenFDA labels |
| `GET /api/tools/trials?q=` | tema/enfermedad | ClinicalTrials.gov v2 |
| `GET /api/tools/pubmed?q=` | tema | PubMed E-utilities |

### RxNorm (NLM) — gratis

- Docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
- Base: `https://rxnav.nlm.nih.gov/REST/`
- Uso: normalizar nombre de fármaco (marca ↔ genérico), RxCUI.
- Ejemplo: `tamsulosina`, `enzalutamida`, `sildenafil`.

### OpenFDA — labels de fármacos (gratis; key opcional)

- Docs: https://open.fda.gov/apis/drug/label/
- Base: `https://api.fda.gov/drug/label.json`
- Uso: indicaciones y advertencias resumidas (EE.UU.; no COFEPRIS).
- Rate limit: sin key es limitado; para demo congreso suele bastar.

### ClinicalTrials.gov API v2 — gratis

- Docs: https://clinicaltrials.gov/data-api/api
- Base: `https://clinicaltrials.gov/api/v2/studies`
- Uso: ensayos por tema urológico (HBP, cáncer próstata/vejiga/renal, PSMA, etc.).
- Devuelve NCTId, título, status, fase, condiciones, intervenciones + URL.

### PubMed / NCBI E-utilities — gratis

- Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
- `esearch` + `esummary` sobre `pubmed`.
- Uso: 3–4 papers relevantes (filtro urology cuando aplica).
- Enlaces: `https://pubmed.ncbi.nlm.nih.gov/{pmid}/`

### Cuándo se disparan

El backend detecta intención en el prompt:

- **Fármaco / medicamento / prospecto / nombres conocidos** → RxNorm + OpenFDA
- **Ensayo / trial / estudio clínico** → ClinicalTrials.gov
- **Evidencia / PubMed / paper / meta-análisis / guías** → PubMed
- Temas urológicos (HBP, cáncer próstata/vejiga/renal, litiasis, DE, PSMA…) → trials y/o papers si el wording lo pide

Se inyectan en el contexto del agente junto con el clima (y lugares solo si aplican).

### Qué NO hacen

- No diagnostican ni recetan.
- No reemplazan guías EAU/AUA/CMU ni ficha mexicana.
- No se mezclan con “dónde hay farmacia” (eso sigue siendo Places).

---

## Programa estructurado (índice del asistente)

- Archivo: `Congreso-2026/programa.json` (+ `cmu-ai/server/program.ts`)
- Endpoints:
  - `GET /api/program` — sesiones, salones, sponsors, speakers
  - `GET /api/program/agenda` — ahora / siguiente / día (`?at=` ISO opcional)
  - `GET /api/program/rooms?q=`
  - `GET /api/program/sponsors?q=`
  - `GET /api/program/search?q=`
  - `GET /api/program/speakers`
- Fuera de fechas del congreso usa **reloj demo** (jueves 4 · 10:20) para demos.
- El agente debe preferir este índice frente a inventar horarios del PDF.

Notas: [[Congreso-2026/Salones-CIC]], [[Congreso-2026/Patrocinadores]], [[Congreso-2026/Fichas-ponentes]].

---

## Exportar PDF

- `POST /api/export/pdf` con `{ title, text }` → descarga `application/pdf`.
- Botón **Descargar PDF** en cada respuesta del asistente (ya no markdown ni about:blank).

## Fotos de ponentes (proactivo, alta confianza)

- `GET /api/program/speaker-photo?name=`
- Orden: bóveda → seeds oficiales → og:image de perfil → Google CSE (si `GOOGLE_CSE_ID`) → Wikipedia.
- Solo se usan fotos con **confidence ≥ 0.9**. Se cachean en `Personas/fotos/web/`.
- Ya hay seeds: Joan Palou Redorta, Stacy Loeb.
- Opcional: define `GOOGLE_CSE_ID` (+ API key Google) para búsqueda de imágenes más amplia.

---

## Cómo usa el asistente estas APIs

1. Detecta intención (clima, sede, comida, hotel, **médico**, etc.).
2. Prefetch en vivo → JSON/markdown en el prompt del agente.
3. SSE `places` solo si hay mapas que mostrar.
4. Combina con bóveda: [[Congreso-2026/]], [[Personas/Personas (índice)|Personas]], plan estratégico.

## Proactividad esperada

- Calor/lluvia → ropa / hidratación / paraguas.
- Lugares → lista + mini mapas.
- Fármaco del simposio (p. ej. Astellas) → ficha RxNorm/OpenFDA + disclaimer.
- Tema de ponencia → trials activos y/o papers recientes si preguntan evidencia.
