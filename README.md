# Espacio Auditorium — sitio web y reservas

Sitio de [Espacio Auditorium](https://www.espacioauditorium.com.ar) (Recoleta, CABA):
landing SEO, cotizador, **reserva online con seña por Mercado Pago**, panel de
administración y bot de WhatsApp con Claude.

## Arquitectura

```
Navegador ──► Vercel (CDN)  ── dist/            SPA Vite + React 18 (prerender de landings)
                 │
                 ├─ /api/availability          GET  disponibilidad pública (sin datos personales)
                 ├─ /api/create-payment        POST valida, calcula precio, crea reserva + preferencia MP
                 ├─ /api/payment-webhook       POST Mercado Pago (firma HMAC) → deposit_paid, Calendar, emails
                 ├─ /api/reservations/:id?t=   GET  estado de una reserva (token público)
                 ├─ /api/admin-*               POST panel admin (password → token Bearer 12 h)
                 ├─ /api/whatsapp-meta         GET/POST bot de WhatsApp (Meta Cloud API + Grok)
                 └─ crons: keep-alive, payment-reminder, auto-cancel, send-reminders
                        │
        ┌───────────────┼──────────────────┬───────────────┬───────────────┐
     Supabase     Google Calendar     Mercado Pago     Gmail SMTP      Meta / xAI Grok 
   (Postgres)    (+ Sheets de leads)   (seña)        (Nodemailer)      (bot WhatsApp)
```

- **Frontend** (`src/`): React 18 + React Router 7, Vite 5, react-day-picker, react-hook-form.
  No habla con Supabase: toda la data pasa por `api/`.
- **Backend** (`api/`): funciones serverless de Vercel (Node 24, ESM). Módulos compartidos:
  `_utils.js` (Supabase admin, CORS, rate limit, auth admin/cron), `_availability.js`
  (única fuente de disponibilidad: reservas + holds + `blocked_dates` + Google Calendar),
  `_calendar.js`, `_google.js`, `_validate.js`, `_email.js`, `_dates.js`.
- **Precios y política** en un solo lugar: `src/lib/pricing.js` (lo importan el frontend,
  `create-payment` y el bot).
- **Base de datos**: `supabase/schema.sql` + `supabase/migrations/` (ver `DEPLOY.md` §5).
- **SEO**: `scripts/inject-meta.js` genera un `index.html` por landing con sus metadatos tras
  el build; `public/sitemap.xml`, `public/robots.txt`, `public/llms.txt`.

## Estructura

```
api/              funciones serverless (Vercel)
src/              app React (pages/, components/, hooks/, lib/)
public/           estáticos (img/ con el hero responsive, sitemap, robots)
scripts/          inject-meta.js (prerender de metadatos por ruta)
supabase/         schema.sql y migrations/
vercel.json       headers de seguridad/caché, redirects, rewrites, crons
.env.example      todas las variables de entorno, comentadas
DEPLOY.md         cómo se despliega y se configura cada servicio
SECURITY.md       modelo de amenazas, rotación de secretos, incidentes, backups
docs/RUNBOOK.md   operación diaria
```

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Vite en local (proxy `/api` → `localhost:3001`) |
| `npx vercel dev` | Frontend + funciones `api/` (requiere `vercel link`) |
| `npm run build` | Build de producción en `dist/` + prerender de metadatos |
| `npm run preview` | Sirve `dist/` |
| `npm run lint` | ESLint (frontend con globals de navegador, `api/` con Node) |
| `npm run check:api` | `node --check` de todas las funciones |
| `npm run audit:prod` | `npm audit` sólo de dependencias de producción (falla con *high*) |

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Copiarlo a `.env.local` para
desarrollo; en Vercel cargarlas en *Settings > Environment Variables*. Las `VITE_*` son
públicas (van al bundle): nunca un secreto ahí.

## Deploy

**Sólo por Git:** push a `main` → Vercel construye y publica. Nada de `vercel --prod`.
Orden completo (migraciones en dos fases, webhooks de Mercado Pago y Meta, Deployment
Protection, checklist de verificación) en [`DEPLOY.md`](DEPLOY.md).

## Requisitos

Node **24** (`.nvmrc`), npm 10+. `npm ci` para instalar.

## Seguridad

Ver [`SECURITY.md`](SECURITY.md). Para reportar una vulnerabilidad, escribir a la casilla
del negocio con asunto "Seguridad – sitio web".
