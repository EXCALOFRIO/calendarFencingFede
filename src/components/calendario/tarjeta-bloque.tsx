'use client';

import { Check, Flag } from 'lucide-react';
import * as React from 'react';
import { InsigniaOrganismo } from '@/components/insignia-organismo';
import { VerMas } from '@/components/sistema/cabecera-seccion';
import { Pastilla, type TonoPastilla } from '@/components/sistema/pastilla';
import { esEntreSemana, rangoRealDeEvento, type Bloque } from '@/lib/calendario/bloques';
import { enlaceDeTarjeta, estadoDirecto } from '@/lib/calendario/enlaces-directo';
import {
  TOPE_PASTILLAS_PRUEBA,
  pastillaDeCircuito,
  plazoDe,
  pruebasDe,
  type DimensionesVisibles,
  type TonoPlazo,
} from '@/lib/calendario/rotulos';
import { colorDeOrganismo, type ColorOrganismo } from '@/lib/colores';
import { hoyMadrid } from '@/lib/fechas';
import type { EventView } from '@/lib/queries/calendar';
import type { PruebaPasada } from '@/lib/queries/calendario-pasado-modelo';
import { cn, organismoDe, titularTorneo } from '@/lib/utils';
import { PastillaDirecto } from './enlace-directo';
import { FilaCompeticion } from './fila-competicion';
import { PieResultados, conResultadosPasados } from './pasado/resultados-pasados';

/**
 * La tarjeta de un bloque del calendario: un torneo o un fin de semana con
 * varios. Cada torneo es una `FilaCompeticion`, la misma fila que «Cómo voy»:
 * fecha en bloque, nombre y sede con bandera, y el estado a la derecha.
 *
 * Una sola estructura para el móvil y el escritorio: lo que cambia es el ancho
 * de la columna, no el reparto. Todo es opaco; el organismo lo dice el filete
 * del canto izquierdo y la insignia de cada fila.
 */

/**
 * Lo que una tarjeta necesita saber del pasado: qué día es hoy —para decir
 * «Terminada»—, los resultados de Explorar de cada torneo y adónde vuelve quien
 * salga a una edición.
 */
export type PasadoDeTarjeta = {
  hoy: string;
  resultados: Record<string, PruebaPasada[]>;
  /** El calendario tal y como se está mirando, para volver desde la edición. */
  retorno?: string;
  /** Abre la hoja de resultados cuando hay más de una edición detrás. */
  onVer: (e: EventView) => void;
};

/** ¿Ya se tiró? Por el rango real de lo que se está mirando, no por el cartel. */
export function estaTerminado(evento: EventView, hoy: string): boolean {
  return rangoRealDeEvento(evento).hasta < hoy;
}

/**
 * Cuántas filas enteras caben antes de plegar el resto. Sin filtros, un fin de
 * semana junta diez torneos; pasado el tope se cuentan y se despliegan con un
 * toque, nunca se enseñan a medias.
 */
const TOPE = 4;

/** Del plazo a la pastilla: el semáforo, con un borde sutil para que se distinga del resto. */
const TONO_PLAZO: Record<TonoPlazo, { tono: TonoPastilla; borde: string }> = {
  neutro: { tono: 'neutro', borde: 'border-border' },
  aviso: { tono: 'aviso', borde: 'border-warn/40' },
  peligro: { tono: 'peligro', borde: 'border-danger/40' },
};

/** «Cierra en 2 días» en ámbar o rojo; «Inscripción cerrada» en gris. */
export function PastillaPlazo({
  plazo,
}: {
  plazo: { texto: string; tono: TonoPlazo; cerrado?: boolean };
}) {
  return (
    <Pastilla
      tono={TONO_PLAZO[plazo.tono].tono}
      className={cn(TONO_PLAZO[plazo.tono].borde, plazo.cerrado && 'text-muted-foreground')}
      data-tono-plazo={plazo.tono}
    >
      {plazo.texto}
    </Pastilla>
  );
}

