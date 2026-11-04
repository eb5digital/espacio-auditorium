/**
 * Módulo ÚNICO de disponibilidad. Lo usan:
 *   - GET /api/availability        (calendario del sitio)
 *   - POST /api/create-payment     (chequeo antes de cobrar)
 *   - POST /api/payment-webhook    (re-chequeo al acreditarse la seña)
 *   - api/whatsapp-meta.js         (respuesta del bot de WhatsApp)
 *
 * Fuentes de bloqueo (todas combinadas):
 *   reservation  → reservas con seña paga o confirmadas (Supabase)
 *   hold         → reservas pending_payment creadas hace menos de HOLD_MINUTES
 *   blocked_date → tabla blocked_dates (bloqueos manuales del admin)
 *   calendar     → eventos de Google Calendar (clasificados en hora local)
 *
 * Una reserva de día completo ocupa ambas franjas; media jornada ocupa la suya.
 */
import { supabaseAdmin } from './_utils.js'
import { listCalendarBlocks } from './_calendar.js'
import { todayLocal, addDaysIso, eachDateIso } from './_dates.js'
import { hasGoogleCredentials } from './_google.js'

/** Minutos que una reserva pendiente retiene la fecha (= vencimiento de la preferencia de MP). */
export const HOLD_MINUTES = 120
export const ACTIVE_STATUSES = ['deposit_paid', 'confirmed']
export const SLOT_TYPES = ['half_day_morning', 'half_day_afternoon', 'full_day']

export { addDaysIso, eachDateIso, todayLocal }

export function slotsOf(slotType) {
  if (slotType === 'half_day_morning') return { morning: true, afternoon: false }
  if (slotType === 'half_day_afternoon') return { morning: false, afternoon: true }
  return { morning: true, afternoon: true }
}

function touch(map, date, { morning, afternoon }, source) {
  const cur = map.get(date) || { morning: false, afternoon: false, sources: new Set() }
  if (morning) cur.morning = true
  if (afternoon) cur.afternoon = true
  cur.sources.add(source)
  map.set(date, cur)
}

/**
 * Mapa de bloqueos por fecha.
 * @returns {Promise<{ map: Map<string,{morning:boolean,afternoon:boolean,sources:Set<string>}>, calendarOk: boolean, calendarError: string|null }>}
 */
export async function getBlockedMap({ from, to, excludeReservationId = null, includeHolds = true, includeCalendar = true } = {}) {
  const db = supabaseAdmin()
  const map = new Map()

  const holdSince = new Date(Date.now() - HOLD_MINUTES * 60 * 1000).toISOString()
  const statuses = includeHolds ? [...ACTIVE_STATUSES, 'pending_payment'] : ACTIVE_STATUSES

  const [resRes, blockRes] = await Promise.all([
    db.from('reservations')
      .select('id, start_date, end_date, slot_type, status, created_at')
      .in('status', statuses)
      .lte('start_date', to)
      .gte('end_date', from),
    db.from('blocked_dates')
      .select('id, date, slot_type')
      .gte('date', from)
      .lte('date', to),
  ])
  if (resRes.error) throw resRes.error
  if (blockRes.error) throw blockRes.error

  for (const r of resRes.data || []) {
    if (excludeReservationId && r.id === excludeReservationId) continue
    if (r.status === 'pending_payment' && r.created_at < holdSince) continue
    const source = r.status === 'pending_payment' ? 'hold' : 'reservation'
    const slots = slotsOf(r.slot_type)
    for (const date of eachDateIso(r.start_date, r.end_date || r.start_date)) touch(map, date, slots, source)
  }
  for (const b of blockRes.data || []) touch(map, b.date, slotsOf(b.slot_type), 'blocked_date')

  let calendarOk = true
  let calendarError = null
  if (includeCalendar) {
    if (!hasGoogleCredentials()) {
      calendarOk = false
      calendarError = 'Google Calendar no configurado'
    } else {
      try {
        for (const b of await listCalendarBlocks({ from, to })) touch(map, b.date, b, 'calendar')
      } catch (err) {
        calendarOk = false
        calendarError = err.message
      }
    }
  }
  return { map, calendarOk, calendarError }
}

/** Serializa el mapa para el cliente (sin fuentes, sin datos personales). */
export function serializeBlocked(map) {
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, morning: v.morning, afternoon: v.afternoon }))
}

/**
 * ¿Está libre el rango/franja pedido?
 * @returns {Promise<{available:boolean, conflicts:Array<{date:string, slot:'morning'|'afternoon', source:string}>, calendarOk:boolean, calendarError:string|null}>}
 */
export async function assertSlotAvailable({ startDate, endDate, slotType, excludeReservationId = null, includeHolds = true, includeCalendar = true }) {
  const end = endDate || startDate
  const { map, calendarOk, calendarError } = await getBlockedMap({ from: startDate, to: end, excludeReservationId, includeHolds, includeCalendar })
  const want = slotsOf(slotType)
  const conflicts = []
  for (const date of eachDateIso(startDate, end)) {
    const b = map.get(date)
    if (!b) continue
    const src = [...b.sources].join('+')
    if (want.morning && b.morning) conflicts.push({ date, slot: 'morning', source: src })
    if (want.afternoon && b.afternoon) conflicts.push({ date, slot: 'afternoon', source: src })
  }
  return { available: conflicts.length === 0, conflicts, calendarOk, calendarError }
}

/**
 * Estado de un día para el bot: 'libre' | 'mañana_ocupada' | 'tarde_ocupada' | 'ocupado'.
 */
export async function dayStatus(date, opts = {}) {
  const { map, calendarOk, calendarError } = await getBlockedMap({ from: date, to: date, ...opts })
  const b = map.get(date)
  let status = 'libre'
  if (b) {
    if (b.morning && b.afternoon) status = 'ocupado'
    else if (b.morning) status = 'mañana_ocupada'
    else if (b.afternoon) status = 'tarde_ocupada'
  }
  return { status, calendarOk, calendarError }
}
