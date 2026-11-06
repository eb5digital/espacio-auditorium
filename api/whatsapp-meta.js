/**
 * /api/whatsapp-meta — webhook de WhatsApp (Meta Cloud API oficial) atendido por Grok.
 *
 * Reemplazó al bot de Twilio (retirado), sin intermediarios. Misma lógica de negocio
 * (api/_wa-core.js): system prompt, disponibilidad verificada, derivación, hoja "Leads",
 * historial en whatsapp_conversations (lo sigue viendo el panel /admin).
 *
 * GET  → verificación del webhook (hub.challenge) con WA_VERIFY_TOKEN.
 * POST → mensajes entrantes. Firma X-Hub-Signature-256 con META_APP_SECRET (falla CERRADO).
 *        Responde 200 de inmediato y procesa con waitUntil (Meta reintenta si tardamos).
 *
 * Variables:
 *   WA_VERIFY_TOKEN, META_APP_SECRET, WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID   (obligatorias)
 *   XAI_API_KEY, XAI_MODEL (default grok-4), WA_LLM_PROVIDER (xai|anthropic)
 *   WA_GRAPH_VERSION (default v23.0)
 *   TEAM_WHATSAPP_TO (whatsapp:+549...), WA_TEAM_ALERT_TEMPLATE (plantilla utility, 1 variable)
 *   EMAIL_USER / EMAIL_APP_PASSWORD (aviso al equipo por mail, ya existentes)
 *
 * Nunca se loguea el teléfono completo ni el contenido de los mensajes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { checkRateLimit, hashKey, logError, escapeHtml } from './_utils.js'
import { dayStatus } from './_availability.js'
import { todayLocal } from './_dates.js'
import { sendMail, BUSINESS_EMAIL } from './_email.js'
import {
  WA_ADDRESS_RE, TEAM_TO, MAX_BODY_CHARS, LEAD_KEYS, LEAD_FIELD_MAX, RATE_LIMITS,
  HUMAN_RESPONSE, MEDIA_RESPONSE, TOO_LONG_RESPONSE, RATE_LIMIT_RESPONSE, FALLBACK_RESPONSE,
  isHumanRequest, maskPhone, stripControl, cleanLeadValue, parseSignal, formatTeamMsg,
  logFirstContact, appendLeadToSheet, extractDate, availabilityNote,
  getConversation, saveConversation, historyForModel, lastUserContent, askModel, addAiUsage,
} from './_wa-core.js'

const GRAPH = (process.env.WA_GRAPH_VERSION || 'v23.0').trim()
const OPT_OUT_RE = /^\s*(baja|stop|no\s+me\s+interesa|no\s+me\s+escriban|no\s+quiero\s+m[aá]s\s+mensajes|desuscribir(?:me)?)\s*[.!]*\s*$/i
const OPT_OUT_RESPONSE = 'Listo, no te vamos a enviar más mensajes de seguimiento. Si en algún momento necesitás el espacio, escribinos cuando quieras 👋'

// ---------------------------------------------------------------------------
// Graph API
// ---------------------------------------------------------------------------
function graphUrl() {
  const id = (process.env.WA_PHONE_NUMBER_ID || '').trim()
  if (!id) throw new Error('WA_PHONE_NUMBER_ID no configurado')
  return `https://graph.facebook.com/${GRAPH}/${id}/messages`
}

async function graphPost(payload) {
  const token = (process.env.WA_ACCESS_TOKEN || '').trim()
  if (!token) throw new Error('WA_ACCESS_TOKEN no configurado')
  const resp = await fetch(graphUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    signal: AbortSignal.timeout(8000),
  })
  if (!resp.ok) throw new Error(`Graph ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  return resp.json()
}

export async function sendText(toDigits, text) {
  return graphPost({ recipient_type: 'individual', to: toDigits, type: 'text', text: { body: String(text).slice(0, 4000), preview_url: true } })
}

async function markRead(messageId) {
  try {
    await graphPost({ status: 'read', message_id: messageId })
  } catch (err) {
    logError('wa-meta:read', err)
  }
}

// ---------------------------------------------------------------------------
// Aviso al equipo: mail (siempre) + WhatsApp (texto si hay ventana abierta, o plantilla)
// ---------------------------------------------------------------------------
async function notifyTeam(body) {
  const tasks = []
  if (BUSINESS_EMAIL) {
    const subject = body.split('\n')[0].replace(/[*_]/g, '').slice(0, 120)
    tasks.push(sendMail({
      to: BUSINESS_EMAIL,
      subject,
      html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body.replace(/[*_]/g, ''))}</pre>`,
      fromName: 'Bot WhatsApp — Espacio Auditorium',
    }))
  }
  const teamDigits = TEAM_TO.replace(/\D/g, '')
  if (teamDigits) {
    const template = (process.env.WA_TEAM_ALERT_TEMPLATE || '').trim()
    tasks.push(
      (async () => {
        try {
          await sendText(teamDigits, body)
        } catch (err) {
          // Fuera de la ventana de 24 h el texto libre falla: usar plantilla si está configurada.
          if (!template) throw err
          await graphPost({
            to: teamDigits,
            type: 'template',
            template: {
              name: template,
              language: { code: 'es_AR' },
              components: [{ type: 'body', parameters: [{ type: 'text', text: body.replace(/[\n*_]+/g, ' ').slice(0, 900) }] }],
            },
          })
        }
      })()
    )
  }
  const results = await Promise.allSettled(tasks)
  results.forEach(r => { if (r.status === 'rejected') logError('wa-meta:team-notify', r.reason) })
}

// ---------------------------------------------------------------------------
// Firma y cuerpo crudo
// ---------------------------------------------------------------------------
async function readRawBody(req) {
  // Vercel parsea req.body de forma perezosa: si no lo tocamos, el stream sigue disponible.
  const chunks = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks)
}

function validSignature(raw, header) {
  const secret = (process.env.META_APP_SECRET || '').trim()
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  const got = header.slice(7)
  if (got.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'))
}

// ---------------------------------------------------------------------------
// Procesamiento de un mensaje
// ---------------------------------------------------------------------------
function extractText(m) {
  if (m.type === 'text') return m.text?.body ?? ''
  if (m.type === 'button') return m.button?.text ?? ''
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''
  return null   // audio, imagen, documento, sticker, ubicación…
}

// Lista de bloqueo: números que se descartan ANTES de leer, marcar como leído, responder o llamar al modelo.
// Se compara por los últimos 10 dígitos (cubre 549… y 54… sin el 9). Se puede ampliar sin tocar código
// con la variable WA_BLOCKED_NUMBERS (números separados por coma).
const BLOCKED_DEFAULT = ['5491131567272', '5491149399253', '5491133133185']
const last10 = n => String(n).replace(/\D/g, '').slice(-10)
const BLOCKED_TAILS = new Set(
  [...BLOCKED_DEFAULT, ...String(process.env.WA_BLOCKED_NUMBERS || '').split(',')]
    .map(last10).filter(t => t.length === 10),
)

async function processMessage(m, contact) {
  const fromDigits = String(m.from || '').replace(/\D/g, '')
  if (BLOCKED_TAILS.has(last10(fromDigits))) {
    console.warn(`[wa-meta] número bloqueado ...${last10(fromDigits).slice(-4)}: se descarta sin responder ni gastar IA`)
    return
  }
  const phone = `whatsapp:+${fromDigits}`            // mismo formato que la tabla y el panel /admin
  if (!WA_ADDRESS_RE.test(phone)) return
  const who = maskPhone(phone)
  const messageSid = typeof m.id === 'string' ? m.id.slice(0, 128) : null
  const reply = text => sendText(fromDigits, text)

  markRead(m.id)

  const rawText = extractText(m)
  if (rawText === null) {
    console.log(`[wa-meta] ${who}: adjunto (${m.type}) → respuesta fija`)
    return reply(MEDIA_RESPONSE)
  }
  const userText = stripControl(rawText).replace(/\r\n?/g, '\n').trim()
  if (!userText) return
  if (userText.length > MAX_BODY_CHARS) return reply(TOO_LONG_RESPONSE)

  console.log(`[wa-meta:in] ${who} len=${userText.length}`)

  try {
    const phoneKey = hashKey(phone)
    const [limits, conv] = await Promise.all([
      Promise.all(RATE_LIMITS.map(l => checkRateLimit({ ...l, key: phoneKey }))),
      getConversation(phone),
    ])
    if (limits.find(l => !l.allowed)) {
      console.warn(`[wa-meta] ${who}: rate limit alcanzado`)
      return reply(RATE_LIMIT_RESPONSE)
    }
    if (messageSid && conv.last_message_sid === messageSid) {
      console.log(`[wa-meta] ${who}: mensaje repetido (reintento de Meta), se ignora`)
      return
    }

    const baseLeadData = { ...(conv.lead_data || {}) }
    if (!baseLeadData.canal) baseLeadData.canal = 'meta'
    if (m.referral && !baseLeadData.origen) {
      baseLeadData.origen = 'meta_ads'
      baseLeadData.origen_ref = cleanLeadValue(m.referral.source_id || m.referral.headline || '')
    }
    if (!baseLeadData.nombre_perfil && contact?.profile?.name) baseLeadData.nombre_perfil = cleanLeadValue(contact.profile.name)
    baseLeadData.last_inbound_at = new Date().toISOString()

    const needsSheetLog = !baseLeadData.sheet_logged
    const messages = [...conv.messages, { role: 'user', content: userText }]
    const statusPatch = conv.status === 'closed' ? { status: 'active' } : {}

    // Baja de seguimientos
    if (OPT_OUT_RE.test(userText)) {
      const updated = [...messages, { role: 'assistant', content: OPT_OUT_RESPONSE }]
      await saveConversation(phone, updated, { status: 'closed', lead_data: { ...baseLeadData, opt_out: true } }, messageSid)
      return reply(OPT_OUT_RESPONSE)
    }

    // Pedido explícito de humano → derivación directa (sin IA)
    if (isHumanRequest(userText)) {
      const updated = [...messages, { role: 'assistant', content: HUMAN_RESPONSE }]
      const ld = { ...baseLeadData, derivacion_manual: 'si', sheet_logged: true }
      await saveConversation(phone, updated, { status: 'qualified', lead_data: ld }, messageSid)
      await reply(HUMAN_RESPONSE)
      const knownLead = Object.fromEntries(LEAD_KEYS.filter(k => baseLeadData[k]).map(k => [k, cleanLeadValue(baseLeadData[k])]))
      knownLead.notas = [knownLead.notas, 'Pidió hablar con una persona'].filter(Boolean).join(' · ').slice(0, LEAD_FIELD_MAX)
      const tasks = [notifyTeam(formatTeamMsg(knownLead, phone, 'PIDE HABLAR CON EL EQUIPO'))]
      if (needsSheetLog) tasks.push(logFirstContact(phone))
      await Promise.allSettled(tasks)
      return
    }

    // Disponibilidad verificada (mismo módulo que la web)
    const today = todayLocal()
    const mentionedDate = extractDate(userText, today) || extractDate(lastUserContent(conv.messages), today)
    let note = null
    if (mentionedDate) {
      if (mentionedDate < today) {
        note = availabilityNote(mentionedDate, null, today)
      } else {
        try {
          note = availabilityNote(mentionedDate, await dayStatus(mentionedDate), today)
        } catch (err) {
          logError('wa-meta:availability', err)
          note = availabilityNote(mentionedDate, null, today)
        }
      }
    }

    // IA (Grok por defecto, Claude de respaldo si está configurado)
    const { text: raw, stopReason, provider, usage } = await askModel(historyForModel(messages), note)
    baseLeadData.ai_usage = addAiUsage(baseLeadData.ai_usage, provider, usage)
    if (!raw.trim()) throw new Error(`Respuesta vacía del modelo (${provider}, ${stopReason})`)
    const parsed = parseSignal(raw)
    const message = parsed.message || (parsed.action === 'qualify' ? HUMAN_RESPONSE : 'Solo puedo ayudarte con consultas sobre Espacio Auditorium.')
    console.log(`[wa-meta:out] ${who} action=${parsed.action} len=${message.length} llm=${provider} stop=${stopReason}`)

    await reply(message)

    const updated = [...messages, { role: 'assistant', content: message }]
    const tasks = []
    if (parsed.action === 'qualify' && parsed.lead) {
      await saveConversation(phone, updated, { status: 'qualified', lead_data: { ...baseLeadData, ...parsed.lead, sheet_logged: true } }, messageSid)
      tasks.push(notifyTeam(formatTeamMsg(parsed.lead, phone)))
      tasks.push(appendLeadToSheet(parsed.lead, phone, updated))
    } else if (parsed.action === 'close') {
      await saveConversation(phone, updated, { status: 'closed', lead_data: { ...baseLeadData, sheet_logged: true } }, messageSid)
    } else {
      await saveConversation(phone, updated, { ...statusPatch, lead_data: { ...baseLeadData, sheet_logged: true } }, messageSid)
    }
    if (needsSheetLog) tasks.push(logFirstContact(phone))
    const results = await Promise.allSettled(tasks)
    results.forEach(r => { if (r.status === 'rejected') logError('wa-meta:post', r.reason) })
  } catch (err) {
    logError('wa-meta:handler', err, { phone: who })
    try { await reply(FALLBACK_RESPONSE) } catch (e) { logError('wa-meta:fallback', e) }
  }
}

async function processPayload(payload) {
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}
      const contact = value.contacts?.[0]
      // Mensajes de a uno y en orden, para que el historial no se pise.
      for (const m of value.messages ?? []) await processMessage(m, contact)
    }
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    const q = req.query || {}
    const token = (process.env.WA_VERIFY_TOKEN || '').trim()
    if (token && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === token) {
      return res.status(200).send(String(q['hub.challenge'] ?? ''))
    }
    return res.status(403).send('Forbidden')
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).send('Method not allowed')
  }

  let raw
  try {
    raw = await readRawBody(req)
  } catch (err) {
    logError('wa-meta:body', err)
    return res.status(400).send('Bad request')
  }
  if (!validSignature(raw, req.headers['x-hub-signature-256'])) {
    console.error('[wa-meta:security] firma inválida o META_APP_SECRET sin configurar')
    return res.status(401).send('Invalid signature')
  }

  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    return res.status(400).send('Bad JSON')
  }

  waitUntil(processPayload(payload).catch(err => logError('wa-meta:process', err)))
  return res.status(200).send('OK')
}
