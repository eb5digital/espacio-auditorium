// Post-build: genera un index.html con meta tags únicos por ruta y agrega el
// preload de la imagen hero SOLO en la home (es la única página donde es el LCP).
// Vercel sirve dist/[ruta]/index.html directamente → Google ve el title correcto sin JS.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')

// Debe coincidir con src/components/HeroImage.jsx (HERO_WIDTHS / HERO_SIZES)
const HERO_PRELOAD = '<link rel="preload" as="image" type="image/avif" href="/img/salagaudi-1600.avif" imagesrcset="/img/salagaudi-640.avif 640w, /img/salagaudi-1024.avif 1024w, /img/salagaudi-1600.avif 1600w" imagesizes="100vw" fetchpriority="high">'

const routes = [
  {
    path: 'salas',
    title: 'Salas Gaudi, Pollock y Miró — Auditorio Boutique | Espacio Auditorium',
    description: 'Piso completo con 3 salas: Gaudi (36p), Pollock (12p) y Miró (15p). Un único precio incluye todo el espacio. Proyector HDMI, TV 42" y acústica profesional. Recoleta, CABA.',
    canonical: 'https://www.espacioauditorium.com.ar/salas',
  },
  {
    path: 'cotizar',
    title: 'Cotizá tu Auditorio Online — Precio Instantáneo | Espacio Auditorium',
    description: 'Elegí fecha, duración y horario y ves el precio al instante. Sin llamadas, sin esperas. Reservá con el 30% por Mercado Pago y bloqueá tu fecha. Auditorio en Recoleta, CABA.',
    canonical: 'https://www.espacioauditorium.com.ar/cotizar',
  },
  {
    path: 'conferencias',
    title: 'Sala para Conferencias y Charlas en Recoleta, CABA | Espacio Auditorium',
    description: 'Auditorio para conferencias y charlas de hasta 36 personas en Recoleta, CABA. Proyector HDMI, butacas, acústica profesional. Reserva online con precio al instante.',
    canonical: 'https://www.espacioauditorium.com.ar/conferencias',
  },
  {
    path: 'capacitaciones',
    title: 'Sala para Capacitaciones y Workshops en Recoleta, CABA | Espacio Auditorium',
    description: 'Espacio para capacitaciones de hasta 36 personas en Recoleta, CABA. Piso completo con 3 salas incluidas. Proyector, TV y WiFi. Reserva online sin llamadas.',
    canonical: 'https://www.espacioauditorium.com.ar/capacitaciones',
  },
  {
    path: 'podcast-y-streaming',
    title: 'Espacio para Podcast y Streaming en Recoleta, CABA | Espacio Auditorium',
    description: 'Sala con acústica e iluminación profesional para grabación de podcast, streaming en vivo y contenido audiovisual en Recoleta, CABA. Reserva online con precio instantáneo.',
    canonical: 'https://www.espacioauditorium.com.ar/podcast-y-streaming',
  },
  {
    path: 'lanzamientos',
    title: 'Espacio para Lanzamientos de Productos y Programas en CABA | Espacio Auditorium',
    description: 'Venue boutique para lanzamientos de productos, programas y servicios en Recoleta, CABA. Hasta 36 personas, piso completo exclusivo, streaming disponible. Reserva online.',
    canonical: 'https://www.espacioauditorium.com.ar/lanzamientos',
  },
  {
    path: 'privacidad',
    title: 'Política de Privacidad | Espacio Auditorium',
    description: 'Cómo Espacio Auditorium recopila, usa y protege los datos personales de quienes consultan y reservan por la web y por WhatsApp.',
    canonical: 'https://www.espacioauditorium.com.ar/privacidad',
  },
  {
    path: 'workshops',
    title: 'Sala para Workshops en Recoleta, CABA | Espacio Auditorium',
    description: 'Espacio flexible para workshops de hasta 36 personas en Recoleta, CABA. 3 salas incluidas, TV HDMI, rotafolio y WiFi. Sin intermediarios, reserva online con precio instantáneo.',
    canonical: 'https://www.espacioauditorium.com.ar/workshops',
  },
  {
    path: 'reservar',
    title: 'Reservar Auditorio en Recoleta — Precio Instantáneo | Espacio Auditorium',
    description: 'Reservá tu auditorio en Recoleta con el 30% de seña por Mercado Pago. Precio al instante, sin llamadas. 3 salas incluidas para hasta 36 personas. CABA.',
    canonical: 'https://www.espacioauditorium.com.ar/reservar',
  },
  // Rutas de app: título propio y sin indexar
  {
    path: 'pago',
    title: 'Estado de tu reserva | Espacio Auditorium',
    description: 'Estado del pago de tu reserva en Espacio Auditorium.',
    canonical: 'https://www.espacioauditorium.com.ar/pago',
    noindex: true,
  },
  {
    path: 'admin',
    title: 'Panel de administración | Espacio Auditorium',
    description: 'Panel interno.',
    canonical: 'https://www.espacioauditorium.com.ar/admin',
    noindex: true,
  },
]

const templatePath = join(distDir, 'index.html')
const template = readFileSync(templatePath, 'utf-8')
if (template.includes('rel="preload" as="image"')) {
  throw new Error('index.html no debería traer el preload del hero: lo agrega este script sólo para la home')
}

const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

for (const route of routes) {
  const url = route.canonical
  let html = template

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${route.title}</title>`)
  html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escAttr(route.description)}">`)
  html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}">`)
  html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`)
  html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escAttr(route.title)}">`)
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escAttr(route.description)}">`)
  html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${escAttr(route.title)}">`)
  html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${escAttr(route.description)}">`)
  if (route.noindex) {
    html = html.replace(/<link rel="canonical"[^>]*>/, m => `${m}\n    <meta name="robots" content="noindex, nofollow">`)
  }

  const outDir = join(distDir, route.path)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.html'), html)
  console.log(`✓ ${route.path}/index.html → "${route.title.slice(0, 60)}..."`)
}

// Home: preload del hero (LCP) justo después de la canónica
const homeHtml = template.replace(/<link rel="canonical"[^>]*>/, m => `${m}\n    ${HERO_PRELOAD}`)
writeFileSync(templatePath, homeHtml)
console.log('✓ index.html (home) → preload del hero agregado')

console.log(`\n✅ Meta injection completa — ${routes.length} rutas generadas.`)
