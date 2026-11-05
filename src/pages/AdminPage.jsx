import { useState, useEffect, useCallback, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Helmet } from 'react-helmet-async'
import toast from 'react-hot-toast'
import { formatARS } from '../lib/pricing'
import { adminLogin, adminPost, getToken, clearToken, AdminApiError } from '../lib/adminApi'

// Panel de administración. Toda la data pasa por endpoints con service role y
// token de sesión (ver src/lib/adminApi.js). El navegador nunca toca Supabase.

const STATUS_MAP = {
  pending_payment: { label: 'Esperando pago', badge: 'badge-blue' },
  deposit_paid: { label: 'Seña abonada', badge: 'badge-green' },
  confirmed: { label: 'Confirmada', badge: 'badge-green' },
  cancelled: { label: 'Cancelada', badge: 'badge-red' },
  refunded: { label: 'Reembolsada', badge: 'badge-gray' },
  payment_conflict: { label: 'Conflicto de pago', badge: 'badge-red' },
  expired: { label: 'Vencida', badge: 'badge-gray' },
}

const FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'deposit_paid', label: 'Seña abonada' },
  { value: 'pending_payment', label: 'Pendientes' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'payment_conflict', label: 'Conflictos' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'refunded', label: 'Reembolsadas' },
]

const WA_STATUS_MAP = {
  active: { label: 'Activo', badge: 'badge-blue' },
  qualified: { label: 'Calificado', badge: 'badge-green' },
  closed: { label: 'Cerrado', badge: 'badge-gray' },
}

/** Calificada y sin atender, o atendida pero el cliente volvió a escribir después. */
function isWaPending(c) {
  if (c.status !== 'qualified') return false
  const h = c.lead_data?.handled_at
  if (!h) return true
  const last = c.lead_data?.last_inbound_at
  return !!last && new Date(last) > new Date(h)
}

function lastUserMessage(c) {
  const msgs = Array.isArray(c.messages) ? c.messages : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === 'user' && typeof msgs[i].content === 'string') return msgs[i].content
  }
  return ''
}

const SLOT_LABEL = { full_day: 'Día completo', half_day_morning: 'Mañana', half_day_afternoon: 'Tarde/Noche' }
const CANCEL_REASON = { admin: 'cancelada por admin', auto: 'auto-cancelada (sin pago)', refunded: 'reembolso', charged_back: 'contracargo', conflict: 'fecha ocupada al pagar', amount_mismatch: 'monto distinto', currency_mismatch: 'moneda distinta', preference_error: 'error al iniciar el pago' }
const REFRESH_MS = 5 * 60 * 1000

