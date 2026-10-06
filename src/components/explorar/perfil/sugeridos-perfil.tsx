import { Swords } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { TiradorSugerido } from '@/lib/sport/explorar/tipos-perfil';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { FotoDeportista } from '../foto-deportista';
import { Bloque, type Nivel } from '../piezas';

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

/** Motivo corto para la pastilla: «Rival frecuente · 17–3». */
export function pastillaMotivo(s: TiradorSugerido): string {
  const balance = s.asaltos > 0 ? `${s.victorias}–${s.derrotas}` : null;
  switch (s.motivo) {
    case 'rival_frecuente':
      return balance ? `Rival frecuente · ${balance}` : 'Rival frecuente';
    case 'mismo_club':
      return 'Mismo club';
    case 'asaltos':
      return balance ? `Rival · ${balance}` : 'Rival';
    default:
      return `${s.pruebas} en común`;
  }
}

function TarjetaSugerido({ personaId, s }: { personaId: string; s: TiradorSugerido }) {
  const nombre = nombreVisible(s.nombre) || s.nombre;
  return (
    <li className="min-w-0">
      <article className="flex h-full min-w-0 flex-col items-center gap-1.5 rounded-xl border bg-card px-2 pt-3 pb-2.5 text-center">
        <Link
          href={rutaFicha(s.id)}
          prefetch={false}
          className="flex min-h-11 w-full min-w-0 flex-col items-center gap-1.5 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <FotoDeportista personaId={s.id} nombre={nombre} tamano="lista" />
          <span className="flex w-full min-w-0 items-center justify-center gap-1.5">
            {s.pais ? <BanderaPais pais={s.pais} soloBandera className="shrink-0" /> : null}
            <span className="truncate text-sm leading-5 font-medium">{nombre}</span>
          </span>
        </Link>
        <span
          className="inline-flex h-5 max-w-full items-center truncate rounded-full bg-secondary px-2 text-[0.6875rem] font-medium whitespace-nowrap text-muted-foreground"
          title={textoMotivo(s)}
        >
          {pastillaMotivo(s)}
        </span>
        <Button asChild variant="outline" size="sm" className="mt-1 h-8 min-h-8 rounded-full px-3 text-xs">
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
 * Tiradores sugeridos, en rejilla. Salen de hechos importados
 * (asaltos entre los dos, pruebas recientes compartidas, mismo club), nunca
 * de un parecido de nombre. La foto la veta el servidor para posibles menores.
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
        <p role="status" className="text-sm text-muted-foreground">No se han podido cargar.</p>
      ) : (
        <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Tiradores sugeridos">
          {sugeridos.slice(0, 6).map((s) => <TarjetaSugerido key={s.id} personaId={personaId} s={s} />)}
        </ul>
      )}
    </Bloque>
  );
}
