# Asistente CMU 2027

Portal para preguntar sobre la carpeta Obsidian **CMU-2027** (Plan Estratégico + 50° Congreso 2026 + Personas) usando el **Cursor SDK**.

## Demo con chat (backend gratis)

Firebase Spark **no** permite Functions (haría falta Blaze). Alternativas:

| Opción | Costo | Backend Node | Notas |
|--------|-------|--------------|--------|
| **GitHub Codespaces** (actual) | Incluido en tu plan GH | Sí | Demo pública con chat |
| **Render** free web service | $0, sin tarjeta | Sí | Cold start ~30–60s tras idle 15 min · Blueprint listo |
| Firebase Hosting Spark | $0 | No | Solo UI estática |

**Demo viva (chat):** https://cmu-assistant-demo-vp6rp76p97q2p7w9-8788.app.github.dev/

**UI estática Firebase:** https://cmu-2027-assistant.web.app

**Repo:** https://github.com/felipeosiris/cmu-2027-assistant

Deploy one-click a Render (login GitHub + env `CURSOR_API_KEY`):  
https://render.com/deploy?repo=https://github.com/felipeosiris/cmu-2027-assistant

## Requisitos locales

1. Node 20+
2. API key de Cursor (misma del becario de Chedraui)
3. Chrome o Edge (voz)

## Setup local

```bash
cd cmu-ai
cp .env.example .env
# CURSOR_API_KEY=...
# VAULT_CWD=/ruta/a/fomc/CMU-2027
npm install
npm run dev
```

Abre **http://localhost:5178** (Vite → API `:8788`).

## Stack

- Frontend: React + Vite (Poppins, azul CMU)
- Backend: Express + SSE
- Agente: `@cursor/sdk` con `local: { cwd: vault }`
