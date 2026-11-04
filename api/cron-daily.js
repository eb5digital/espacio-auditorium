/**
 * Cron diario combinado: agrupa 4 tareas (recordatorio de saldo,
 * recordatorio de pago pendiente, auto-cancelación, seguimiento por WhatsApp) en una sola Serverless
 * Function, porque el plan Hobby de Vercel permite máximo 2 cron jobs.
 *
 * Cada tarea corre igual aunque otra falle; se capturan sus respuestas
 * (cada una escribe sobre un "res" simulado, no sobre el real) y se
 * devuelve un resumen combinado al final.
 */
import { checkCronAuth, error, logError } from './_utils.js'
import sendReminders from './_send-reminders.js'
import paymentReminder from './_payment-reminder.js'
import autoCancel from './_auto-cancel.js'
import waFollowup from './_wa-followup.js'

function captureRes() {
  const state = { statusCode: 200, body: null, headers: {} }
  const fake = {
    getHeader: (k) => state.headers[k],
    setHeader: (k, v) => { state.headers[k] = v },
    status(code) { state.statusCode = code; return this },
    json(data) { state.body = data; return this },
    end(data) { state.body = data; return this },
  }
  return { fake, state }
}

async function run(name, handler, req) {
  const { fake, state } = captureRes()
  try {
    await handler(req, fake)
    return { name, statusCode: state.statusCode, body: state.body }
  } catch (err) {
    logError(`cron-daily:${name}`, err)
    return { name, statusCode: 500, body: { error: 'internal' } }
  }
}

export default async function handler(req, res) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return error(res, auth.message, auth.status)

  const results = {
    sendReminders: await run('send-reminders', sendReminders, req),
    paymentReminder: await run('payment-reminder', paymentReminder, req),
    autoCancel: await run('auto-cancel', autoCancel, req),
    // Seguimiento por WhatsApp (Meta): no hace nada hasta WA_FOLLOWUP_ENABLED=true + plantilla aprobada.
    waFollowup: await run('wa-followup', waFollowup, req),
  }

  res.status(200).json({ ok: true, results })
}
