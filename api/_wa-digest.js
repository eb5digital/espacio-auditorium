/**
 * Resumen diario de WhatsApp por mail. Corre dentro de /api/cron-daily (08:00 ART).
 *
 * Qué manda a BUSINESS_EMAIL:
 *   - Actividad de las últimas 24 h: conversaciones nuevas, con movimiento, mensajes, bajas.
 *   - Pendientes de atender: calificadas sin "Atendido" (sin importar la fecha), con link wa.me.
 * Si no hubo actividad ni hay pendientes, no manda nada.
 * Se apaga con WA_DIGEST_ENABLED=false.
 */
import { supabaseAdmin, logError, json, escapeHtml } from './_utils.js'
import { sendMail, BUSINESS_EMAIL } from './_email.js'
import { maskPhone } from './_wa-core.js'

const DAY_MS = 24 * 3600 * 1000
const ADMIN_URL = 'https://www.espacioauditorium.com.ar/admin'

const digits = (phone) => String(phone || '').replace(/\D/g, '')
const leadName = (ld) => String(ld?.nombre || ld?.nombre_perfil || '').trim() || 'Sin nombre'
function lastUserText(messages) {
  const m = [...(messages || [])].reverse().find(x => x?.role === 'user' && typeof x.content === 'string')
  return m ? m.content.replace(/\s+/g, ' ').slice(0, 140) : ''
}
function since(iso) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000)
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

/** Calificada y sin atender, o atendida pero el cliente volvió a escribir después. */
export function isPending(r) {
  if (r.status !== 'qualified') return false
  const h = r.lead_data?.handled_at
  if (!h) return true
  const last = r.lead_data?.last_inbound_at
  return !!last && new Date(last) > new Date(h)
}

export function buildDigest(rows, now = Date.now()) {
  const cutoff = now - DAY_MS
  const recent = rows.filter(r => r.updated_at && new Date(r.updated_at).getTime() >= cutoff)
  const nuevas = recent.filter(r => r.created_at && new Date(r.created_at).getTime() >= cutoff)
  const pendientes = rows.filter(isPending)
  const bajas = recent.filter(r => r.lead_data?.opt_out)
  const mensajes = recent.reduce((n, r) => n + (r.messages || []).filter(m => m?.role === 'user').length, 0)
  return { recent, nuevas, pendientes, bajas, mensajes }
}

function rowHtml(r, withLink) {
  const ld = r.lead_data || {}
  const extra = [ld.tipo, ld.fecha, ld.personas && `${ld.personas} pers.`].filter(Boolean).map(escapeHtml).join(' · ')
  const link = withLink ? ` — <a href="https://wa.me/${digits(r.phone)}">escribirle</a>` : ''
  return `<li style="margin-bottom:10px"><b>${escapeHtml(leadName(ld))}</b> (${escapeHtml(maskPhone(r.phone))}, ${since(r.updated_at)})${link}`
    + (extra ? `<br><span style="color:#555">${extra}</span>` : '')
    + (lastUserText(r.messages) ? `<br><i style="color:#777">“${escapeHtml(lastUserText(r.messages))}”</i>` : '')
    + '</li>'
}

export default async function handler(req, res) {
  if (String(process.env.WA_DIGEST_ENABLED || '').trim().toLowerCase() === 'false') return json(res, { skipped: 'disabled' })
  if (!BUSINESS_EMAIL) return json(res, { skipped: 'sin BUSINESS_EMAIL' })
  try {
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_conversations')
      .select('phone,status,lead_data,messages,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(500)
    if (error) throw error
    const d = buildDigest(data || [])
    if (!d.recent.length && !d.pendientes.length) return json(res, { skipped: 'sin actividad' })

    const activos = d.recent.filter(r => r.status === 'active')
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:620px">
<h2 style="margin:0 0 12px">Resumen WhatsApp — últimas 24 h</h2>
<p><b>${d.nuevas.length}</b> conversaciones nuevas · <b>${d.recent.length}</b> con movimiento · <b>${d.mensajes}</b> mensajes recibidos · <b>${d.bajas.length}</b> bajas</p>
<h3 style="color:#b07a00">Pendientes de atender (${d.pendientes.length})</h3>
${d.pendientes.length ? `<ul>${d.pendientes.map(r => rowHtml(r, true)).join('')}</ul>` : '<p>Ninguno. 👌</p>'}
${activos.length ? `<h3>El bot sigue atendiendo (${activos.length})</h3><ul>${activos.slice(0, 15).map(r => rowHtml(r, false)).join('')}</ul>` : ''}
<p><a href="${ADMIN_URL}">Abrir el panel</a> → pestaña WhatsApp. Marcá "Atendido" para que deje de aparecer en pendientes.</p>
</div>`
    const subject = d.pendientes.length
      ? `WhatsApp: ${d.pendientes.length} pendiente(s) de atender · ${d.recent.length} con movimiento`
      : `WhatsApp: ${d.recent.length} conversación(es) en 24 h, sin pendientes`
    const r = await sendMail({ to: BUSINESS_EMAIL, subject, html, fromName: 'Bot WhatsApp — Espacio Auditorium' })
    return json(res, { sent: r.ok, recent: d.recent.length, pendientes: d.pendientes.length })
  } catch (err) {
    logError('wa-digest', err)
    return json(res, { error: 'internal' }, 500)
  }
}
