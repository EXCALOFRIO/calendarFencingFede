import { CircleCheck, CircleHelp, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { PruebaPropia } from '@/app/(app)/estado/consultas';
import { BanderaPais } from '@/components/bandera';
import { BarraPlazos } from '@/components/calendario/barra-plazos';
import { MarcaArma } from '@/components/calendario/iconos-arma';
import { Escudo } from '@/components/escudo';
import { etiquetaGrupo } from '@/components/ranking/formato';
import { colorDeCircuito } from '@/lib/colores';
import { etiquetaRecargo } from '@/lib/deadlines';
import {
  SOURCE_LABEL,
  cn,
  formatDateEs,
  formatDateRangeEs,
  formatEur,
  titular,
} from '@/lib/utils';
import { conBarraDePlazos, diasEntre } from '@/app/(app)/estado/oficial';
import { Horarios, Rotulos, Seccion, tamanoCifra } from './piezas';

/**
 * ===========================================================================
 * «TUS COMPETICIONES»: LAS DOS PRIMERAS PREGUNTAS EN LA MISMA FILA
 * ===========================================================================
 *
 * ¿Estoy dentro? y ¿cuánto me queda? hablan del mismo objeto —una competición—
 * así que van en la misma fila y no en dos secciones. Antes eran «lo que ya has
 * pedido» y «todavía no te has inscrito», y la diferencia entre las dos era si
 * había un trámite abierto en medio. Fuera el trámite, fuera la división.
 *
 * Cada fila lleva una cifra a la izquierda y esa cifra cambia de significado
 * según en qué lado estés, porque la pregunta útil también cambia:
 *
 *   - **Si estás dentro**, lo que queda por saber es cuándo compites. La cifra
 *     son los días hasta el torneo y debajo salen los horarios del día en
 *     cuanto la organización los publica.
 *   - **Si no estás**, lo que queda por saber es cuánto tiempo tienes. La cifra
 *     son los días de plazo, con el semáforo, y debajo la barra de tramos.
 *
 * La barra de plazos es de la ficha de torneo y se importa (`barra-plazos.tsx`,
 * sección 9 de `REFERENCIAS.md`). Va con `conEstado={false}` porque la frase de
 * estado ya la escribe la cifra de la izquierda con su palabra y su color: la
 * misma frase dos veces en cuatro centímetros no informa, ocupa.
 */

const TONO_PLAZO = {
  verde: 'text-ok',
  ambar: 'text-warn',
  rojo: 'text-danger',
  cerrado: 'text-muted-foreground',
  sin_datos: 'text-muted-foreground',
} as const;

/** La forma de la pastilla de estado. El color lo pone quien la usa. */
const PASTILLA =
  'flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pe-2.5 ps-2 text-xs';

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
  const sinConfirmar = pruebas.filter(
    (p) => p.oficial.estado === 'sin_emparejar',
  );

  return (
    <Seccion
      titulo="Tus competiciones"
      contexto={
        pruebas.length === 0
          ? undefined
          : dentro > 0
            ? `${dentro} de ${pruebas.length} en la lista oficial`
            : `las ${pruebas.length} que antes cierran`
      }
      accion={
        <Link
          href="/"
          className="text-sm text-primary-text underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Ver el calendario
        </Link>
      }
    >
      {pruebas.length === 0 ? (
        <p className="medida py-4 text-sm text-muted-foreground">
          {hayTiradorSinArma
            ? 'Para saber qué competiciones te tocan hace falta un arma y una ' +
              'categoría en la ficha. En cuanto estén, aquí saldrá cada prueba ' +
              'que te corresponda, con los días que quedan de plazo y con lo ' +
              'que diga de ti la lista oficial.'
            : 'No queda ninguna prueba de tu arma y tu categoría con el plazo ' +
              'abierto, y tampoco figuras en ninguna lista oficial de las que ' +
              'están por venir. Aquí aparecerán en cuanto se abra la ' +
              'inscripción de la siguiente.'}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y">
            {pruebas.map((p, i) => (
              <Fila
                key={p.clave}
                prueba={p}
                hoy={hoy}
                conNombre={conNombre}
                /* La lista va ordenada por urgencia, así que la primera es la
                   que antes cierra y es la única que se lleva la barra. */
                destacada={i === 0}
              />
            ))}
          </ul>

          {/*
            La explicación de «Sin confirmar», UNA vez y al pie.
            Iba en cada fila con su escudo, y eran ocho párrafos idénticos y
            ocho peticiones al servidor de la RFEE por la misma imagen. Medido
            en la captura: la sección pasaba de 3.891 px. Al pie se lee igual y
            se dice una vez, que es lo que hace falta.
          */}
          {sinConfirmar.length > 0 ? (
            <p className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-1 border-t border-filete pt-3 text-xs text-muted-foreground">
              <Escudo federacion="RFEE" tamano="nota" decorativo />
              <span className="medida">
                «Sin confirmar» <strong className="font-medium">no</strong>{' '}
                quiere decir que no estés: las listas de inscritos que publica la
                federación no traen la licencia, que es lo único por lo que esta
                aplicación puede emparejarte. Abre la lista y búscate.
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
  const conBarra = conBarraDePlazos(p.estado, destacada);
  const color = colorDeCircuito(p.circuit);
  const recargo = p.estado.next?.surchargeEur
    ? etiquetaRecargo(p.estado.next.surchargeEur)
    : null;

  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <Cifra prueba={p} hoy={hoy} compiteHoy={compiteHoy} dentro={estaDentro} />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-lg">{titular(p.eventName)}</h3>
          <PastillaOficial prueba={p} />
        </div>

        {/* Fechas en pastilla y sede al lado, como en la banda del calendario:
            la pastilla dice «esto es un rango de fechas» sin escribir «Cuándo». */}
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span
            className={cn(
              'cifra shrink-0 rounded-full px-2 py-0.5 text-sm',
              color.superficie,
              color.textoSobreSuperficie,
            )}
          >
            {formatDateRangeEs(p.startDate, p.endDate)}
          </span>
          <span className="min-w-0 text-muted-foreground">
            {p.city ? titular(p.city) : 'sede no publicada'}
          </span>
          {p.country && p.country !== 'ES' ? (
            <BanderaPais pais={p.country} tamaño="fila" />
          ) : null}
        </p>

        {/*
          Arma, género y categoría en UN solo rótulo, con `etiquetaGrupo` del
          ranking. En dos rótulos —«Prueba: Florete masculino» y «Categoría:
          Absoluto»— se partían en dos renglones en un iPhone, o sea una línea
          más por fila y cinco líneas más por pantalla, para decir lo mismo.
        */}
        <Rotulos
          disposicion="linea"
          datos={[
            [
              'Prueba',
              <span key="p" className="inline-flex items-center gap-1.5">
                <MarcaArma armas={[p.weapon]} px={22} />
                {etiquetaGrupo({
                  weapon: p.weapon,
                  gender: p.gender,
                  category: p.category,
                })}
              </span>,
            ],
            ...(p.format === 'EQUIPOS'
              ? ([['Formato', 'Equipos']] as [string, React.ReactNode][])
              : []),
            ...(p.oficial.equipo
              ? ([['Equipo', p.oficial.equipo]] as [string, React.ReactNode][])
              : []),
            /* La cuota solo si la fuente la publica: en la base real ninguna de
               las 484 pruebas la tiene, así que «—» sería el caso normal y un
               rótulo que siempre está vacío es ruido. */
            ...(p.feeEur
              ? ([['Cuota', formatEur(p.feeEur)]] as [string, React.ReactNode][])
              : []),
            /* Sin barra, la fecha de cierre y el recargo posterior van aquí:
               son los dos datos concretos que la cifra de días no da, y los dos
               que cambian una decisión. El recargo solo si la fuente lo publica
               —«sin recargo» es una afirmación que casi nunca hace—, que es lo
               que decide `etiquetaRecargo`. */
            ...(!estaDentro && !conBarra && p.estado.next
              ? ([
                  [
                    'Cierra el',
                    `${formatDateEs(p.estado.next.deadlineAt)}${
                      p.estado.next.origin === 'CALCULADO' ? ' (estimado)' : ''
                    }`,
                  ],
                  ...(recargo?.tono === 'warn'
                    ? ([['Después', recargo.texto]] as [string, React.ReactNode][])
                    : []),
                ] as [string, React.ReactNode][])
              : []),
            ...(conNombre
              ? ([['Tirador', p.athleteName]] as [string, React.ReactNode][])
              : []),
          ]}
        />

        {estaDentro ? (
          /* Dentro, lo que queda por saber son las horas del día. El plazo ya
             no cambia nada: la organización ya te tiene. */
          <Horarios
            horas={[
              ['Apertura', p.installationOpen],
              ['Llamada', p.callTime],
              ['Scratch', p.scratchTime],
              ['Inicio', p.startTime],
            ]}
          />
        ) : conBarra ? (
          <BarraPlazos plazos={p.plazos} estado={p.estado} conEstado={false} />
        ) : null}

        {p.oficial.estado === 'sin_publicar' ? null : (
          <Procedencia oficial={p.oficial} />
        )}
      </div>
    </li>
  );
}

/**
 * La cifra de la izquierda, que es la razón de que la fila exista.
 *
 * Dentro: los días hasta competir. Fuera: los días de plazo, con el semáforo.
 * El ancho es fijo para que las cifras de toda la lista queden alineadas en
 * columna, que es lo que permite recorrerla con la vista en vez de leerla.
 */
function Cifra({
  prueba: p,
  hoy,
  compiteHoy,
  dentro,
}: {
  prueba: PruebaPropia;
  hoy: string;
  compiteHoy: boolean;
  dentro: boolean;
}) {
  if (compiteHoy) {
    return (
      <div className="w-16 shrink-0 sm:w-20">
        <span className="cifra block text-4xl text-primary-text sm:text-5xl">
          Hoy
        </span>
        <span className="mt-1 block text-xs leading-tight text-muted-foreground">
          compites
        </span>
      </div>
    );
  }

  if (dentro) {
    const dias = diasEntre(hoy, p.startDate);
    return (
      <div className="w-16 shrink-0 sm:w-20">
        <span className={cn('cifra block', tamanoCifra(dias))}>{dias}</span>
        <span className="mt-1 block text-xs leading-tight text-muted-foreground">
          {dias === 1 ? 'día para competir' : 'días para competir'}
        </span>
      </div>
    );
  }

  if (p.estado.daysLeft !== null) {
    const estimado = p.estado.next?.origin === 'CALCULADO';
    return (
      <div className="w-16 shrink-0 sm:w-20">
        <span
          className={cn(
            'cifra block',
            tamanoCifra(p.estado.daysLeft),
            TONO_PLAZO[p.estado.state],
          )}
        >
          {p.estado.daysLeft}
        </span>
        <span className="mt-1 block text-xs leading-tight text-muted-foreground">
          {p.estado.daysLeft === 1 ? 'día de plazo' : 'días de plazo'}
          {estimado ? ' (estimado)' : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="w-16 shrink-0 sm:w-20">
      <span className="block text-xs leading-tight text-muted-foreground">
        {p.estado.closed ? 'Plazo cerrado' : 'Plazo no publicado'}
      </span>
    </div>
  );
}

/**
 * ¿Estoy dentro?, en tres palabras y con forma además de color.
 *
 * `Dentro` solo cuando la ficha figura de verdad en la lista publicada. Los
 * otros dos estados **no dicen «no estás»**, y eso es deliberado: hoy ninguna
 * fila de lista oficial trae licencia, que es lo único por lo que se empareja,
 * así que la aplicación no puede afirmar que alguien no esté. Decir «no estás»
 * a quien sí figura con su nombre es cómo se pierde un torneo, igual que lo
 * contrario. El motivo exacto va escrito debajo, en `Procedencia`.
 */
function PastillaOficial({ prueba: p }: { prueba: PruebaPropia }) {
  if (p.oficial.estado === 'dentro') {
    return (
      <span className={cn(PASTILLA, 'border-ok/40 bg-ok/10 font-medium text-ok')}>
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        Dentro
      </span>
    );
  }

  return (
    <span
      className={cn(PASTILLA, 'border-border bg-secondary/60 text-muted-foreground')}
    >
      <CircleHelp className="size-3.5 shrink-0" aria-hidden />
      {p.oficial.estado === 'sin_emparejar' ? 'Sin confirmar' : 'Lista no publicada'}
    </span>
  );
}

/**
 * Una línea con lo que la lista oficial dice de esta prueba, y el enlace.
 *
 * Sin escudo: el escudo va una sola vez al pie de la sección, porque repetido
 * en ocho filas son ocho peticiones al servidor de la RFEE por la misma imagen.
 * Y sin párrafo: la explicación de qué significa «Sin confirmar» también va al
 * pie. Aquí solo el dato, que es el número de inscritos y de quién es la lista.
 */
function Procedencia({ oficial }: { oficial: PruebaPropia['oficial'] }) {
  const fuente = oficial.fuente
    ? (SOURCE_LABEL[oficial.fuente] ?? oficial.fuente)
    : 'la organización';

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>
        {oficial.estado === 'dentro' ? (
          <>
            Figuras en la lista de {fuente}
            {oficial.leidoEl ? `, leída el ${formatDateEs(oficial.leidoEl)}` : ''}
          </>
        ) : oficial.estado === 'sin_emparejar' ? (
          /* Sin el nombre de la fuente: lo dice una vez el escudo del pie de la
             sección, y repetido en cada fila partía la línea en dos. */
          <>
            <span className="cifra text-sm text-foreground">
              {oficial.publicados}
            </span>{' '}
            {oficial.publicados === 1
              ? 'inscrito publicado'
              : 'inscritos publicados'}
          </>
        ) : (
          <>Sin lista de inscritos publicada</>
        )}
      </span>
      {oficial.sourceUrl ? (
        <a
          href={oficial.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary-text underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Ver la lista
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ) : null}
    </p>
  );
}
