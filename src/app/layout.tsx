import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Inter } from 'next/font/google';
import { Instalable } from '@/components/instalable';
import './globals.css';

/**
 * Dos familias, con papeles distintos y sin solaparse.
 *
 * - **Barlow Condensed** para lo que tiene que golpear: el mes, el día, los
 *   días que quedan, el puesto. Es una condensada de deporte —la usan los
 *   marcadores— y en cifras grandes da presencia sin ocupar sitio, que es
 *   justo el problema de una rejilla de calendario.
 * - **Inter** para todo lo demás. Es la que mejor se lee a 12 y 14 px, que es
 *   el tamaño en el que vive el 90 % de esta interfaz.
 *
 * Usar una sola familia dejaba la pantalla plana; usar la condensada para
 * todo la haría ilegible. El contraste entre las dos ES la jerarquía.
 */
/*
 * Solo 500 y 600: titulares y `.cifra` son 600; lo que hereda 400 o pide
 * `font-medium` cae en 500. Nada pide 700 (y lo resolvería con 600 sin
 * negrita sintética), así que era un fichero más precargado en cada página.
 */
const display = Barlow_Condensed({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600'],
  display: 'swap',
});

const cuerpo = Inter({
  variable: '--font-sans-ui',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'CalendarFencing',
    template: '%s · CalendarFencing',
  },
  description:
    'Calendario, inscripciones y convocatorias de esgrima en un solo sitio: ' +
    'RFEE, FIE, circuito europeo y federaciones autonómicas, filtrado por tu ' +
    'arma, tu género y tu categoría.',
  // Se puede añadir a la pantalla de inicio del móvil y se ve como una app.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CalendarFencing',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // `--background` (oklch(0.17 0.008 265)) en sRGB: la barra de estado del móvil, del mismo color que la cabecera.
  themeColor: '#090A0F',
  width: 'device-width',
  initialScale: 1,
  // Se permite ampliar: bloquear el zoom es un problema de accesibilidad real.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark">
      <body className={`${display.variable} ${cuerpo.variable} antialiased`}>
        {children}
        {/* Registra el trabajador de servicio e invita a instalar. Se queda
            en la raíz para que valga también en /entrar: en iPhone la app
            instalada no comparte cookies con Safari, así que instalar ANTES
            de entrar ahorra repetir el acceso. Los avisos (`Toaster`) van en
            el diseño de la aplicación, que es donde se usan. */}
        <Instalable />
      </body>
    </html>
  );
}
