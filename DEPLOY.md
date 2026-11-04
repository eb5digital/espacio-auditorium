# Deploy — Espacio Auditorium

Runbook de despliegue del sitio `https://www.espacioauditorium.com.ar`
(Vite + React en Vercel, funciones serverless en `api/`, Supabase, Google Calendar,
Mercado Pago, Meta Cloud API + Grok para el bot de WhatsApp).

> **Regla número uno: producción se despliega SOLO con `git push` a `main`.**
> Nunca `vercel --prod`, nunca `vercel deploy --prebuilt`, nunca desde un árbol
> de trabajo con cambios sin commitear. Lo que corre en producción tiene que
> ser reproducible desde un commit de `main`.

---

## 1. Cómo se despliega

| Qué | Cómo |
|-----|------|
| Producción | Merge / push a `main` → Vercel (integración con GitHub) construye y publica. |
| Preview | Cada Pull Request genera una URL de preview (protegida, ver §3). |
| Rollback | Vercel > Deployments > deploy anterior > **Promote to Production** (o revertir el commit en `main`). |
| CLI | `vercel` sólo para desarrollo local (`vercel dev`, `vercel env pull`). Nada de `--prod`. |

Por qué: hasta septiembre de 2026 producción se subía con `vercel --prod` desde
un árbol sucio (`gitDirty=1` en los últimos 20 deploys), por lo que lo que
corría en el sitio no coincidía con `main` y cuatro commits con fixes de
seguridad nunca llegaron a producción. Los scripts `*.command` de la raíz
(`go-live.command`, `reset-y-test.command`, `test-*.command`, `fix-secret-*.command`,
`set-secret-cli.command`, `load-missing-vars.command`, `crear-tester-mp.command`)
hacían exactamente eso y además tienen tokens hardcodeados: **moverlos fuera del
repo y rotar los secretos que contienen** (ver `SECURITY.md` §3). Ya están en
`.gitignore` (`*.command`) para que no puedan commitearse por accidente.

---

## 2. Requisitos

- Node **24.x** (hay `.nvmrc`; `nvm use`). `package.json` declara `engines.node = 24.x`, que es
  lo que usa Vercel.
- Acceso al proyecto de Vercel, al proyecto de Supabase (`wxjytqjwoarmqvceyvqj`),
  a Mercado Pago Developers, a Meta (app "Espacio Auditorium Bot" y WhatsApp Manager), a Google Cloud (service account) y a la
  cuenta de Gmail del negocio.

---

## 3. Configuración del proyecto en Vercel (una sola vez)

Settings del proyecto:

| Sección | Valor |
|---------|-------|
| **Build & Deployment > Framework Preset** | **Vite** (estaba mal detectado como Next.js). Build `npm run build`, output `dist` (también fijados en `vercel.json`). |
| **General > Node.js Version** | 24.x |
| **Git** | Repositorio `memidigitals-ia/espacio-auditorium`, Production Branch `main`. |
| **Deployment Protection > Vercel Authentication** | **Standard Protection**: protege las URLs `*.vercel.app` de preview y de producción; los dominios custom siguen públicos. Así las URLs de deploys viejos dejan de servir código viejo con secretos actuales. Los crons pasan igual (Vercel los exime). |
| **Domains** | `www.espacioauditorium.com.ar` como dominio principal; el apex redirige 308 a www (regla en `vercel.json`). |
| **Cron Jobs** | Se toman de `vercel.json` (4 crons, ver §8). |
| **Notifications** (cuenta) | Activar avisos de *Deployment failed*, *Runtime errors* y *Cron job failed* al email del equipo. |
| **Firewall** | Regla de rate limit en `POST /api/*` (por ejemplo 30 req / 60 s por IP; en Hobby sólo se puede una regla). Con un ataque en curso activar *Attack Challenge Mode*. |

**Plan:** el proyecto está en Vercel **Hobby**, que es sólo para uso no comercial y pausa el
proyecto 30 días si se pasa el límite de uso. Para un sitio que cobra señas corresponde
**Pro** (spend management, más reglas de WAF, logs de más de 1 h, precisión de crons).

