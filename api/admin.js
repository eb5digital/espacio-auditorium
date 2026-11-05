/**
 * Dispatcher del panel admin: agrupa 6 endpoints en una sola Serverless
 * Function para no exceder el límite de 12 funciones del plan Hobby de
 * Vercel. El ruteo real lo hacen los rewrites de vercel.json
 * (/api/admin-auth, /api/admin-blocked-dates, etc. -> /api/admin?action=...),
 * así que las URLs que ya usa el frontend no cambian.
 */
import { handleOptions, error } from './_utils.js'
import adminAuth from './_admin-auth.js'
import adminBlockedDates from './_admin-blocked-dates.js'
import adminCancel from './_admin-cancel.js'
import adminReservations from './_admin-reservations.js'
import adminWaConversations from './_admin-wa-conversations.js'
import adminCosts from './_admin-costs.js'

const ROUTES = {
  auth: adminAuth,
  'blocked-dates': adminBlockedDates,
  cancel: adminCancel,
  reservations: adminReservations,
  'wa-conversations': adminWaConversations,
  costs: adminCosts,
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return
  const action = req.query?.action
  const target = ROUTES[action]
  if (!target) return error(res, 'Not found', 404)
  return target(req, res)
}
