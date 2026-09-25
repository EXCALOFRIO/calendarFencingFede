import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Página no encontrada' };

/**
 * 404 de toda la aplicación: direcciones que no corresponden a ninguna ruta.
 *
 * Esta vive fuera del grupo `(app)`, así que no tiene cabecera ni barra de
 * secciones —ni sesión garantizada—, y por eso se basta sola. El único
 * enlace es al calendario: si hay sesión, entra; si no, el propio layout
 * manda a la pantalla de acceso. No se le pregunta aquí para no pintar una
 * puerta que a lo mejor no toca.
 */
export default function NoEncontrado() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1320px] flex-col items-start justify-center gap-3 px-4 py-16">
      <p className="cifra text-5xl text-muted-foreground/40">404</p>
      <h1 className="text-2xl sm:text-3xl">Esta dirección no lleva a ningún sitio</h1>
      <p className="medida text-sm text-muted-foreground">
        La página no existe o se ha movido. Lo que había en enlaces antiguos
        suele estar en el calendario, que es la pantalla principal.
      </p>
      <Button asChild className="mt-2">
        <Link href="/">Ir al calendario</Link>
      </Button>
    </main>
  );
}
