# Asistente CMU 2027

Portal para preguntar sobre la carpeta Obsidian **CMU-2027** (Plan Estratégico + 50° Congreso 2026 + Personas) usando el **Cursor SDK**.

## Deploy recomendado (gratis + estable)

| Opción | Costo | Backend | Notas |
|--------|-------|---------|--------|
| **Render** (recomendado) | $0 | Sí | Cold start ~30–60s tras idle; URL fija |
| GitHub Codespaces | Incluido GH | Sí | Lo puedo encender yo; se duerme si nadie lo usa |
| Firebase Hosting Spark | $0 | No | Solo UI estática |

**Repo:** https://github.com/felipeosiris/cmu-2027-assistant

### One-click Render

1. Abre: https://render.com/deploy?repo=https://github.com/felipeosiris/cmu-2027-assistant  
2. Conecta GitHub y pega `CURSOR_API_KEY` (+ opcional `GOOGLE_PLACES_API_KEY`).  
3. Deploy → URL tipo `https://cmu-2027-assistant.onrender.com`

## Local

```bash
cd cmu-ai
cp .env.example .env
npm install
npm run dev
```

Cliente: http://localhost:5178 · API: :8788

## Stack

- React + Vite + Express SSE
- Cursor SDK (`local` vault)
- Clima, Places, agenda, APIs médicas, PDF export
