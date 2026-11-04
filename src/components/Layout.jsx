import { Link } from 'react-router-dom'
import Nav from './Nav'
import WhatsAppButton from './WhatsAppButton'
import { MATTERPORT_URL } from './MatterportFacade'

// Layout de las landings secundarias (nav + footer + WhatsApp flotante).
export default function Layout({ children }) {
  return (
    <>
      <Nav />

      <main style={{ paddingTop: 80 }}>
        {children}
      </main>

      <SiteFooter />

      <WhatsAppButton variant="float" />
    </>
  )
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        {/* Marca */}
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'white', fontWeight: 400, marginBottom: 16 }}>
            Espacio <span style={{ color: 'var(--gold)' }}>Auditorium</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--footer-text)', lineHeight: 1.7, maxWidth: 260, marginBottom: 20 }}>
            Auditorio boutique para eventos íntimos de hasta 36 personas en Recoleta, CABA.
          </p>
          <p style={{ fontSize: 13, color: 'var(--footer-text)' }}>
            Marcelo T. de Alvear 2153, 2° Piso<br />{' '}
            Recoleta · CABA
          </p>
        </div>

        {/* El espacio */}
        <div>
          <span className="footer-head">El espacio</span>
          <FooterLink to="/salas" label="Las 3 salas" />
          <FooterLink href={MATTERPORT_URL} label="Tour virtual 360°" external />
          <FooterLink to="/cotizar" label="Cotizador online" />
          <FooterLink to="/reservar" label="Reservar fecha" />
        </div>

        {/* Para eventos */}
        <div>
          <span className="footer-head">Para eventos</span>
          <FooterLink to="/conferencias" label="Conferencias" />
          <FooterLink to="/capacitaciones" label="Capacitaciones" />
          <FooterLink to="/workshops" label="Workshops" />
          <FooterLink to="/podcast-y-streaming" label="Podcast y Streaming" />
          <FooterLink to="/lanzamientos" label="Lanzamientos" />
        </div>

        {/* Contacto */}
        <div>
          <span className="footer-head">Contacto</span>
          <FooterLink href="https://wa.me/5491138255877?text=Hola%2C%20quiero%20info%20sobre%20el%20espacio" label="WhatsApp" external />
          <FooterLink href="https://www.instagram.com/espacioauditoriumeventos/" label="Instagram" external />
          <FooterLink href="https://maps.app.goo.gl/5yXfCeKArFk4hwYv8" label="Google Maps" external />
        </div>
      </div>

      <div className="footer-bottom">
        <span>© 2026 Espacio Auditorium · Todos los derechos reservados · <Link to="/privacidad" className="footer-link" style={{ display: 'inline' }}>Política de privacidad</Link></span>
        <a href="https://www.emibugliolo.com/" target="_blank" rel="noopener noreferrer">
          Desarrollado por emibugliolo.com
        </a>
      </div>
    </footer>
  )
}

function FooterLink({ to, href, label, external }) {
  if (to) return <Link to={to} className="footer-link">{label}</Link>
  return (
    <a
      href={href}
      className="footer-link"
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  )
}