**Redirect de `*.vercel.app` → www:** `vercel.json` redirige cualquier host `*.vercel.app` al
dominio canónico, **excepto `/api/*`**, porque Vercel invoca los crons sobre la URL del deploy
y un 308 rompería la ejecución (el `Authorization` no sobrevive un redirect a otro host).

---

## 4. Variables de entorno

Referencia completa y comentada: [`.env.example`](.env.example). Cargarlas en
*Settings > Environment Variables*. Todas las que empiezan con `VITE_` terminan en el
bundle del navegador: **nunca un secreto en una `VITE_*`**.

| Variable | Entorno | Obligatoria | De dónde sale |
|----------|---------|-------------|---------------|
| `SUPABASE_URL` | Prod, Preview | sí (o `VITE_SUPABASE_URL` legacy) | Supabase > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod, Preview | sí | Supabase > Settings > API (service_role) |
| `MP_ACCESS_TOKEN` | Prod | sí | MP Developers > Tu app > Credenciales de producción |
| `MP_WEBHOOK_SECRET` | Prod | sí | MP Developers > Tu app > Webhooks > Clave secreta |
| `MP_ALLOW_TEST_PAYMENTS` | Preview | no | `true` sólo para probar con credenciales de test |
| `APP_URL` | Prod, Preview | sí | `https://www.espacioauditorium.com.ar` (con www, sin barra final) |
| `VITE_APP_URL` | Prod, Preview | no | igual que `APP_URL` |
| `GOOGLE_CALENDAR_ID` | Prod, Preview | sí | email del calendario del espacio |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Prod, Preview | sí (o `EMAIL` + `KEY`) | JSON de la service account en una línea |
| `GOOGLE_LEADS_SHEET_ID` | Prod | sí (bot) | ID de la planilla de leads |
| `EMAIL_USER` | Prod, Preview | sí | Gmail del negocio |
| `EMAIL_APP_PASSWORD` | Prod, Preview | sí | App Password de Google |
| `HUMAN_WHATSAPP_NUMBER` | Prod, Preview | no | WhatsApp humano (default 5491138255877) |
| `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY` | Prod | no | callmebot.com |
| `WA_ACCESS_TOKEN` | Prod | sí (bot) | token permanente del usuario del sistema (Business Settings) |
| `META_APP_SECRET` | Prod | sí (bot) | app de Meta > Configuración > Básica |
| `WA_PHONE_NUMBER_ID`, `WA_VERIFY_TOKEN` | Prod | sí (bot) | WhatsApp Manager / texto propio |
| `XAI_API_KEY`, `XAI_MODEL` | Prod | sí (bot) | console.x.ai |
| `ANTHROPIC_API_KEY` | Prod | no | respaldo de Grok (console.anthropic.com) |
| `TEAM_WHATSAPP_TO` | Prod | no | `whatsapp:+…` del equipo para avisos |
| `ADMIN_PASSWORD` | Prod, Preview | sí | `openssl rand -base64 24` |
| `ADMIN_SESSION_SECRET` | Prod, Preview | recomendada | `openssl rand -hex 32` |
| `CRON_SECRET` | Prod | sí | `openssl rand -hex 32` (Vercel lo manda como Bearer a los crons) |
| `COUPON_CODES` | Prod | no | JSON `{"CODIGO":porcentaje}` |
| `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` | Prod | no | Cloudflare Turnstile |

