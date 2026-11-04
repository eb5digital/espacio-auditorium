# Seguridad — Espacio Auditorium

Documento operativo: qué protegemos, cómo rotar cada secreto, qué hacer ante un
incidente, cómo se hacen los backups y qué verificar después de cada deploy.
Complementa a `DEPLOY.md` (cómo se despliega) y `docs/RUNBOOK.md` (operación diaria).

**Reportar una vulnerabilidad:** escribir a la casilla del negocio
(`EMAIL_USER`) con asunto "Seguridad – sitio web". No abrir issues públicos con detalles.

---

## 1. Modelo de amenazas (resumen)

### Activos
- **Datos personales de clientes**: nombre, email, WhatsApp, notas del evento, montos e IDs
  de pago (tabla `reservations`, `whatsapp_conversations`, planilla de leads). Ley 25.326.
- **Dinero**: señas cobradas por Mercado Pago; capacidad de reembolsar con el `MP_ACCESS_TOKEN`.
- **Disponibilidad del espacio**: el calendario (Supabase + Google Calendar) es la fuente
  de verdad comercial; una doble reserva o un bloqueo falso cuesta plata y reputación.
- **Cuentas del negocio**: Gmail (envía todos los emails), Twilio (WhatsApp), Anthropic
  (crédito del bot), Vercel, Supabase, GitHub.

### Superficies expuestas
| Superficie | Quién la usa | Control |
|-----------|--------------|---------|
| `POST /api/create-payment` | público | validación server-side de fechas/precio, Turnstile (opcional), rate limit por IP (10/h) y por email (5/día), chequeo de disponibilidad que falla cerrado si Google no responde |
| `POST /api/payment-webhook` | Mercado Pago | firma HMAC `x-signature` con `MP_WEBHOOK_SECRET`, re-consulta del pago en MP, verificación de monto/moneda/`live_mode`, idempotencia por estado, UNIQUE en `mp_payment_id` |
| `POST /api/whatsapp-meta` | Meta | firma `X-Hub-Signature-256` con `META_APP_SECRET` (falla cerrado), rate limit por teléfono, dedupe por id de mensaje, timeout 15 s a Grok |
| `GET /api/availability` | público | sólo devuelve fechas/franjas (sin datos personales), caché 60 s |
| `GET /api/reservations/:id?t=` | cliente que pagó | UUID + token aleatorio `public_token`; campos mínimos; `no-store` |
| `POST /api/admin-*` | dueño | password con rate limit por IP (5 intentos / 15 min, comparación en tiempo constante) → token firmado HMAC 12 h en `Authorization: Bearer`; `/admin` con `noindex` y `no-store` |
| Crons `/api/*` | Vercel | `Authorization: Bearer $CRON_SECRET`, falla cerrado |
| Supabase REST/Realtime | nadie (Fase B) | anon sin privilegios; RLS; `reservations` fuera de Realtime |
| Frontend | público | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; sin claves de Supabase en el bundle |
| Hosts `*.vercel.app` | nadie | redirect 308 a www + Deployment Protection |

### Amenazas principales y mitigación
1. **Manipulación de precio / pago parcial** → el precio se calcula en el servidor y el webhook
   compara `transaction_amount` con `deposit_amount` (si difiere: `payment_conflict` y aviso).
2. **Doble reserva** (carrera entre dos clientes, o contra un evento del calendario) →
   `api/_availability.js` es la única fuente (reservas activas + holds de 2 h + `blocked_dates`
   + Google Calendar), el webhook re-chequea y la base tiene una constraint de exclusión.
3. **Fuga de datos personales** → sin acceso anon a la base, endpoints con campos mínimos,
   `escapeHtml` en todo email, IDs no enumerables.
4. **Abuso / costo** (spam de reservas, quemar crédito de Anthropic, quota de Gmail) →
   rate limits en base (`api_rate_limits`), firmas en webhooks, WAF de Vercel.
5. **Secretos filtrados** (scripts `.command`, PAT en el remote, `.env` en disco) → ver §3.
6. **Inyección en emails/calendario/Sheets** → escape HTML, prefijo `'` en celdas con
   `= + - @`, títulos de eventos neutros.

