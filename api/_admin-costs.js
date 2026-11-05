/**
 * POST /api/admin-costs  (Authorization: Bearer <token de sesión>)
 *
 * Consumo del mes en curso para el panel:
 *   - Meta (WhatsApp): costo real según pricing_analytics de la WABA (moneda de facturación de Meta).
 *   - IA: ESTIMADO a partir de los tokens registrados por conversación (lead_data.ai_usage)
 *     × precios de lista configurables (USD por millón de tokens).
 */
import { handleOptions, json, error, safeError, requireAdmin, supabaseAdmin, logError } from './_utils.js'

const GRAPH = (process.env.WA_GRAPH_VERSION || 'v23.0').trim()
const WABA_ID = (process.env.WA_WABA_ID || '1138666552357847').trim()

// USD por millón de tokens. xAI: grok-4.1-fast. Precios de lista aproximados: verificarlos y ajustarlos por env si cambian.
function prices(provider) {
  const env = (k, d) => Number(process.env[k]) || d
  if (provider === 'xai') {
    return { in: env('AI_PRICE_XAI_IN', 0.2), cr: env('AI_PRICE_XAI_CACHED', 0.05), cw: 0, out: env('AI_PRICE_XAI_OUT', 0.5) }
  }
  return { in: env('AI_PRICE_ANTHROPIC_IN', 3), cr: env('AI_PRICE_ANTHROPIC_CACHED', 0.3), cw: env('AI_PRICE_ANTHROPIC_CACHE_WRITE', 3.75), out: env('AI_PRICE_ANTHROPIC_OUT', 15) }
}

function monthRange(now = new Date()) {
  // Mes calendario en hora de Argentina (UTC-3)
  const ar = new Date(now.getTime() - 3 * 3600e3)
  const y = ar.getUTCFullYear(), m = ar.getUTCMonth()
  const start = Date.UTC(y, m, 1, 3) / 1000
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: Math.floor(start), end: Math.floor(now.getTime() / 1000) }
}

async function metaCosts(range) {
  const token = (process.env.WA_ACCESS_TOKEN || '').trim()
  if (!token) return { error: 'Falta WA_ACCESS_TOKEN' }
  const field = `pricing_analytics.start(${range.start}).end(${range.end}).granularity(DAILY).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`
  const url = `https://graph.facebook.com/${GRAPH}/${WABA_ID}?fields=currency,${encodeURIComponent(field)}`
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
    const data = await resp.json()
    if (!resp.ok) return { error: data?.error?.message?.slice(0, 200) || `Meta ${resp.status}` }
    const points = (data.pricing_analytics?.data || []).flatMap(d => d.data_points || [])
    const byCategory = {}
    let total = 0, free = 0, paid = 0
    for (const p of points) {
      const cat = p.pricing_category || 'OTRO'
      const c = byCategory[cat] || (byCategory[cat] = { volume: 0, cost: 0 })
      c.volume += Number(p.volume) || 0
      c.cost += Number(p.cost) || 0
      total += Number(p.cost) || 0
      if (String(p.pricing_type || '').startsWith('FREE')) free += Number(p.volume) || 0
      else paid += Number(p.volume) || 0
    }
    return { currency: data.currency || null, total, free, paid, byCategory }
  } catch (err) {
    logError('admin-costs:meta', err)
    return { error: 'No se pudo consultar Meta' }
  }
}

async function aiCosts(range) {
  const { data, error: dbErr } = await supabaseAdmin()
    .from('whatsapp_conversations')
    .select('lead_data')
    .gte('updated_at', new Date(range.start * 1000).toISOString())
    .limit(2000)
  if (dbErr) throw dbErr
  const by = {}
  for (const row of data || []) {
    const month = row.lead_data?.ai_usage?.[range.key] || {}
    for (const [provider, u] of Object.entries(month)) {
      const t = by[provider] || (by[provider] = { calls: 0, in: 0, cr: 0, cw: 0, out: 0 })
      for (const k of Object.keys(t)) t[k] += Number(u?.[k]) || 0
    }
  }
  let total = 0
  for (const [provider, t] of Object.entries(by)) {
    const pr = prices(provider)
    t.costUsd = (t.in * pr.in + t.cr * pr.cr + t.cw * pr.cw + t.out * pr.out) / 1e6
    total += t.costUsd
  }
  const calls = Object.values(by).reduce((n, t) => n + t.calls, 0)
  return { byProvider: by, totalUsd: total, calls, perReplyUsd: calls ? total / calls : 0 }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return error(res, 'Method not allowed', 405)
  }
  const auth = await requireAdmin(req)
  if (!auth.ok) return error(res, auth.message, auth.status)
  try {
    const range = monthRange()
    const [meta, ai] = await Promise.all([metaCosts(range), aiCosts(range)])
    return json(res, { month: range.key, meta, ai, trackingSince: '2026-11-05' })
  } catch (err) {
    return safeError(res, 'admin-costs', err, 'No pudimos calcular los costos.')
  }
}
