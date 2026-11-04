import { Helmet } from 'react-helmet-async'
import Layout from '../components/Layout'

const CONTACT_EMAIL = 'espacioauditorium@gmail.com'
const UPDATED = '4 de noviembre de 2026'

const h2 = { fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400, margin: '40px 0 12px' }
const p = { fontSize: 15, lineHeight: 1.75, marginBottom: 12 }
const ul = { fontSize: 15, lineHeight: 1.75, margin: '0 0 12px 20px' }

export default function PrivacidadPage() {
  return (
    <Layout>
      <Helmet>
        <title>Política de Privacidad | Espacio Auditorium</title>
        <meta name="description" content="Cómo Espacio Auditorium recopila, usa y protege los datos personales de quienes consultan y reservan por la web y por WhatsApp." />
        <link rel="canonical" href="https://www.espacioauditorium.com.ar/privacidad" />
      </Helmet>

      <section style={{ maxWidth: 820, margin: '0 auto', padding: '100px 24px 80px' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(34px, 4vw, 48px)', fontWeight: 400, marginBottom: 8 }}>
          Política de Privacidad
        </h1>
        <p style={{ ...p, opacity: 0.7 }}>Última actualización: {UPDATED}</p>

        <h2 style={h2}>1. Quiénes somos</h2>
        <p style={p}>
          Espacio Auditorium es un auditorio para eventos ubicado en Marcelo T. de Alvear 2153, 2° piso,
          Recoleta, Ciudad Autónoma de Buenos Aires, Argentina. Somos responsables del tratamiento de los datos
          personales que nos compartís a través de este sitio web y de nuestros canales de WhatsApp.
          Contacto: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2 style={h2}>2. Qué datos recopilamos</h2>
        <ul style={ul}>
          <li>Datos de contacto: nombre, teléfono, email y empresa, cuando cotizás, reservás o nos escribís.</li>
          <li>Datos del evento: fecha, horario, cantidad de personas, tipo de evento y requerimientos.</li>
          <li>Mensajes de WhatsApp: tu número, tu nombre de perfil y el contenido de los mensajes que nos enviás.</li>
          <li>Datos de pago: el pago de la seña lo procesa Mercado Pago. No almacenamos datos de tarjetas.</li>
          <li>Datos técnicos básicos de navegación necesarios para que el sitio funcione y sea seguro.</li>
        </ul>

        <h2 style={h2}>3. Para qué los usamos</h2>
        <ul style={ul}>
          <li>Responder consultas sobre disponibilidad, precios y salas.</li>
          <li>Gestionar cotizaciones, reservas, pagos y confirmaciones.</li>
          <li>Hacer un seguimiento de tu consulta, siempre que no nos hayas pedido que no te escribamos.</li>
          <li>Cumplir obligaciones legales y prevenir fraudes o usos indebidos.</li>
        </ul>
        <p style={p}>No vendemos ni alquilamos tus datos personales.</p>

        <h2 style={h2}>4. Atención automatizada por WhatsApp</h2>
        <p style={p}>
          Nuestra línea de WhatsApp de primera atención usa un asistente automatizado con inteligencia artificial
          para responder consultas frecuentes. Cuando lo pedís, o cuando la consulta lo requiere, te derivamos con
          una persona del equipo. Podés dejar de recibir mensajes en cualquier momento respondiendo <strong>BAJA</strong>.
        </p>

        <h2 style={h2}>5. Con quién los compartimos</h2>
        <p style={p}>Usamos proveedores que tratan datos por cuenta nuestra, solo para prestar el servicio:</p>
        <ul style={ul}>
          <li>Meta Platforms (WhatsApp Business), para enviar y recibir mensajes.</li>
          <li>Proveedores de inteligencia artificial (xAI y Anthropic), para generar las respuestas del asistente.</li>
          <li>Supabase y Vercel, para alojar el sitio y la base de datos.</li>
          <li>Google (Calendar, Sheets y Gmail), para gestionar disponibilidad, consultas y comunicaciones.</li>
          <li>Mercado Pago, para procesar los pagos.</li>
        </ul>
        <p style={p}>
          Algunos de estos proveedores pueden alojar datos fuera de Argentina. Trabajamos con empresas que aplican
          medidas de seguridad adecuadas.
        </p>

        <h2 style={h2}>6. Cuánto tiempo los guardamos</h2>
        <p style={p}>
          Conservamos los datos mientras sean necesarios para atender tu consulta o reserva y para cumplir
          obligaciones legales. Las conversaciones sin reserva se eliminan o anonimizan cuando ya no son necesarias.
        </p>

        <h2 style={h2}>7. Tus derechos</h2>
        <p style={p}>
          De acuerdo con la Ley 25.326 de Protección de Datos Personales, podés acceder, rectificar, actualizar o
          pedir la eliminación de tus datos escribiendo a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          Respondemos dentro de los plazos legales. La Agencia de Acceso a la Información Pública, órgano de control
          de la Ley 25.326, atiende las denuncias y reclamos por incumplimiento de las normas sobre protección de
          datos personales.
        </p>

        <h2 id="eliminacion" style={h2}>8. Cómo pedir la eliminación de tus datos</h2>
        <p style={p}>
          Enviá un email a <a href={`mailto:${CONTACT_EMAIL}?subject=Eliminar%20mis%20datos`}>{CONTACT_EMAIL}</a> con
          el asunto “Eliminar mis datos” e indicá el número de teléfono o email con el que nos contactaste.
          Eliminamos la información asociada y te confirmamos por el mismo medio.
        </p>

        <h2 style={h2}>9. Cambios</h2>
        <p style={p}>
          Podemos actualizar esta política. La versión vigente es siempre la publicada en esta página, con su fecha
          de actualización.
        </p>
      </section>
    </Layout>
  )
}