**Pendiente conocido (siguiente paso):** la CSP permite `'unsafe-inline'` en `script-src`
porque los snippets del Pixel de Meta y de GA4 viven inline en `index.html`. El paso
siguiente es servirlos con *nonce* (o moverlos a un archivo propio) y quitar
`'unsafe-inline'`. También queda pendiente el tag `preload` de HSTS: la cabecera ya lo
declara pero **no** enviamos el dominio a la lista de precarga hasta confirmar que todos
los subdominios sirven HTTPS.

---

## 2. Reglas de manejo de secretos

- Los secretos viven **sólo** en Vercel (Environment Variables) y en `.env.local` de cada
  máquina. Nunca en el código, en scripts, en commits, en capturas ni en chats.
- Ningún secreto en variables `VITE_*` (van al bundle público).
- `.gitignore` bloquea `.env*` (salvo `.env.example`), `.vercel/` y `*.command`.
- Antes de cada commit: `git status` y `git diff --cached | grep -iE 'APP_USR|eyJ|sk-ant|AC[0-9a-f]{32}'`
  tiene que devolver vacío.
- Si un secreto tocó git (aunque sea en un branch), se rota; borrar el commit no alcanza.

---

## 3. Rotación de secretos

Estado al 2026-09-05: existen en disco 10 scripts `*.command` con el token de Mercado Pago,
la service role de Supabase y otros secretos literales; el remote de git tiene un PAT de
GitHub embebido en la URL; `.env.local` mezcla variables de otro proyecto; y
`.vercel/.env.production.local` es un volcado completo del entorno de producción.
**Todo lo que figura ahí se considera comprometido y se rota.** Orden sugerido:

### 3.1 GitHub PAT embebido en el remote
```bash
git remote -v                                   # si la URL contiene "@github.com" con token…
git remote set-url origin https://github.com/memidigitals-ia/espacio-auditorium.git
```
Luego GitHub > Settings > Developer settings > Personal access tokens: **revocar** ese token.
Usar Git Credential Manager / osxkeychain o SSH para autenticarse.

### 3.2 Mercado Pago (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`)
1. MP Developers > Tu aplicación > Credenciales de producción > **Renovar** credenciales.
2. Cargar el nuevo Access Token en Vercel (Production) y hacer **Redeploy**.
3. Webhooks > regenerar la clave secreta → `MP_WEBHOOK_SECRET` en Vercel → Redeploy.
4. Verificar con un pago de prueba que el webhook responde 200.

### 3.3 Supabase service role (`SUPABASE_SERVICE_ROLE_KEY`)
1. Supabase > Settings > API > *JWT Secret* > **Generate a new JWT secret** (invalida
   anon y service_role a la vez; el frontend ya no usa la anon).
2. Copiar la nueva `service_role` a Vercel → Redeploy. Ningún otro sistema usa esa clave.

### 3.4 Twilio (`TWILIO_AUTH_TOKEN`)
Console > Account > API keys & tokens > *Auth Token* > **Request secondary token**, ponerlo en
Vercel, Redeploy, probar el bot con un mensaje real y recién ahí **promover** el secundario
y borrar el primario.

### 3.5 Gmail (`EMAIL_APP_PASSWORD`)
Cuenta de Google > Seguridad > Contraseñas de aplicaciones > eliminar la actual y crear una
nueva → Vercel → Redeploy → mandarse un email de prueba (por ejemplo cancelando una reserva
de prueba desde `/admin`).

### 3.6 Anthropic (`ANTHROPIC_API_KEY`)
console.anthropic.com > API keys > crear una nueva, cargarla en Vercel, Redeploy, probar el
bot, revocar la vieja.

### 3.7 `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET`
`openssl rand -base64 24` y `openssl rand -hex 32`. Al cambiar el session secret se cierran
todas las sesiones del panel (hay que volver a loguearse).

### 3.8 `CRON_SECRET`
`openssl rand -hex 32` → Vercel (Production) → Redeploy. Vercel manda el nuevo valor
automáticamente en la próxima ejecución.

