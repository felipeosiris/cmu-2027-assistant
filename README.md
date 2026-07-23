# Asistente CMU 2027

Portal local para preguntar sobre la carpeta Obsidian **CMU-2027** (Plan Estratégico) usando el **Cursor SDK**.

## Requisitos

1. Node 20+
2. API key de Cursor (misma del becario de Chedraui)
3. Chrome o Edge (voz)

## Setup

```bash
cd cmu-ai
cp .env.example .env
# CURSOR_API_KEY=...
# VAULT_CWD=/ruta/a/fomc/CMU-2027
npm install
npm run dev
```

Abre **http://localhost:5178** (Vite → API `:8788`).

## Firebase Hosting (Spark)

Solo UI estática. El chat **no** corre en la URL pública (sin Blaze / Functions).

```bash
npm run build
firebase deploy --only hosting --project <project-id>
```

## Stack

- Frontend: React + Vite (Poppins, azul CMU)
- Backend local: Express + SSE
- Agente: `@cursor/sdk` con `local: { cwd: CMU-2027 }`
