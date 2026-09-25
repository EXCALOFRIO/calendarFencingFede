import { Hammer } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Pantalla pendiente de rehacer.
 *
 * Se dice la verdad en vez de enseñar una versión a medias con el estilo
 * antiguo: la lógica de esta parte existe y está probada, lo que falta es la
 * interfaz nueva. Mentir aquí con una maqueta bonita sería peor.
 */
export function EnObra({
  titulo,
  explicacion,
}: {
  titulo: string;
  explicacion: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
      <Hammer className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl">{titulo}</h1>
      <p className="medida text-sm text-muted-foreground">{explicacion}</p>
      <Button variant="outline" asChild className="mt-2">
        <Link href="/">Volver al calendario</Link>
      </Button>
    </div>
  );
}
