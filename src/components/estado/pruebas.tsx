import { CircleCheck, CircleHelp, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { PruebaPropia } from '@/app/(app)/estado/consultas';
import { BarraPlazos } from '@/components/calendario/barra-plazos';
import { FilaCompeticion } from '@/components/calendario/fila-competicion';
import { PastillaPlazo } from '@/components/calendario/tarjeta-bloque';
import { Escudo } from '@/components/escudo';
import { ListaDatos, ParDato } from '@/components/sistema/lista-datos';
import { Pastilla } from '@/components/sistema/pastilla';
import { textoDePlazo, type TonoPlazo } from '@/lib/calendario/rotulos';
import { etiquetaRecargo } from '@/lib/deadlines';
import { fechaCorta } from '@/lib/fechas';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { formatEur, titularTorneo } from '@/lib/utils';
import { conBarraDePlazos } from '@/app/(app)/estado/oficial';
import { Horarios, Seccion } from './piezas';

/**
 * «Tus competiciones»: ¿estoy dentro? y ¿cuánto me queda?, en la misma fila
 * porque hablan del mismo objeto. La fila es la del calendario: fecha en
 * bloque, nombre y sede, y el estado a la derecha (plazo y lista oficial).
 *
 * Dentro de la lista, lo que queda por saber son los horarios del día; fuera,
 * los tramos del plazo, con la barra de la ficha de torneo (sólo en la que
 * antes cierra). La barra va sin su frase de estado: ya la dice la pastilla.
 */

const TONO_ESTADO: Record<PruebaPropia['estado']['state'], TonoPlazo> = {
  rojo: 'peligro',
  ambar: 'aviso',
  verde: 'neutro',
  cerrado: 'neutro',
  sin_datos: 'neutro',
};

export function Pruebas({
  pruebas,
  hoy,
  conNombre,
  hayTiradorSinArma,
}: {
  pruebas: PruebaPropia[];
  /** Fecha de hoy en ISO, decidida en el servidor. */
  hoy: string;
  /** El nombre del tirador solo hace falta si se están viendo varios. */
  conNombre: boolean;
  /** Sin arma ni categoría no se puede decidir nada, y hay que decirlo. */
  hayTiradorSinArma: boolean;
}) {
  const dentro = pruebas.filter((p) => p.oficial.estado === 'dentro').length;
  const sinConfirmar = pruebas.some((p) => p.oficial.estado === 'sin_emparejar');

  return (
    <Seccion
      titulo="Tus competiciones"
      contexto={
        pruebas.length === 0
          ? undefined
          : dentro > 0
            ? `${dentro} de ${pruebas.length} en la lista oficial`
            : `Las ${pruebas.length} que antes cierran`
      }
      accion={
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary-text hover:text-foreground"
        >
          Ver el calendario
        </Link>
      }
    >
      {pruebas.length === 0 ? (
        <p className="medida py-4 text-sm text-muted-foreground">
          {hayTiradorSinArma
            ? 'Añade un arma y una categoría a la ficha para ver qué pruebas te tocan.'
            : 'Ninguna prueba de tu arma y categoría tiene el plazo abierto. Saldrá aquí en cuanto abra la siguiente.'}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {pruebas.map((p, i) => (
              <Fila
                key={p.clave}
                prueba={p}
                hoy={hoy}
                conNombre={conNombre}
                // Van por urgencia: la primera es la que antes cierra y sólo ella lleva la barra.
                destacada={i === 0}
              />
            ))}
          </ul>

          {/* La explicación de «Sin confirmar», una vez y al pie, no en cada fila. */}
          {sinConfirmar ? (
            <p className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <Escudo federacion="RFEE" tamano="nota" decorativo />
              <span className="medida">
                «Sin confirmar» <strong className="font-medium">no</strong> quiere decir que no estés:
                las listas no traen la licencia, que es lo que usamos para encontrarte. Abre la lista y
                búscate.
              </span>
            </p>
          ) : null}
        </>
      )}
    </Seccion>
  );
}

function Fila({
  prueba: p,
  hoy,
  conNombre,
  destacada,
}: {
  prueba: PruebaPropia;
  hoy: string;
  conNombre: boolean;
  destacada: boolean;
}) {
  const estaDentro = p.oficial.estado === 'dentro';
  const compiteHoy = p.startDate <= hoy && p.endDate >= hoy;
  const conBarra = !estaDentro && conBarraDePlazos(p.estado, destacada);
  const recargo = p.estado.next?.surchargeEur ? etiquetaRecargo(p.estado.next.surchargeEur) : null;
  // Sin barra, la fecha de cierre y el recargo posterior: lo que la pastilla de días no dice.
  const conCierre = !estaDentro && !conBarra && p.estado.next;

  return (
    <li>
      <FilaCompeticion
        className="px-0"
        desde={p.startDate}
        hasta={p.endDate}
        titulo={titularTorneo(p.eventName)}
        ciudad={p.city}
        pais={p.country}
        estado={
          <>
            {compiteHoy ? <Pastilla tono="marca">Compites hoy</Pastilla> : null}
            {estaDentro || compiteHoy ? null : <PlazoDePrueba prueba={p} />}
            <PastillaOficial prueba={p} />
          </>
        }
        detalle={
          <>
            <Pastilla>
              {rotuloPrueba(
                { arma: p.weapon, genero: p.gender, categoria: p.category, formato: p.format },
                { categoria: 'siempre' },
              )}
            </Pastilla>
            {conNombre ? <span className="min-w-0 text-xs text-muted-foreground">{p.athleteName}</span> : null}
          </>
        }
      >
        {p.oficial.equipo || p.feeEur || conCierre ? (
          <ListaDatos disposicion="rejilla" className="pt-2">
            {p.oficial.equipo ? <ParDato etiqueta="Equipo">{p.oficial.equipo}</ParDato> : null}
            {/* La cuota sólo si la fuente la publica: casi nunca, y un «—» fijo es ruido. */}
            {p.feeEur ? <ParDato etiqueta="Cuota">{formatEur(p.feeEur)}</ParDato> : null}
            {conCierre && p.estado.next ? (
              <ParDato etiqueta="Cierra el">
                {fechaCorta(p.estado.next.deadlineAt, { referencia: hoy })}
                {p.estado.next.origin === 'CALCULADO' ? ' (estimado)' : ''}
              </ParDato>
            ) : null}
            {conCierre && recargo?.tono === 'warn' ? <ParDato etiqueta="Después">{recargo.texto}</ParDato> : null}
          </ListaDatos>
        ) : null}

        {estaDentro ? (
          <div className="pt-2">
            <Horarios
              fecha={p.competitionDate ?? p.startDate}
              huso={p.timezone}
              horas={[
                ['Apertura', p.installationOpen],
                ['Llamada', p.callTime],
                ['Confirmación de presencia', p.scratchTime],
                ['Inicio', p.startTime],
              ]}
            />
          </div>
        ) : conBarra ? (
          <div className="pt-2">
            <BarraPlazos plazos={p.plazos} estado={p.estado} conEstado={false} />
          </div>
        ) : null}

        {p.oficial.estado === 'sin_publicar' ? null : <Procedencia oficial={p.oficial} />}
      </FilaCompeticion>
    </li>
  );
}

/** «Cierra en 3 días» con el semáforo; sin plazo, lo dice. */
function PlazoDePrueba({ prueba: p }: { prueba: PruebaPropia }) {
  if (p.estado.daysLeft !== null) {
    const estimado = p.estado.next?.origin === 'CALCULADO';
    return (
      <PastillaPlazo
        plazo={{
          texto: `${textoDePlazo(p.estado.daysLeft)}${estimado ? ' (estimado)' : ''}`,
          tono: TONO_ESTADO[p.estado.state],
        }}
      />
    );
  }
  return (
    <PastillaPlazo
      plazo={{ texto: p.estado.closed ? 'Inscripción cerrada' : 'Plazo sin publicar', tono: 'neutro', cerrado: true }}
    />
  );
}

/**
 * ¿Estoy dentro?, con forma además de color. `Dentro` sólo cuando la ficha
 * figura en la lista publicada. Los otros estados no dicen «no estás»: las
 * listas no traen licencia, así que no se puede afirmar que alguien no esté.
 */
export const ROTULO_PASTILLA: Record<PruebaPropia['oficial']['estado'], string> = {
  dentro: 'Dentro',
  sin_emparejar: 'Sin confirmar',
  /** Leída y sin inscritos: no es una lista sin leer ni «no estás». */
  vacia: 'Lista vacía',
  sin_publicar: 'Lista sin consultar',
};

export function PastillaOficial({ prueba: p }: { prueba: PruebaPropia }) {
  if (p.oficial.estado === 'dentro') {
    return (
      <Pastilla tono="ok" icono={CircleCheck} className="border-ok/40">
        Dentro
      </Pastilla>
    );
  }
  return (
    <Pastilla icono={CircleHelp} className="text-muted-foreground">
      {ROTULO_PASTILLA[p.oficial.estado]}
    </Pastilla>
  );
}

/** Lo que la lista oficial dice de esta prueba, en una línea, y el enlace a la lista. */
export function Procedencia({ oficial }: { oficial: PruebaPropia['oficial'] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">
      <span>
        {oficial.estado === 'dentro' ? (
          <>
            Figuras en la lista de inscritos
            {oficial.leidoEl ? `, leída el ${fechaCorta(oficial.leidoEl)}` : ''}
          </>
        ) : oficial.estado === 'sin_emparejar' ? (
          <>
            <span className="font-medium text-foreground tabular-nums">{oficial.publicados}</span>{' '}
            {oficial.publicados === 1 ? 'inscrito publicado' : 'inscritos publicados'}
          </>
        ) : oficial.estado === 'vacia' ? (
          <>La lista se leyó y aún no tiene inscritos</>
        ) : (
          <>Lista de inscritos sin consultar</>
        )}
      </span>
      {oficial.sourceUrl ? (
        <a
          href={oficial.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1 font-medium text-primary-text hover:text-foreground"
        >
          Ver la lista
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ) : null}
    </p>
  );
}