### 3.9 Google service account
Google Cloud > IAM > Service Accounts > Keys > crear clave JSON nueva → pegar en
`GOOGLE_SERVICE_ACCOUNT_JSON` (una línea) → Redeploy → probar `/api/availability` → borrar
la clave vieja.

### 3.10 CallMeBot
No tiene rotación formal: dejar de usarlo o pedir un apikey nuevo desde el número del
negocio.

### 3.11 Limpieza local (después de rotar)
```bash
mkdir -p ~/espacio-auditorium-privado && mv *.command ~/espacio-auditorium-privado/
rm -f .vercel/.env.production.local
# Dejar en .env.local sólo las variables de .env.example (borrar NEXT_PUBLIC_*, RESEND_API_KEY,
# MERCADOPAGO_ACCESS_TOKEN, TURBO_*, VERCEL_*, VITE_SUPABASE_*, VITE_MP_PUBLIC_KEY, TEST_NOTIFY_SECRET).
```
Los scripts, si se quieren conservar, se reescriben para leer los valores de `.env.local`
(`set -a; source .env.local; set +a`) en vez de tenerlos hardcodeados, y sin `vercel --prod`.

---

## 4. Runbook de incidentes

### 4.1 Doble reserva (dos clientes pagaron la misma fecha/franja)
Con la Fase B aplicada la base lo impide: el segundo pago queda en estado
`payment_conflict` (`cancel_reason = 'slot_conflict'`), el negocio recibe un email y el
cliente un aviso. Qué hacer:
1. `/admin` > filtrar *Conflicto de pago* → ver la reserva.
2. Mercado Pago > Actividad > buscar el `mp_payment_id` → **Reembolsar** total.
3. Contactar al cliente (WhatsApp) ofreciendo otra fecha; si acepta, cargarle un link nuevo
   de `/reservar?from=YYYY-MM-DD`.
4. Si ocurrió por un evento cargado a mano en Google Calendar después del pago, la reserva
   web tiene prioridad: mover el evento manual.
Si la Fase B **no** está aplicada (sin constraint), comparar en `/admin` las reservas
activas de esa fecha y aplicar el mismo procedimiento con la más reciente.

### 4.2 El webhook de Mercado Pago falla (pagos que no se confirman)
Síntomas: el cliente pagó (aparece en MP) pero la reserva sigue `pending_payment`, no hay
evento en Calendar ni email.
1. MP Developers > Webhooks > historial: ver el código de respuesta.
   - **308** → la URL configurada no tiene `www`. Corregirla.
   - **401** → `MP_WEBHOOK_SECRET` distinto entre MP y Vercel. Regenerar y cargar.
   - **500** → ver Vercel > Logs (`[payment-webhook]`): suele ser Supabase o MP caídos; MP
     reintenta solo. Si no reintenta, usar el botón *Reenviar notificación* del historial.
   - **200 pero sigue pendiente** → el pago no está `approved`, o el monto no coincide
     (`payment_conflict`, ver 4.1).
2. Mientras tanto, para no perder la fecha: `/admin` > *Bloquear fechas* sobre ese día.
3. Nunca marcar a mano una reserva como pagada sin ver el pago aprobado en MP.

### 4.3 Sospecha de fuga de secretos o acceso indebido
1. **Contener**: rotar en este orden `SUPABASE_SERVICE_ROLE_KEY` → `MP_ACCESS_TOKEN` →
   `ADMIN_PASSWORD`/`ADMIN_SESSION_SECRET` → `TWILIO_AUTH_TOKEN` → `ANTHROPIC_API_KEY` →
   `EMAIL_APP_PASSWORD` → `CRON_SECRET` (§3). Redeploy.
2. Vercel > Deployment Protection en *Standard*; Firewall > *Attack Challenge Mode* si hay
   tráfico anómalo.
3. **Evaluar**: Supabase > Logs (PostgREST/Auth) y Vercel > Logs para ver qué se leyó/escribió;
   revisar `admin_login_attempts` y `api_rate_limits`; MP > Actividad por reembolsos no
   autorizados; Anthropic > Usage por consumo anormal.