export function TarjetaBloque({
  bloque,
  inscripciones,
  resaltados,
  proximo,
  mostrarArma,
  mostrarGenero,
  mostrarCategoria,
  onAbrir,
  pasado,
}: {
  bloque: Bloque;
  /** competitionId -> estado legible de la inscripción de esta cuenta. */
  inscripciones: Record<string, string>;
  /** Ids resaltados por la búsqueda. */
  resaltados: Set<string>;
  /** Id del torneo que es «lo próximo». */
  proximo: string | null;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
  /** Sin él, la tarjeta sigue diciendo «Terminada», pero no enseña resultados. */
  pasado?: PasadoDeTarjeta;
}) {
  const [todos, setTodos] = React.useState(false);
  const hoy = pasado?.hoy ?? hoyMadrid();
  const multiple = bloque.eventos.length > 1;
  const visibles = todos ? bloque.eventos : bloque.eventos.slice(0, TOPE);
  const ocultos = bloque.eventos.length - visibles.length;
  const resaltado = bloque.eventos.some((e) => resaltados.has(e.id));
  const esProximo = bloque.eventos.some((e) => e.id === proximo);
  const dimensiones: DimensionesVisibles = {
    arma: mostrarArma,
    genero: mostrarGenero,
    categoria: mostrarCategoria,
  };

  return (
    <article
      data-bloque={bloque.clave}
      data-multiple={multiple || undefined}
      className={cn(
        'relative overflow-hidden border-b border-border bg-card pl-1',
        // El aro de la búsqueda: lo reconoce el guion de capturas (`tests/ui/ficha.mts`).
        resaltado && 'ring-2 ring-foreground ring-inset',
        esProximo && !resaltado && 'ring-1 ring-primary-text ring-inset',
      )}
    >
      {/* Un tramo por organismo: un fin de semana con la RFEE y la FIE no se pinta de un solo color. */}
      <span aria-hidden className="absolute inset-y-0 left-0 flex w-1 flex-col">
        {organismosDelBloque(bloque).map((c, i) => (
          <span key={i} className={cn('flex-1', c.punto)} />
        ))}
      </span>

      {multiple ? (
        <p className="px-3 pt-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{bloque.eventos.length}</span> torneos
          coinciden
        </p>
      ) : null}

      <ul className={cn('flex min-w-0 flex-col', multiple && 'divide-y divide-border')}>
        {visibles.map((evento) => (
          <li key={evento.id} className="min-w-0">
            <FilaEvento
              evento={evento}
              inscrito={estaInscrito(evento, inscripciones)}
              dimensiones={dimensiones}
              onAbrir={onAbrir}
              hoy={hoy}
              pasado={pasado}
            />
            <PieDeEvento evento={evento} pasado={pasado} hoy={hoy} />
          </li>
        ))}
      </ul>

      {ocultos > 0 ? (
        <div className="border-t border-border px-3 py-2">
          <VerMas
            onClick={() => setTodos(true)}
            cuenta={ocultos}
            detalle={ocultos === 1 ? 'otro torneo de estas fechas' : 'torneos más de estas fechas'}
          />
        </div>
      ) : null}
    </article>
  );
}

/** Un torneo del bloque: la fila entera abre su ficha. */
function FilaEvento({
  evento,
  inscrito,
  dimensiones,
  onAbrir,
  hoy,
  pasado,
}: {
  evento: EventView;
  inscrito: boolean;
  dimensiones: DimensionesVisibles;
  onAbrir: (e: EventView) => void;
  hoy: string;
  pasado?: PasadoDeTarjeta;
}) {
  const rango = rangoRealDeEvento(evento);
  const terminado = rango.hasta < hoy;
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const circuito = pastillaDeCircuito(evento);
  const pruebas = pruebasDe(evento, dimensiones);
  const sobran = pruebas.length - TOPE_PASTILLAS_PRUEBA;

  return (
    <FilaCompeticion
      desde={rango.desde}
      hasta={rango.hasta}
      titulo={titularTorneo(evento.name)}
      ciudad={evento.city}
      pais={evento.country}
      apagado={terminado}
      onClick={() => onAbrir(evento)}
      datos={{
        'data-barra': 'torneo',
        'data-agenda': 'tarjeta',
        'data-evento': evento.id,
        'data-terminado': terminado || undefined,
      }}
      estado={
        <EstadoDelEvento
          evento={evento}
          inscrito={inscrito}
          terminado={terminado}
          entreSemana={esEntreSemana(rango)}
          enPie={terminadaEnPie(evento, pasado, hoy)}
        />
      }
      detalle={
        <>
          <InsigniaOrganismo organismo={organismo} className="h-5" />
          {circuito ? <span className="min-w-0 text-xs text-muted-foreground">{circuito}</span> : null}
          {pruebas.slice(0, TOPE_PASTILLAS_PRUEBA).map((p) => (
            <Pastilla key={p}>{p}</Pastilla>
          ))}
          {sobran > 0 ? (
            <Pastilla title={pruebas.slice(TOPE_PASTILLAS_PRUEBA).join(', ')}>
              +{sobran}
              <span className="sr-only"> pruebas</span>
            </Pastilla>
          ) : null}
        </>
      }
    />
  );
}

