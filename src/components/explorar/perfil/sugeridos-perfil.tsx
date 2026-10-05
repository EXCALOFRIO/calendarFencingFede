import { Swords } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { TiradorSugerido } from '@/lib/sport/explorar/tipos-perfil';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { titular } from '@/lib/utils';
import { AvatarAnillo } from '../avatar-anillo';
import { Bloque, Nota, type Nivel } from '../piezas';

/** El porqué de una sugerencia en una frase corta, sin afirmar nada que no esté importado. */
export function textoMotivo(s: TiradorSugerido): string {
  switch (s.motivo) {
    case 'rival_frecuente':
      return 'Rival frecuente';
    case 'mismo_club':
      return 'Mismo club';
    case 'asaltos':
      return s.asaltos === 1 ? 'Un asalto entre los dos' : `${s.asaltos} asaltos entre los dos`;
    default:
      return `Coinciden en ${s.pruebas} pruebas`;
  }
}

function TarjetaSugerido({ personaId, s }: { personaId: string; s: TiradorSugerido }) {
  const nombre = nombreVisible(s.nombre) || s.nombre;
  return (
    <li className="w-[8.5rem] shrink-0 snap-start sm:w-44">
      <article className="flex h-full min-w-0 flex-col items-center gap-2 rounded-md border bg-card px-3 pt-4 pb-3 text-center">
        <Link
          href={rutaFicha(s.id)}
          prefetch={false}
          className="flex min-h-11 w-full min-w-0 flex-col items-center gap-2 rounded-md underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <AvatarAnillo nombre={nombre} tamano="md" />
          <span className="line-clamp-2 min-h-10 text-sm leading-5 font-medium break-words">{nombre}</span>
        </Link>
        <span className="flex min-h-5 w-full min-w-0 items-center justify-center gap-1.5 text-xs text-muted-foreground">
          {s.pais ? <BanderaPais pais={s.pais} /> : null}
          {s.club ? <span className="truncate" title={titular(s.club)}>{titular(s.club)}</span> : null}
        </span>
        <span className="inline-flex max-w-full items-center rounded-full border border-filete-alto px-2.5 py-0.5 text-xs font-medium">
          {textoMotivo(s)}
        </span>
        <span className="text-xs text-muted-foreground">
          {s.asaltos > 0 ? (
            <>
              <strong className="cifra text-base text-foreground">{s.victorias}–{s.derrotas}</strong>{' '}
              en {s.asaltos === 1 ? 'el asalto' : `${s.asaltos} asaltos`}
            </>
          ) : `${s.pruebas} ${s.pruebas === 1 ? 'prueba' : 'pruebas'} en común`}
        </span>
        <Button asChild variant="outline" size="sm" className="mt-auto min-h-11 w-full">
          <Link href={construirUrlCaraACara(personaId, { rival: s.id })} prefetch={false} aria-label={`Cara a cara con ${nombre}`}>
            <Swords aria-hidden />
            Cara a cara
          </Link>
        </Button>
      </article>
    </li>
  );
}

/**
 * Tiradores sugeridos, en carrusel horizontal. Salen de hechos importados
 * (asaltos entre los dos, pruebas recientes compartidas, mismo club), nunca
 * de un parecido de nombre. Sin foto ni año: sólo iniciales.
 */
export function SugeridosPerfil({
  personaId,
  sugeridos,
  nivel,
}: {
  personaId: string;
  sugeridos: TiradorSugerido[] | null | undefined;
  nivel: Nivel;
}) {
  if (sugeridos === undefined || (sugeridos && sugeridos.length === 0)) return null;
  return (
    <Bloque id="ficha-sugeridos" titulo="Tiradores sugeridos" nivel={nivel}>
      {sugeridos === null ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No se han podido leer las sugerencias. El resto de la ficha no depende de ellas.
        </p>
      ) : (
        <>
          <ul
            className="-mx-4 flex min-w-0 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0"
            aria-label="Tiradores sugeridos"
          >
            {sugeridos.map((s) => <TarjetaSugerido key={s.id} personaId={personaId} s={s} />)}
          </ul>
          <Nota>
            Personas con asaltos frente a esta ficha, con pruebas recientes en común o del mismo club
            publicado. Sólo cuentan resultados importados.
          </Nota>
        </>
      )}
    </Bloque>
  );
}
