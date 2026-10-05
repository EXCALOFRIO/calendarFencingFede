import { Swords, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { construirUrlCaraACara, rutaCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { PerfilDeportivo, RivalFrecuente } from '@/lib/sport/explorar/tipos-perfil';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { titular } from '@/lib/utils';
import { AvatarAnillo } from '../avatar-anillo';
import { Aclaracion, Bloque, Nota, fechaLegible, type Nivel } from '../piezas';

function FilaRival({ personaId, r }: { personaId: string; r: RivalFrecuente }) {
  const gano = r.ultimo.favor > r.ultimo.contra;
  const empate = r.ultimo.favor === r.ultimo.contra;
  return (
    <li>
      <Link
        href={construirUrlCaraACara(personaId, { rival: r.id })}
        prefetch={false}
        className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-4 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:grid-cols-[minmax(0,2fr)_6rem_7rem_minmax(0,2fr)] sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <AvatarAnillo nombre={nombreVisible(r.nombre)} tamano="sm" apagado />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-medium break-words">{nombreVisible(r.nombre)}</span>
            {r.pais ? <BanderaPais pais={r.pais} /> : <span className="text-xs text-muted-foreground">País no publicado</span>}
          </span>
        </span>
        <span className="flex flex-col items-end sm:items-start">
          <span className="cifra text-3xl leading-none">{r.victorias}–{r.derrotas}</span>
          <span className="text-xs text-muted-foreground">ganados y perdidos</span>
        </span>
        <span className="hidden flex-col sm:flex">
          <span className="cifra text-3xl leading-none">{r.asaltos}</span>
          <span className="text-xs text-muted-foreground">{r.asaltos === 1 ? 'asalto' : 'asaltos'}</span>
        </span>
        <span className="col-span-2 flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground sm:col-span-1">
          <span>
            Último asalto:{' '}
            <strong className="font-medium text-foreground">
              {r.ultimo.favor}–{r.ultimo.contra} {empate ? 'sin decidir' : gano ? 'ganado' : 'perdido'}
            </strong>
            <span className="sm:hidden">, {r.asaltos} {r.asaltos === 1 ? 'asalto' : 'asaltos'} en total</span>
          </span>
          <span className="break-words">
            {titular(r.ultimo.torneo)}
            {r.ultimo.fecha ? `, ${fechaLegible(r.ultimo.fecha)}` : ', fecha no publicada'}
          </span>
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
  nombre,
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
    <Button asChild variant="outline">
      <Link href={rutaCaraACara(personaId)} prefetch={false}>
        <Swords aria-hidden />
        Elegir otro rival
      </Link>
    </Button>
  );
  return (
    <Bloque id="ficha-rivales" titulo="Mano a mano" nivel={nivel} tituloOculto={enPestana}>
      {perfil.rivales === null ? (
        <div role="alert" className="flex items-start gap-2 border-y bg-card px-4 py-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p className="medida">No se han podido leer los rivales. Ha fallado la consulta; no es que no tenga asaltos.</p>
        </div>
      ) : perfil.rivales.length === 0 ? (
        <div role="status" className="flex flex-col items-start gap-3">
          <p className="medida text-sm text-muted-foreground">
            Sin asaltos importados frente a rivales identificados. Cuando se importen poules y cuadros
            de sus pruebas, aquí saldrán los rivales con más asaltos.
          </p>
          {otro}
        </div>
      ) : (
        <>
          <ol className="divide-y border-y bg-card" aria-label="Rivales con más asaltos">
            {perfil.rivales.map((r) => <FilaRival key={r.id} personaId={personaId} r={r} />)}
          </ol>
          <div>{otro}</div>
        </>
      )}
      <Aclaracion titulo="Qué asaltos se incluyen">
        <Nota>
          Asaltos individuales ya importados de {nombreVisible(nombre)}, de poule y de eliminación
          directa, con el marcador visto desde esta ficha. Los encuentros por equipos, los BYE y las
          finales sin marcador no cuentan.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}
