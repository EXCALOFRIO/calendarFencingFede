import { Compass } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Página no encontrada' };

/**
 * 404 dentro de la aplicación.
 *
 * Se queda con la cabecera y la barra de secciones puestas: quien llega aquí
 * ya está dentro, y lo que necesita es un camino de vuelta, no una pantalla
 * en blanco. Sin número gigante ni disculpas: qué ha pasado y qué hacer.
 */
export default function NoEncontrado() {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
      <Compass className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl">Esta página no existe</h1>
      <p className="medida text-sm text-muted-foreground">
        Puede que el enlace esté anticuado o que la competición que buscas ya
        no esté en el calendario. Desde el calendario se llega a todo.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/">Volver al calendario</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/documentos">Buscar en la normativa</Link>
        </Button>
      </div>
    </div>
  );
}