/**
 * El estado, siempre en el mismo sitio: el plazo, «Inscrito» al lado (no en su
 * lugar) y «Entre semana» cuando no cae en sábado ni domingo, que obliga a
 * pedir permiso. Ya tirado, «Terminada», salvo que lo diga el pie de resultados.
 */
function EstadoDelEvento({
  evento,
  inscrito,
  terminado,
  entreSemana,
  enPie,
}: {
  evento: EventView;
  inscrito: boolean;
  terminado: boolean;
  entreSemana: boolean;
  enPie: boolean;
}) {
  if (terminado) {
    return enPie ? null : (
      <Pastilla icono={Flag} className="text-muted-foreground">
        Terminada
      </Pastilla>
    );
  }
  const plazo = plazoDe(evento);
  // Inscrito, «Inscripción cerrada» ya no cambia nada.
  const conPlazo = plazo && !(inscrito && plazo.cerrado);
  return (
    <>
      {conPlazo ? <PastillaPlazo plazo={plazo} /> : null}
      {inscrito ? (
        <Pastilla tono="ok" icono={Check}>
          Inscrito
        </Pastilla>
      ) : null}
      {entreSemana ? <Pastilla>Entre semana</Pastilla> : null}
    </>
  );
}

/**
 * «Terminada» va en el pie, junto al ganador, cuando el pie existe; si no hay
 * resultados que enseñar, se queda en la fila.
 */
function terminadaEnPie(evento: EventView, pasado: PasadoDeTarjeta | undefined, hoy: string): boolean {
  return Boolean(pasado) && estaTerminado(evento, hoy) && conResultadosPasados(evento, pasado!.resultados[evento.id]).length > 0;
}

/** El pie arranca en la columna del nombre: filete, relleno, bloque de fecha y hueco. */
const SANGRIA_PIE = 'border-t-0 pr-3 pl-18';

/**
 * Quién ganó y «Resultados», debajo del torneo ya tirado; «En directo» los días
 * que se tira. Antes del torneo no se pinta: el enlace ya está en la ficha.
 */
function PieDeEvento({ evento, pasado, hoy }: { evento: EventView; pasado?: PasadoDeTarjeta; hoy: string }) {
  const terminado = estaTerminado(evento, hoy);
  const enlace = enlaceDeTarjeta(evento, hoy);
  const estado = enlace ? estadoDirecto(rangoRealDeEvento(evento), hoy, evento.timezone) : null;
  const directo = enlace && (estado === 'directo' || terminado) ? { enlace, estado: estado! } : null;
  if (terminado && pasado) {
    return (
      <PieResultados
        evento={evento}
        pruebas={pasado.resultados[evento.id]}
        retorno={pasado.retorno}
        onVer={pasado.onVer}
        clase={SANGRIA_PIE}
        directo={directo}
        terminada={terminadaEnPie(evento, pasado, hoy)}
      />
    );
  }
  if (!directo) return null;
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-end gap-x-2 px-3 pb-2 text-xs">
      <PastillaDirecto enlace={directo.enlace} estado={directo.estado} />
    </div>
  );
}

function estaInscrito(evento: EventView, inscripciones: Record<string, string>) {
  return evento.competitions.some((c) => inscripciones[c.id]);
}

/** Los colores de organismo del bloque, sin repetir y en el orden en que aparecen. */
function organismosDelBloque(bloque: Bloque): ColorOrganismo[] {
  const vistos = new Map<string, ColorOrganismo>();
  for (const e of bloque.eventos) {
    const c = colorDeOrganismo(organismoDe(e.source, e.scope, e.circuit));
    if (!vistos.has(c.punto)) vistos.set(c.punto, c);
  }
  return [...vistos.values()];
}

/**
 * El hueco entre dos bloques: una línea fina con el texto pequeño en medio,
 * «2 semanas libres · 15–27 oct». Es un dato, no un control: sin icono, sin
 * fondo, sin cambio al pasar por encima, y el texto salta de línea si no cabe.
 */
export function DivisorHueco({ texto, rango }: { texto: string; rango: string }) {
  return (
    <div
      role="separator"
      aria-label={`${texto}, ${rango}`}
      data-slot="divisor-hueco"
      className="flex min-w-0 items-center gap-3 px-3 py-2 text-xs text-muted-foreground select-none"
    >
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
      <span aria-hidden className="min-w-0 text-center tabular-nums text-balance">
        {texto} · {rango}
      </span>
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
    </div>
  );
}
