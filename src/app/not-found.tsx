import { Compass } from 'lucide-react';
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
      <Compass className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl">Esta página no existe</h1>
      <p className="medida text-sm text-muted-foreground">
        Puede que el enlace esté anticuado. Desde el calendario se llega a todo.
      </p>
      <Button asChild className="mt-2">
        <Link href="/">Volver al calendario</Link>
      </Button>
    </main>
  );
}