Variables que **ya no se usan** y hay que borrar de Vercel si siguen cargadas:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (el frontend ya no habla con Supabase),
`VITE_MP_PUBLIC_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`,
`TEST_NOTIFY_SECRET`, `VITE_VERCEL_ENV`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`,
`NEXT_PUBLIC_*`.

---

## 5. Base de datos (Supabase) — migraciones en dos fases

Las migraciones están en `supabase/migrations/` y se ejecutan a mano en
*Supabase > SQL Editor* (proyecto `wxjytqjwoarmqvceyvqj`), completas, en este orden:

1. **Fase A — `2026-09-05_a_immediate_pii_lockdown.sql`: ANTES del deploy.**
   Cierra la fuga de datos personales por la clave anon, crea las tablas
   `admin_login_attempts`, `api_rate_limits` y `whatsapp_conversations`, agrega
   `payment_reminder_sent_at` y saca `reservations` de Realtime. El sitio viejo sigue
   funcionando (sólo pierde el listado del panel admin hasta el deploy).
2. **Deploy** del código nuevo (push a `main`) y verificación (§9).
3. **Fase B — `2026-09-05_b_after_deploy_integrity.sql`: DESPUÉS del deploy.**
   Quita todo acceso anon, agrega los estados y columnas nuevas (`refunded`,
   `payment_conflict`, `cancel_reason`, `coupon_*`, `public_token`, `client_ip`, …), los CHECK
   y la constraint de exclusión anti doble reserva. El código está preparado para correr
   con la base en Fase A (reintenta sin las columnas nuevas), pero la protección completa
   sólo existe con Fase B aplicada.

Después de cada fase: `SELECT * FROM public.reservations LIMIT 1` con la service role para
confirmar que las columnas existen, y el probe anon de §9.

**Supabase Auth:** el proyecto no usa Auth. En *Authentication > Sign In / Providers*
desactivar **Allow new users to sign up** (y el proveedor Email) para que nadie pueda
crearse un usuario `authenticated`.

**Backups:** ver `SECURITY.md` §5 (pg_dump semanal).

---

## 6. Mercado Pago

1. MP Developers > Tu aplicación > **Webhooks** (modo *Productivo*):
   - URL: `https://www.espacioauditorium.com.ar/api/payment-webhook` (**con www**; el apex
     responde 308 y Mercado Pago no sigue redirects).
   - Eventos: **Pagos**.
   - Copiar la **Clave secreta** → `MP_WEBHOOK_SECRET` en Vercel.
2. Credenciales de producción → `MP_ACCESS_TOKEN`.
3. Verificar en la misma pantalla el historial de notificaciones: tienen que figurar con
   **200**. Un 401 = secreto distinto entre MP y Vercel; un 308 = URL sin www.
4. Prueba real: hacer una reserva de prueba de media jornada y pagar con una tarjeta real
   (o con credenciales de test y `MP_ALLOW_TEST_PAYMENTS=true` en un Preview). La reserva
   tiene que pasar a `deposit_paid`, aparecer en Google Calendar y llegar el email. Después
   cancelar/reembolsar desde el panel de MP.

---

## 7. Bot de WhatsApp (Meta Cloud API + Grok)

App de Meta **Espacio Auditorium Bot** > WhatsApp > Configuración > Webhook:
`https://www.espacioauditorium.com.ar/api/whatsapp-meta`, token de verificación =
`WA_VERIFY_TOKEN`, campo suscripto `messages`. La firma `X-Hub-Signature-256` se valida con
`META_APP_SECRET` (falla cerrado). Probar con un mensaje real al número del bot después de
cada deploy: si no contesta, revisar Vercel > Logs `[wa-meta]` (`401` = `META_APP_SECRET`
no coincide).

---

## 8. Crons

Definidos en `vercel.json`; Vercel los invoca con `Authorization: Bearer $CRON_SECRET`
(sin la variable, todos rechazan). Horarios en UTC.

| Path | Horario (UTC) | Qué hace |
|------|---------------|----------|
| `/api/keep-alive` | 09:00 | Ping a Supabase (evita la pausa del plan free) y chequeo de tablas |
| `/api/payment-reminder` | 10:00 | Recordatorio de seña a reservas pendientes |
| `/api/auto-cancel` | 11:00 | Cancela reservas pendientes vencidas (verificando antes en MP) |
| `/api/send-reminders` | 12:00 | Recordatorio del evento al cliente |

---

## 9. Checklist de verificación post-deploy

