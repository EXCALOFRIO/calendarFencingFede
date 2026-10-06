import { Swords, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { construirUrlCaraACara, rutaCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { PerfilDeportivo, RivalFrecuente } from '@/lib/sport/explorar/tipos-perfil';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn, titular } from '@/lib/utils';
import { FotoDeportista } from '../foto-deportista';
import { Bloque, fechaLegible, type Nivel } from '../piezas';

function FilaRival({ personaId, r }: { personaId: string; r: RivalFrecuente }) {
  const gano = r.ultimo.favor > r.ultimo.contra;
  const empate = r.ultimo.favor === r.ultimo.contra;
  return (
    <li>
      <Link
        href={construirUrlCaraACara(personaId, { rival: r.id })}
        prefetch={false}
        className="grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <FotoDeportista personaId={r.id} nombre={nombreVisible(r.nombre)} tamano="lista" apagado />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              {r.pais ? <BanderaPais pais={r.pais} soloBandera className="shrink-0" /> : null}
              <span className="truncate font-medium">{nombreVisible(r.nombre)}</span>
            </span>
            <span className="truncate text-xs text-muted-foreground" title={titular(r.ultimo.torneo)}>
              <span
                className={cn('font-semibold', empate ? 'text-foreground' : gano ? 'text-ok' : 'text-danger')}
                title={empate ? 'Último asalto sin decidir' : gano ? 'Último asalto ganado' : 'Último asalto perdido'}
              >
                {r.ultimo.favor}–{r.ultimo.contra}
              </span>
              {' · '}
              {titular(r.ultimo.torneo)}
              {r.ultimo.fecha ? ` · ${fechaLegible(r.ultimo.fecha)}` : ''}
            </span>
          </span>
        </span>
        <span className="flex flex-col items-end" title={`${r.asaltos} ${r.asaltos === 1 ? 'asalto' : 'asaltos'}`}>
          <span className="cifra text-2xl leading-none">{r.victorias}–{r.derrotas}</span>
          <span className="text-[0.625rem] text-muted-foreground">{r.asaltos} {r.asaltos === 1 ? 'asalto' : 'asaltos'}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Mano a mano: los rivales con más asaltos individuales importados. Cada fila
 * abre el cara a cara ya elegido; los asaltos con rival sin identificar no
 * cuentan aquí (no se adivina a nadie por el nombre).
 */
export function ManoAMano({
  personaId,
  perfil,
  nivel,
  enPestana = false,
}: {
  personaId: string;
  nombre: string;
  perfil: PerfilDeportivo;
  nivel: Nivel;
  enPestana?: boolean;
}) {
  const otro = (
    <Button asChild variant="outline" size="sm" className="h-9 min-h-9 rounded-full px-3.5">
      <Link href={rutaCaraACara(personaId)} prefetch={false}>
        <Swords aria-hidden />
        Elegir otro rival
      </Link>
    </Button>
  );
  return (
    <Bloque id="ficha-rivales" titulo="Mano a mano" nivel={nivel} tituloOculto={enPestana}>
      {perfil.rivales === null ? (
        <div role="alert" className="flex items-center gap-2 rounded-xl border bg-card px-3 py-3 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
          <p>No se han podido cargar los rivales.</p>
        </div>
      ) : perfil.rivales.length === 0 ? (
        <div role="status" className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">Sin asaltos importados.</p>
          {otro}
        </div>
      ) : (
        <>
          <ol className="divide-y overflow-hidden rounded-xl border bg-card" aria-label="Rivales con más asaltos">
            {perfil.rivales.map((r) => <FilaRival key={r.id} personaId={personaId} r={r} />)}
          </ol>
          <div>{otro}</div>
        </>
      )}
    </Bloque>
  );
}
