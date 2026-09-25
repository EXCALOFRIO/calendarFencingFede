import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
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
const display = Barlow_Condensed({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const cuerpo = Inter({
  variable: '--font-sans-ui',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Calendario de Esgrima',
    template: '%s · Calendario de Esgrima',
  },
  description:
    'Calendario, inscripciones y convocatorias de esgrima en un solo sitio: ' +
    'RFEE, FIE, circuito europeo y federaciones autonómicas, filtrado por tu ' +
    'arma, tu género y tu categoría.',
  // Se puede añadir a la pantalla de inicio del móvil y se ve como una app.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Esgrima',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#09090b',
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
        {/*
          Avisos. Van aquí, en la raíz, porque cualquier pantalla puede
          necesitar confirmar una acción («Inscripción solicitada»,
          «Convocatoria publicada») y sin este montaje `sonner` no pinta
          nada: las pantallas tenían que resolverlo cada una a su manera y
          el mismo hecho se comunicaba de tres formas distintas.

          `richColors` está apagado a propósito: los colores los pone el
          tema de la aplicación, y el rojo y el verde de la librería no son
          los del semáforo de plazos.
        */}
        <Toaster position="bottom-center" closeButton />
      </body>
    </html>
  );
}