```bash
SITE=https://www.espacioauditorium.com.ar

# Headers de seguridad y caché
curl -sI $SITE/ | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
curl -sI $SITE/admin | grep -iE 'x-robots-tag|cache-control'
curl -sI "$SITE/assets/$(curl -s $SITE/ | grep -oE 'assets/index-[^"]+\.js' | head -1 | cut -d/ -f2)" | grep -i cache-control

# Disponibilidad pública (200 + JSON; 503 si Google Calendar no responde)
curl -s "$SITE/api/availability?from=$(date +%F)&to=$(date -v+30d +%F 2>/dev/null || date -d '+30 days' +%F)"

# Endpoints protegidos: tienen que rechazar
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/keep-alive                       # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $SITE/api/whatsapp-meta            # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $SITE/api/admin-reservations       # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' $SITE/api/payment-webhook   # 401 (con MP_WEBHOOK_SECRET)
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/api/reservations/00000000-0000-0000-0000-000000000000?t=x"            # 404

# Hosts alternativos: 308 a www (o 401 si Deployment Protection está activa)
curl -s -o /dev/null -w '%{http_code}\n' https://espacioauditorium.com.ar/
curl -s -o /dev/null -w '%{http_code}\n' https://espacio-auditorium.vercel.app/

# Supabase: la clave anon no tiene que ver datos personales (tras Fase B: sin acceso)
curl -s "https://wxjytqjwoarmqvceyvqj.supabase.co/rest/v1/reservations?select=email" -H "apikey: $SUPABASE_ANON_KEY"
```

Además, a mano:

- [ ] Abrir la home con la consola del navegador: **sin errores de CSP** (Doppler, Pixel,
      GA, Matterport, Google Maps, Google Fonts tienen que cargar). Si aparece uno,
      agregar el origen a `Content-Security-Policy` en `vercel.json`.
- [ ] `/reservar`: el calendario muestra las fechas bloqueadas; el botón *Continuar* se
      deshabilita si `/api/availability` falla.
- [ ] Pago de prueba de punta a punta (§6) y mensaje de prueba al bot (§7).
- [ ] `/admin`: login, listado, bloqueo de fechas, cancelación.
- [ ] Vercel > Cron Jobs: la próxima ejecución de cada cron termina en 200.
- [ ] Vercel > Logs: sin `[error]` en los primeros minutos.

---

## 10. Desarrollo local

```bash
nvm use                      # Node 24 (.nvmrc)
npm ci
cp .env.example .env.local   # completar valores (usar credenciales de TEST de MP)
npm run dev                  # sólo frontend (proxy /api → localhost:3001)
npx vercel dev               # frontend + funciones api/ (requiere `vercel link`)
npm run lint                 # ESLint (src + api)
npm run check:api            # node --check de todas las funciones
npm run audit:prod           # vulnerabilidades en dependencias de producción
npm run build                # build igual al de Vercel (dist/ + páginas prerender)
```

`vercel env pull` escribe en `.vercel/` (ignorado por git). El archivo
`.vercel/.env.production.local` que hay hoy en disco es un volcado completo de producción
de abril: **borrarlo** (`rm .vercel/.env.production.local`) y no volver a hacer `pull` de
Production en una máquina de trabajo.

---

## 11. Dependencias y mantenimiento

- `npm run audit:prod` falla mientras queden vulnerabilidades *high* en producción. Hoy quedan
  dos que requieren cambio de versión mayor y se resuelven en un branch aparte con pruebas:
  `nodemailer` 8 → 9/10 (advisory sobre la opción `raw`, que el código no usa) y
  `mercadopago` 2 → 3 (por `uuid`; la API del SDK cambia).
- Vite queda en 5 (sólo afecta al servidor de desarrollo). Tarea pendiente: subir a Vite 6/7
  junto con `@vitejs/plugin-react`.
- React Router 7 → siguiente mayor: probar en Preview antes.
- Cuando el frontend deje de usar `googleapis` (paquete grande, ~40 MB por función), quitarlo
  de `package.json`; las funciones ya usan `@googleapis/calendar` y `@googleapis/sheets`.
