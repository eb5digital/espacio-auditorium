/**
 * Seguimiento automático por WhatsApp (Meta Cloud API). Corre dentro de /api/cron-daily.
 *
 * APAGADO por defecto: sólo actúa con WA_FOLLOWUP_ENABLED=true y una plantilla aprobada
 * por Meta en WA_TEMPLATE_FOLLOWUP (categoría Marketing, idioma es_AR, 1 variable = nombre).
 *
 * A quién le escribe (un único seguimiento por conversación):
 *   - conversación del canal Meta, estado 'active' (no derivada, no cerrada)
 *   - el último mensaje es del bot (el cliente dejó de responder)
 *   - silencio de entre 20 h y 72 h
 *   - mostró intención: mencionó una fecha o mandó 2+ mensajes
 *   - no pidió la baja (lead_data.opt_out) y no recibió seguimiento antes
 *
 * Orden por fila: marcar followup_sent_at → enviar (si falla el envío, no se reintenta).
 */
import { supabaseAdmin, logError, json } from './_utils.js'
import { extractDate, maskPhone } from './_wa-core.js'

const MIN_SILENCE_H = 20
const MAX_SILENCE_H = 72
const BATCH_LIMIT = 30
const GRAPH = (process.env.WA_GRAPH_VERSION || 'v23.0').trim()

function hasIntent(messages) {
  const userMsgs = messages.filter(m => m?.role === 'user' && typeof m.content === 'string')
  if (userMsgs.length >= 2) return true
  return userMsgs.some(m => !!extractDate(m.content))
}

function firstName(ld) {
  const n = String(ld?.nombre || ld?.nombre_perfil || '').trim().split(/\s+/)[0] || ''
  return n.replace(/[^\p{L}'-]/gu, '').slice(0, 30) || 'hola'
}

async function sendTemplate(toDigits, name, variable) {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'template',
      template: { name, language: { code: 'es_AR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: variable }] }] },
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!resp.ok) throw new Error(`Graph ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
}

export default async function waFollowup(req, res) {
  const enabled = (process.env.WA_FOLLOWUP_ENABLED || '').trim().toLowerCase() === 'true'
  const template = (process.env.WA_TEMPLATE_FOLLOWUP || '').trim()
  if (!enabled || !template || !process.env.WA_PHONE_NUMBER_ID || !process.env.WA_ACCESS_TOKEN) {
    return json(res, { skipped: true, reason: 'desactivado o sin configurar' })
  }

  const db = supabaseAdmin()
  const now = Date.now()
  const { data, error } = await db
    .from('whatsapp_conversations')
    .select('phone, messages, status, lead_data, updated_at')
    .eq('status', 'active')
    .lte('updated_at', new Date(now - MIN_SILENCE_H * 3600e3).toISOString())
    .gte('updated_at', new Date(now - MAX_SILENCE_H * 3600e3).toISOString())
    .limit(BATCH_LIMIT)
  if (error) throw error

  let sent = 0, skipped = 0, failed = 0
  for (const row of data || []) {
    const ld = row.lead_data && typeof row.lead_data === 'object' ? row.lead_data : {}
    const messages = Array.isArray(row.messages) ? row.messages : []
    const last = messages[messages.length - 1]
    if (ld.canal !== 'meta' || ld.opt_out || ld.followup_sent_at || last?.role !== 'assistant' || !hasIntent(messages)) {
      skipped++
      continue
    }
    const stamp = new Date().toISOString()
    const { error: upErr } = await db
      .from('whatsapp_conversations')
      .update({
        lead_data: { ...ld, followup_sent_at: stamp },
        messages: [...messages, { role: 'assistant', content: `[Seguimiento automático: plantilla ${template}]` }].slice(-30),
      })
      .eq('phone', row.phone)
      .eq('status', 'active')
    if (upErr) { logError('wa-followup:mark', upErr); skipped++; continue }
    try {
      await sendTemplate(row.phone.replace(/\D/g, ''), template, firstName(ld))
      sent++
      console.log(`[wa-followup] enviado a ${maskPhone(row.phone)}`)
    } catch (err) {
      failed++
      logError('wa-followup:send', err, { phone: maskPhone(row.phone) })
    }
  }
  return json(res, { sent, skipped, failed, candidates: (data || []).length })
}