const errMsg = (err) => (err instanceof AdminApiError ? err.message : 'Error de conexión. Intentá de nuevo.')

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [pwd, setPwd] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)

  const [tab, setTab] = useState('reservations') // 'reservations' | 'blocked' | 'whatsapp'
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  const [blockedDates, setBlockedDates] = useState([])
  const [newBlock, setNewBlock] = useState({ date: '', endDate: '', slot_type: 'full_day', reason: '' })
  const [blockBusy, setBlockBusy] = useState(false)

  const [waConversations, setWaConversations] = useState([])
  const [waLoading, setWaLoading] = useState(false)
  const [waFilter, setWaFilter] = useState('pending')
  const [waSelected, setWaSelected] = useState(null)
  const [waError, setWaError] = useState('')

  const logout = useCallback((message) => {
    clearToken()
    setAuthed(false)
    setReservations([])
    setBlockedDates([])
    setWaConversations([])
    setSelected(null)
    setWaSelected(null)
    if (message) toast.error(message)
  }, [])
  const onUnauthorized = useCallback(() => logout('Tu sesión venció. Volvé a ingresar.'), [logout])

  const handleLogin = async (e) => {
    e.preventDefault()
    setPwdError('')
    setLoginBusy(true)
    try {
      await adminLogin(pwd)
      setPwd('')
      setAuthed(true)
    } catch (err) {
      setPwdError(errMsg(err))
    } finally {
      setLoginBusy(false)
    }
  }

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminPost('/api/admin-reservations', { status: filter }, { onUnauthorized })
      setReservations(Array.isArray(data?.reservations) ? data.reservations : [])
    } catch (err) {
      if (err?.status !== 401) toast.error(errMsg(err))
    } finally {
      setLoading(false)
    }
  }, [filter, onUnauthorized])

  const fetchBlockedDates = useCallback(async () => {
    try {
      const data = await adminPost('/api/admin-blocked-dates', { action: 'list' }, { onUnauthorized })
      setBlockedDates(Array.isArray(data?.blocked) ? data.blocked : [])
    } catch (err) {
      if (err?.status !== 401) toast.error(errMsg(err))
    }
  }, [onUnauthorized])

  const fetchWaConversations = useCallback(async () => {
    setWaLoading(true)
    setWaError('')
    try {
      const data = await adminPost('/api/admin-wa-conversations', { status: 'all' }, { onUnauthorized })
      setWaConversations(Array.isArray(data?.conversations) ? data.conversations : [])
    } catch (err) {
      if (err?.status !== 401) setWaError(errMsg(err))
    } finally {
      setWaLoading(false)
    }
  }, [onUnauthorized])

  useEffect(() => {
    if (!authed) return undefined
    fetchReservations()
    fetchBlockedDates()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchReservations()
        fetchBlockedDates()
      }
    }, REFRESH_MS)
    return () => clearInterval(interval)
  }, [authed, fetchReservations, fetchBlockedDates])

  useEffect(() => {
    if (!authed || tab !== 'whatsapp') return undefined
    fetchWaConversations()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') fetchWaConversations() }, 60000)
    return () => clearInterval(iv)
  }, [authed, tab, fetchWaConversations])

  const handleAddBlock = async (e) => {
    e.preventDefault()
    if (!newBlock.date) return
    setBlockBusy(true)
    try {
      const data = await adminPost('/api/admin-blocked-dates', {
        action: 'add',
        date: newBlock.date,
        endDate: newBlock.endDate || undefined,
        slot_type: newBlock.slot_type,
        reason: newBlock.reason,
      }, { onUnauthorized })
      toast.success(data?.added ? `${data.added} fecha(s) bloqueada(s)` : 'Fecha bloqueada')
      setNewBlock({ date: '', endDate: '', slot_type: 'full_day', reason: '' })
      fetchBlockedDates()
    } catch (err) {
      if (err?.status !== 401) toast.error(errMsg(err))
    } finally {
      setBlockBusy(false)
    }
  }

  const handleDeleteBlock = async (id) => {
    try {
      await adminPost('/api/admin-blocked-dates', { action: 'delete', id }, { onUnauthorized })
      toast.success('Fecha desbloqueada')
      fetchBlockedDates()
    } catch (err) {
      if (err?.status !== 401) toast.error(errMsg(err))
    }
  }

  const handleCancel = async (id) => {
    try {
      const data = await adminPost('/api/admin-cancel', { id }, { onUnauthorized })
      if (data?.skipped) toast('La reserva ya estaba cerrada')
      else if (data?.calendar === 'failed') toast.error('Reserva cancelada, pero no se pudo borrar el evento de Google Calendar: borralo a mano.', { duration: 8000 })
      else toast.success('Reserva cancelada. La fecha quedó libre.')
      setSelected(null)
      fetchReservations()
    } catch (err) {
      if (err?.status !== 401) toast.error(errMsg(err))
      throw err
    }
  }

  if (!authed) {
    return (
      <div className="app-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.25rem' }}>
        <Helmet>
          <title>Panel de administración | Espacio Auditorium</title>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <div style={{ maxWidth: 360, width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Panel de Admin</h1>
            <p style={{ color: 'var(--app-muted)', fontSize: '0.9rem' }}>Espacio Auditorium</p>
          </div>
          <form onSubmit={handleLogin} className="card">
            <div className="form-group">
              <label className="form-label" htmlFor="admin-password">Contraseña</label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                className={`form-input ${pwdError ? 'error' : ''}`}
                value={pwd}
                onChange={e => { setPwd(e.target.value); setPwdError('') }}
                autoFocus
                aria-invalid={!!pwdError}
                aria-describedby={pwdError ? 'admin-password-error' : undefined}
              />
              {pwdError && <span id="admin-password-error" className="form-error" role="alert">{pwdError}</span>}
            </div>
            <button type="submit" className="btn btn-gold btn-full" disabled={loginBusy || !pwd}>
              {loginBusy ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  const stats = {
    total: reservations.length,
    depositPaid: reservations.filter(r => ['deposit_paid', 'confirmed'].includes(r.status)).length,
    pending: reservations.filter(r => r.status === 'pending_payment').length,
    conflicts: reservations.filter(r => r.status === 'payment_conflict').length,
    totalRevenue: reservations
      .filter(r => ['deposit_paid', 'confirmed'].includes(r.status))
      .reduce((sum, r) => sum + (Number(r.deposit_amount) || 0), 0),
  }

  const waPending = waConversations.filter(isWaPending)
  const waVisible = waFilter === 'all' ? waConversations
    : waFilter === 'pending' ? waPending
    : waConversations.filter(c => c.status === waFilter)

  const markWaHandled = async (c, handled) => {
    try {
      const data = await adminPost('/api/admin-wa-conversations', { action: 'mark-handled', phone: c.phone, handled }, { onUnauthorized })
      const updated = data?.conversation
      if (updated) {
        setWaConversations(list => list.map(x => (x.phone === updated.phone ? updated : x)))
        setWaSelected(sel => (sel?.phone === updated.phone ? updated : sel))
      }
      toast.success(handled ? 'Marcada como atendida' : 'Vuelve a pendientes')
    } catch (err) {
      if (err?.status !== 401) toast.error(errMsg(err))
    }
  }

  const waStats = {
    pending: waPending.length,
    total: waConversations.length,
    qualified: waConversations.filter(c => c.status === 'qualified').length,
    closed: waConversations.filter(c => c.status === 'closed').length,
    active: waConversations.filter(c => c.status === 'active').length,
    totalMessages: waConversations.reduce((sum, c) => sum + (c.messages?.length || 0), 0),
  }

  return (
    <div className="app-page" style={{ minHeight: '100vh', paddingBottom: '4rem' }}>
      <Helmet>
        <title>Panel de administración | Espacio Auditorium</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1a1a1a', padding: '1.25rem', background: 'var(--bg-card)' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '1.3rem' }}>Panel de Admin</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--app-muted)' }}>Espacio Auditorium</p>
          </div>
          <button type="button" className="btn btn-ghost-app btn-sm" onClick={() => logout()}>
            Salir
          </button>
        </div>
      </div>

      <div className="container" style={{ paddingTop: '2rem' }}>
        {/* Tabs */}
        <div role="tablist" aria-label="Secciones del panel" style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          {[
            { key: 'reservations', label: 'Reservas' },
            { key: 'blocked', label: 'Bloquear fechas' },
            { key: 'whatsapp', label: 'WhatsApp' },
          ].map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`btn btn-sm ${tab === t.key ? 'btn-outline-app' : 'btn-ghost-app'}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Bloquear fechas */}
        {tab === 'blocked' && (
          <div style={{ maxWidth: 640 }}>
            <form onSubmit={handleAddBlock} className="card" style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Bloquear fecha</h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--app-muted)', marginBottom: '1rem' }}>
                Las fechas bloqueadas no se pueden reservar online. Podés bloquear un rango dejando una fecha de fin.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="block-date">Desde</label>
                  <input id="block-date" type="date" className="form-input" value={newBlock.date} onChange={e => setNewBlock(p => ({ ...p, date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="block-end">Hasta (opcional)</label>
                  <input id="block-end" type="date" className="form-input" value={newBlock.endDate} min={newBlock.date || undefined} onChange={e => setNewBlock(p => ({ ...p, endDate: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="block-slot">Franja</label>
                  <select id="block-slot" className="form-input" value={newBlock.slot_type} onChange={e => setNewBlock(p => ({ ...p, slot_type: e.target.value }))}>
                    <option value="full_day">Día completo</option>
                    <option value="half_day_morning">Mañana</option>
                    <option value="half_day_afternoon">Tarde/Noche</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="block-reason">Motivo (opcional)</label>
                  <input id="block-reason" type="text" className="form-input" maxLength={200} placeholder="Ej: Evento privado" value={newBlock.reason} onChange={e => setNewBlock(p => ({ ...p, reason: e.target.value }))} />
                </div>
              </div>
              <button type="submit" className="btn btn-gold" disabled={blockBusy || !newBlock.date}>
                {blockBusy ? 'Bloqueando…' : 'Bloquear fecha'}
              </button>
            </form>

            <div className="card">
              <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Fechas bloqueadas</h2>
              {blockedDates.length === 0 ? (
                <p style={{ color: 'var(--app-muted)', fontSize: '0.9rem' }}>No hay fechas bloqueadas manualmente</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {blockedDates.map(b => (
                    <BlockedRow key={b.id} block={b} onDelete={handleDeleteBlock} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Reservas */}
        {tab === 'reservations' && (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <StatCard label="Reservas listadas" value={stats.total} />
            <StatCard label="Con seña abonada" value={stats.depositPaid} accent />
            <StatCard label="Pendientes de pago" value={stats.pending} />
            {stats.conflicts > 0 && <StatCard label="Conflictos de pago" value={stats.conflicts} warn />}
            <StatCard label="Señas recibidas" value={formatARS(stats.totalRevenue)} accent />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                className={`btn btn-sm ${filter === f.value ? 'btn-outline-app' : 'btn-ghost-app'}`}
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
            <button type="button" className="btn btn-sm btn-ghost-app" style={{ marginLeft: 'auto' }} onClick={fetchReservations} disabled={loading}>
              ↻ Actualizar
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--app-muted)' }} aria-busy="true">
              <span className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : reservations.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--app-muted)' }}>
              No hay reservas con este filtro
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    {['Creada', 'Cliente', 'Fechas evento', 'Franja', 'Seña', 'Estado', ''].map((h, i) => (
                      <th key={i} scope="col" style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reservations.map(r => {
                    const s = STATUS_MAP[r.status] || { label: r.status, badge: 'badge-gray' }
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ ...tdStyle, color: 'var(--app-muted)', whiteSpace: 'nowrap' }}>
                          {r.created_at ? format(parseISO(r.created_at), 'd MMM yyyy', { locale: es }) : '—'}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 500 }}>{r.first_name} {r.last_name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--app-muted)' }}>{r.email}</div>
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          {r.start_date}{r.end_date !== r.start_date && <> → {r.end_date}</>}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--app-muted)', whiteSpace: 'nowrap' }}>
                          {SLOT_LABEL[r.slot_type] || r.slot_type}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {r.deposit_amount ? formatARS(r.deposit_amount) : '—'}
                        </td>
                        <td style={tdStyle}><span className={`badge ${s.badge}`}>{s.label}</span></td>
                        <td style={tdStyle}>
                          <button type="button" className="btn btn-sm btn-ghost-app" onClick={() => setSelected(r)} aria-label={`Ver reserva de ${r.first_name} ${r.last_name}`}>
                            Ver
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>)}

        {/* WhatsApp */}
        {tab === 'whatsapp' && (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <StatCard label="Por atender" value={waStats.pending} accent warn={waStats.pending > 0} />
            <StatCard label="Conversaciones" value={waStats.total} />
            <StatCard label="Calificados" value={waStats.qualified} />
            <StatCard label="Activos" value={waStats.active} />
            <StatCard label="Cerrados" value={waStats.closed} />
            <StatCard label="Mensajes" value={waStats.totalMessages} />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { value: 'pending', label: `Por atender (${waStats.pending})` },
              { value: 'all', label: 'Todos' },
              { value: 'qualified', label: 'Calificados' },
              { value: 'active', label: 'Activos' },
              { value: 'closed', label: 'Cerrados' },
            ].map(f => (
              <button
                key={f.value}
                type="button"
                className={`btn btn-sm ${waFilter === f.value ? 'btn-outline-app' : 'btn-ghost-app'}`}
                aria-pressed={waFilter === f.value}
                onClick={() => setWaFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
            <button type="button" className="btn btn-sm btn-ghost-app" style={{ marginLeft: 'auto' }} onClick={fetchWaConversations} disabled={waLoading}>
              ↻ Actualizar
            </button>
          </div>

          {waError && <div className="alert-box alert-error" role="alert" style={{ marginBottom: '1rem' }}>{waError}</div>}

          {waLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--app-muted)' }} aria-busy="true">
              <span className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : waVisible.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--app-muted)' }}>
              {waFilter === 'pending' ? 'No hay nada pendiente de atender 👌' : 'No hay conversaciones con este filtro'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    {['Actualizado', 'Nombre / teléfono', 'Último mensaje del cliente', 'Evento', 'Estado', 'Msgs', ''].map((h, i) => (
                      <th key={i} scope="col" style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {waVisible.map(c => {
                    const s = WA_STATUS_MAP[c.status] || { label: c.status, badge: 'badge-gray' }
                    const lead = c.lead_data || {}
                    const phone = (c.phone || '').replace('whatsapp:', '')
                    const pending = isWaPending(c)
                    const evento = [lead.tipo, lead.fecha, lead.personas && `${lead.personas} pers.`].filter(Boolean).join(' · ')
                    return (
                      <tr key={c.phone} style={{ borderBottom: '1px solid #1a1a1a', background: pending ? 'rgba(200,144,10,0.06)' : undefined }}>
                        <td style={{ ...tdStyle, color: 'var(--app-muted)', whiteSpace: 'nowrap' }}>
                          {c.updated_at ? format(parseISO(c.updated_at), 'd MMM HH:mm', { locale: es }) : '—'}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 500 }}>{lead.nombre || lead.nombre_perfil || <span style={{ color: 'var(--app-dim)' }}>Sin nombre</span>}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--app-dim)' }}>{phone}</div>
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--app-muted)', maxWidth: 280 }}>
                          <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{lastUserMessage(c) || '—'}</span>
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--app-muted)', whiteSpace: 'nowrap' }}>{evento || '—'}</td>
                        <td style={tdStyle}>
                          <span className={`badge ${s.badge}`}>{s.label}</span>
                          {lead.opt_out && <span className="badge badge-gray" style={{ marginLeft: 4 }}>Baja</span>}
                          {pending && <span className="badge badge-gold" style={{ marginLeft: 4 }}>Por atender</span>}
                          {!pending && lead.handled_at && <span className="badge badge-gray" style={{ marginLeft: 4 }}>Atendido</span>}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--app-muted)', textAlign: 'center' }}>{c.messages?.length || 0}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn btn-sm btn-ghost-app" onClick={() => setWaSelected(c)} aria-label={`Ver conversación de ${phone}`}>Ver</button>
                          <a className="btn btn-sm btn-ghost-app" href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`Escribirle a ${phone} por WhatsApp`}>WhatsApp</a>
                          {c.status === 'qualified' && (
                            <button type="button" className="btn btn-sm btn-ghost-app" onClick={() => markWaHandled(c, pending)}>
                              {pending ? '✓ Atendido' : 'Reabrir'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>)}
      </div>

      {selected && (
        <ReservationModal reservation={selected} onClose={() => setSelected(null)} onCancel={handleCancel} />
      )}
      {waSelected && (
        <WaConversationModal conversation={waSelected} onClose={() => setWaSelected(null)} onMarkHandled={markWaHandled} />
      )}
    </div>
  )
}

const thStyle = { padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--app-muted)', fontWeight: 500, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }
const tdStyle = { padding: '0.85rem 1rem' }

function BlockedRow({ block: b, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--bg-card2)', borderRadius: 'var(--radius)', fontSize: '0.88rem', flexWrap: 'wrap' }}>
      <div>
        <span style={{ fontWeight: 600 }}>{b.date}</span>
        <span style={{ color: 'var(--app-muted)', marginLeft: '0.75rem' }}>{SLOT_LABEL[b.slot_type] || b.slot_type}</span>
        {b.reason && <span style={{ color: 'var(--app-dim)', marginLeft: '0.5rem' }}>· {b.reason}</span>}
      </div>
      {confirming ? (
        <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--app-muted)', fontSize: '0.82rem' }}>¿Desbloquear?</span>
          <button type="button" className="btn btn-sm btn-gold" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(b.id) } finally { setBusy(false); setConfirming(false) } }}>Sí</button>
          <button type="button" className="btn btn-sm btn-ghost-app" disabled={busy} onClick={() => setConfirming(false)}>No</button>
        </span>
      ) : (
        <button type="button" className="link-button" style={{ color: '#ef9a9a' }} onClick={() => setConfirming(true)}>Desbloquear</button>
      )}
    </li>
  )
}

function StatCard({ label, value, accent, warn }) {
  return (
    <div className={`card ${accent ? 'card-gold' : ''}`} style={{ textAlign: 'center', borderColor: warn ? 'rgba(224,85,85,0.4)' : undefined }}>
      <div style={{ fontSize: '1.6rem', fontFamily: 'var(--font-serif)', color: warn ? '#ef9a9a' : accent ? 'var(--gold)' : 'var(--app-text)', fontWeight: 700, marginBottom: '0.3rem' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--app-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
    </div>
  )
}

function useModalA11y(onClose) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])
  return closeRef
}

function ReservationModal({ reservation: r, onClose, onCancel }) {
  const s = STATUS_MAP[r.status] || { label: r.status, badge: 'badge-gray' }
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const closeRef = useModalA11y(onClose)
  const cancellable = ['pending_payment', 'deposit_paid', 'confirmed', 'payment_conflict'].includes(r.status)

  const doCancel = async () => {
    setBusy(true)
    try {
      await onCancel(r.id)
    } catch {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="res-modal-title" className="card" style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h2 id="res-modal-title" style={{ fontSize: '1.2rem' }}>Detalle de reserva</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--app-dim)', marginTop: '0.2rem' }}>#{String(r.id).split('-')[0]}</p>
          </div>
          <button ref={closeRef} type="button" className="btn btn-ghost-app btn-sm" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
          <Section title="Cliente">
            <InfoRow label="Nombre" value={`${r.first_name} ${r.last_name}`} />
            <InfoRow label="Email" value={r.email} />
            <InfoRow label="WhatsApp" value={r.whatsapp} />
          </Section>

          <Section title="Evento">
            <InfoRow label="Tipo" value={r.event_type} />
            <InfoRow label="Fechas" value={r.end_date && r.end_date !== r.start_date ? `${r.start_date} → ${r.end_date}` : r.start_date} />
            <InfoRow label="Franja" value={SLOT_LABEL[r.slot_type] || r.slot_type} />
            {r.additional_hours > 0 && <InfoRow label="Horas adicionales" value={r.additional_hours} />}
            {r.notes && <InfoRow label="Notas" value={r.notes} />}
          </Section>

          <Section title="Pago">
            <InfoRow label="Total" value={r.total_price ? formatARS(r.total_price) : '—'} />
            <InfoRow label="Seña" value={r.deposit_amount ? formatARS(r.deposit_amount) : '—'} />
            {Number(r.coupon_discount_pct) > 0 && <InfoRow label="Cupón" value={`${r.coupon_code || ''} (${r.coupon_discount_pct}%)`} />}
            <InfoRow label="Saldo pendiente" value={r.balance_amount ? formatARS(r.balance_amount) : '—'} />
            {r.mp_payment_id && <InfoRow label="Pago MP" value={r.mp_payment_id} />}
            {r.deposit_paid_at && <InfoRow label="Seña acreditada" value={format(parseISO(r.deposit_paid_at), "d MMM yyyy HH:mm", { locale: es })} />}
            <InfoRow label="Estado" value={<span className={`badge ${s.badge}`}>{s.label}</span>} />
            {r.cancel_reason && <InfoRow label="Motivo" value={CANCEL_REASON[r.cancel_reason] || r.cancel_reason} />}
            <InfoRow label="Google Calendar" value={r.calendar_event_id ? 'Bloqueado' : r.calendar_sync_error ? <span style={{ color: '#ef9a9a' }}>Sin bloquear (error)</span> : '—'} />
          </Section>
        </div>

        <hr className="sep" />

        {confirming ? (
          <div className="alert-box" role="alertdialog" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span>¿Cancelar esta reserva? Se libera la fecha en el sitio y en Google Calendar. Esta acción no se puede deshacer. Si hubo un pago, el reembolso se hace desde Mercado Pago.</span>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm btn-ghost-app" disabled={busy} onClick={() => setConfirming(false)}>Volver</button>
              <button type="button" className="btn btn-sm" disabled={busy} style={dangerBtn} onClick={doCancel}>{busy ? 'Cancelando…' : 'Sí, cancelar'}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            {cancellable && (
              <button type="button" className="btn btn-sm" style={dangerBtn} onClick={() => setConfirming(true)}>Cancelar reserva</button>
            )}
            <button type="button" className="btn btn-ghost-app btn-sm" onClick={onClose}>Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}

const dangerBtn = { background: 'rgba(224,85,85,0.1)', border: '1px solid rgba(224,85,85,0.25)', color: '#ef9a9a' }

function WaConversationModal({ conversation: c, onClose, onMarkHandled }) {
  const s = WA_STATUS_MAP[c.status] || { label: c.status, badge: 'badge-gray' }
  const lead = c.lead_data || {}
  const messages = Array.isArray(c.messages) ? c.messages : []
  const phone = (c.phone || '').replace('whatsapp:', '')
  const closeRef = useModalA11y(onClose)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="wa-modal-title" className="card" style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 id="wa-modal-title" style={{ fontSize: '1.1rem' }}>Conversación WhatsApp</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--app-dim)', marginTop: '0.2rem', fontFamily: 'monospace' }}>{phone}</p>
          </div>
          <button ref={closeRef} type="button" className="btn btn-ghost-app btn-sm" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {Object.keys(lead).length > 0 && (
          <Section title="Datos del lead (escritos por el cliente, sin verificar)">
            {['nombre', 'empresa', 'email', 'fecha', 'personas', 'tipo', 'duracion', 'urgencia', 'notas'].map(k => (
              lead[k] ? <InfoRow key={k} label={k[0].toUpperCase() + k.slice(1)} value={String(lead[k])} /> : null
            ))}
          </Section>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--app-muted)' }}>
          <span>Estado: <span className={`badge ${s.badge}`} style={{ fontSize: '0.75rem' }}>{s.label}</span></span>
          <span>· {messages.length} mensajes</span>
          {c.updated_at && <span>· Último: {format(parseISO(c.updated_at), 'd MMM yyyy HH:mm', { locale: es })}</span>}
          {lead.handled_at && <span>· Atendido: {format(parseISO(lead.handled_at), 'd MMM HH:mm', { locale: es })}</span>}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <a className="btn btn-sm btn-gold" href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">Escribirle por WhatsApp</a>
          {c.status === 'qualified' && (
            <button type="button" className="btn btn-sm btn-outline-app" onClick={() => onMarkHandled(c, isWaPending(c))}>
              {isWaPending(c) ? '✓ Marcar como atendido' : 'Volver a pendientes'}
            </button>
          )}
        </div>

        <div>
          <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--gold)', marginBottom: '0.75rem', fontWeight: 600 }}>Conversación</p>
          {messages.length === 0 ? (
            <p style={{ color: 'var(--app-muted)', fontSize: '0.88rem' }}>Sin mensajes registrados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
                  <div style={{
                    maxWidth: '80%', padding: '0.6rem 0.85rem',
                    borderRadius: msg.role === 'user' ? '0.75rem 0.75rem 0.75rem 0.2rem' : '0.75rem 0.75rem 0.2rem 0.75rem',
                    background: msg.role === 'user' ? 'var(--bg-card2)' : 'rgba(193,156,97,0.12)',
                    border: msg.role === 'user' ? '1px solid #222' : '1px solid rgba(193,156,97,0.2)',
                    fontSize: '0.85rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--app-dim)', display: 'block', marginBottom: '0.25rem' }}>
                      {msg.role === 'user' ? 'Lead' : 'Agente'}
                    </span>
                    {typeof msg.content === 'string' ? msg.content : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost-app btn-sm" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--gold)', marginBottom: '0.6rem', fontWeight: 600 }}>{title}</p>
      <div className="card" style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {children}
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.88rem' }}>
      <span style={{ color: 'var(--app-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right', color: 'var(--app-text, #f0f0f0)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}
