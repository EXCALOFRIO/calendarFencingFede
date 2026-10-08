import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { PerfilDeportivo, RivalFrecuente } from '@/lib/sport/explorar/tipos-perfil';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn, titular } from '@/lib/utils';
import { Bloque, type Nivel } from '../piezas';
import { CaraACaraHoja } from './elegir-rival-hoja';

function FilaRival({ personaId, r }: { personaId: string; r: RivalFrecuente }) {
  const gano = r.ultimo.favor > r.ultimo.contra;
  const empate = r.ultimo.favor === r.ultimo.contra;
  const nombre = nombreVisible(r.nombre) || r.nombre;
  return (
    <li className="px-3 sm:px-4">
      <FilaPersona
        persona={{ id: r.id, nombre, pais: r.pais }}
        href={construirUrlCaraACara(personaId, { rival: r.id })}
        meta={
          <span title={titular(r.ultimo.torneo)}>
            <span
              className={cn('font-semibold', empate ? 'text-foreground' : gano ? 'text-ok' : 'text-danger')}
              title={empate ? 'Último asalto sin decidir' : gano ? 'Último asalto ganado' : 'Último asalto perdido'}
            >
              {r.ultimo.favor}–{r.ultimo.contra}
            </span>{' '}
            {titular(r.ultimo.torneo)}
          </span>
        }
        insignias={
          <span className="cifra text-2xl leading-none" title={`${r.asaltos} ${r.asaltos === 1 ? 'asalto' : 'asaltos'}`}>
            {r.victorias}–{r.derrotas}
          </span>
        }
      />
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
  const otro = <CaraACaraHoja personaId={personaId} nombre={nombreVisible(nombre) || nombre} rotulo="Elegir rival" />;
  return (
    <Bloque id="ficha-rivales" titulo="Mano a mano" nivel={nivel} tituloOculto={enPestana}>
      {perfil.rivales === null ? (
        <EstadoVacio tipo="error" titulo="No se han podido cargar" descripcion="Inténtalo de nuevo en un momento." />
      ) : perfil.rivales.length === 0 ? (
        <EstadoVacio titulo="Sin asaltos importados" accion={otro} />
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