4. **Notificar**: si se accedió a datos personales de clientes, avisar a los afectados y
   registrar el incidente (fecha, alcance, medidas) — obligación bajo la Ley 25.326 y la AAIP.
5. **Cerrar**: documentar la causa raíz en `docs/RUNBOOK.md` y agregar el control faltante.

### 4.4 El bot de WhatsApp no responde o responde mal
- No responde: Vercel > Logs `[whatsapp-twilio]`. `403` → URL/token de Twilio (DEPLOY §7).
  Timeout → Anthropic lento; el bot devuelve un fallback con el WhatsApp humano.
- Responde con datos de disponibilidad incorrectos: comparar con `/api/availability`; ambos
  usan el mismo módulo, así que la diferencia está en Google Calendar (evento transparente
  o sin hora) o en `blocked_dates`.
- Gasto anormal en Anthropic: revisar `api_rate_limits` (bucket `wa`) y, si hace falta,
  pausar el sender en Twilio.

### 4.5 Sitio caído o pausado por Vercel
Hobby pausa el proyecto si se supera el uso. Vercel > Usage. Si es un ataque: Firewall >
Attack Challenge Mode + regla de rate limit; si es orgánico: pasar a Pro. Mientras tanto la
reserva se atiende por WhatsApp (el bot también depende de Vercel: avisar a los clientes por
el número humano).

---

## 5. Backups

Supabase free no tiene backups automáticos ni PITR; la única otra copia de las reservas es
Google Calendar. Política: **dump semanal** (y uno manual antes de cada migración).

```bash
# Connection string: Supabase > Settings > Database > Connection string (URI, modo session)
export SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges -Fc \
  -f "espacio-auditorium-$(date +%F).dump"
# Cifrar antes de guardarlo en Drive/iCloud (contiene datos personales):
gpg --symmetric --cipher-algo AES256 "espacio-auditorium-$(date +%F).dump"
```

Automatizarlo con un GitHub Action semanal (`.github/workflows/backup.yml`, secreto
`SUPABASE_DB_URL`, artefacto cifrado con `BACKUP_PASSPHRASE`, retención 90 días) o con la
opción *Backups* de Supabase Pro.

**Restore (probarlo al menos una vez):**
```bash
gpg -d espacio-auditorium-YYYY-MM-DD.dump.gpg > restore.dump
pg_restore --clean --if-exists --no-owner --no-privileges -d "$SUPABASE_DB_URL" restore.dump
```
Después del restore: volver a aplicar las migraciones que falten y correr el checklist de §6.

Retención: 8 dumps semanales + 1 por mes durante un año. Borrar dumps viejos (datos personales).

---

## 6. Checklist post-deploy (seguridad)

- [ ] Migración **Fase A** aplicada antes del deploy y **Fase B** después (DEPLOY §5).
- [ ] `MP_WEBHOOK_SECRET` cargado en Vercel **y** la URL del webhook en MP es `https://www.…/api/payment-webhook`.
- [ ] `CRON_SECRET`, `ADMIN_SESSION_SECRET`, `APP_URL` (www), `TWILIO_WEBHOOK_URL` presentes en Production.
- [ ] Pago de prueba de punta a punta: `deposit_paid`, evento en Calendar, email, `/pago` muestra el estado real.
- [ ] Mensaje de prueba al bot: responde; un `POST` sin firma devuelve 403.
- [ ] Vercel > Deployment Protection = Standard; Framework Preset = Vite; Node 24.x.
- [ ] Supabase > Authentication: signups desactivados.
- [ ] `curl -sI https://www.espacioauditorium.com.ar/` muestra CSP, HSTS, `X-Frame-Options: DENY`.
- [ ] Consola del navegador sin violaciones de CSP en home, `/reservar`, `/pago`, `/admin`.
- [ ] Probe anon a Supabase (`select=email`) devuelve error/vacío.
- [ ] `https://espacio-auditorium.vercel.app/` → 308 a www (o 401).
- [ ] Secretos de los `*.command` rotados y scripts movidos fuera del repo (§3).
- [ ] Notificaciones de Vercel (runtime errors, cron failed) activas; primer cron en 200.
- [ ] Backup manual tomado antes de las migraciones.
