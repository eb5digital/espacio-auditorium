import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Helmet } from 'react-helmet-async'
import HomePage from './pages/HomePage'
import ErrorBoundary from './components/ErrorBoundary'

// Sólo la Home viaja en el bundle principal. El resto se carga cuando se navega
// (la reserva, el pago y el admin no le cuestan nada a quien entra a la landing).
const BookingPage = lazy(() => import('./pages/BookingPage'))
const PaymentStatusPage = lazy(() => import('./pages/PaymentStatusPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const SalasPage = lazy(() => import('./pages/SalasPage'))
const CotizarPage = lazy(() => import('./pages/CotizarPage'))
const ConferenciasPage = lazy(() => import('./pages/ConferenciasPage'))
const CapacitacionesPage = lazy(() => import('./pages/CapacitacionesPage'))
const WorkshopsPage = lazy(() => import('./pages/WorkshopsPage'))
const PodcastStreamingPage = lazy(() => import('./pages/PodcastStreamingPage'))
const LanzamientosPage = lazy(() => import('./pages/LanzamientosPage'))
const PrivacidadPage = lazy(() => import('./pages/PrivacidadPage'))

function RouteFallback() {
  return <div style={{ minHeight: '100vh' }} aria-busy="true" aria-label="Cargando" />
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#1a1a1a',
              color: '#f0f0f0',
              border: '1px solid #333',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.9rem',
            },
            success: { iconTheme: { primary: '#c8900a', secondary: '#0a0a0a' } },
            error: { iconTheme: { primary: '#e05555', secondary: '#f0f0f0' } },
          }}
        />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/reservar" element={<BookingPage />} />
            <Route path="/pago" element={<PaymentStatusPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/salas" element={<SalasPage />} />
            <Route path="/cotizar" element={<CotizarPage />} />
            <Route path="/conferencias" element={<ConferenciasPage />} />
            <Route path="/capacitaciones" element={<CapacitacionesPage />} />
            <Route path="/workshops" element={<WorkshopsPage />} />
            <Route path="/podcast-y-streaming" element={<PodcastStreamingPage />} />
            <Route path="/lanzamientos" element={<LanzamientosPage />} />
            <Route path="/privacidad" element={<PrivacidadPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem' }}>
      <Helmet>
        <title>Página no encontrada | Espacio Auditorium</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div>
        <p style={{ fontSize: '5rem', fontFamily: 'var(--font-serif)', color: 'var(--gold)', marginBottom: '1rem' }}>404</p>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Página no encontrada</h1>
        <Link to="/" className="btn btn-outline">Volver al inicio</Link>
      </div>
    </div>
  )
}
