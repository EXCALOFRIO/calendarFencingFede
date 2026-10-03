'use client';

import { ChevronRight, ExternalLink, Scissors } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  BreakdownEntry,
  FilaOficial,
  RankingGroupKey,
  RankingRowView,
  TablaOficial,
} from '@/lib/queries/ranking';
import type { Weapon } from '@/lib/auth/session';
import { puedeVerInterno } from '@/lib/ranking/acceso-interno';
import type { CutoffStatus } from '@/lib/ranking/compute';
import { nombreCasa } from '@/lib/nombres';
import { cn, formatDateEs } from '@/lib/utils';
import { Desglose } from './desglose';
import { SelectoresGrupo } from './selectores-grupo';
import { clave, etiquetaGrupo, puntos } from './formato';

type Grupo = RankingGroupKey & { tiradores: number };

/**
 * Cuántas filas de la clasificación se pintan de golpe.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SE PAGINA, CON EL NÚMERO DELANTE
 * -------------------------------------------------------------------------
 * La decisión de no paginar estaba tomada a propósito y era razonable: en una
 * clasificación, encontrarte en la lista es la mitad del valor, y paginar te
 * puede mandar a una página en la que no estás.
 *
 * Lo que cambia la decisión es el tamaño real de los grupos, medido en la
 * base y no supuesto: el más grande NO tiene 89 filas, tiene **259** (espada
 * masculina absoluta), y detrás van 131, 109 y 107. A 88 px por fila en un
 * móvil eso son más de 22.000 px de tabla, o sea veintiocho pantallas de
 * desplazamiento por debajo de los controles. Nadie llega al puesto 200
 * bajando con el pulgar.
 *
 * Y el motivo para no paginar se resuelve aparte, sin renunciar al recorte:
 *
 *  · si eres tú, tu fila ya está ARRIBA, fuera de la tabla, en el bloque de
 *    «tu puesto oficial» con la distancia al corte. No hay que buscarse;
 *  · **si estás más allá del tope, la tabla se abre en tu página**, no en la
 *    primera. Eso es lo que un recorte a secas rompía;
 *  · el corte de convocatoria manda: si el tope caería antes del corte, se
 *    baja el tope hasta pasarlo, porque cortar la lista justo antes de la
 *    línea de tijera esconde justo lo que se viene a mirar.
 *
 * Cincuenta filas son las que se recorren de una sentada y dejan la tabla en
 * unos 4.400 px, del mismo orden que el resto de las pantallas largas.
 */
const PASO = 50;

/**
 * La clasificación OFICIAL de la RFEE, que es la que la gente reconoce.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ UNA SOLA TABLA Y NO DOS PESTAÑAS
 * -------------------------------------------------------------------------
 * Aquí conviven dos números distintos: el ranking que publica la federación
 * (1.235 filas, 808 tiradores) y el cálculo interno de esta aplicación, que
 * existe solo para los tiradores cuyos resultados están emparejados. La
 * tentación era ponerlos en dos pestañas, y se ha descartado por dos motivos.
 *
 * El primero es el contrato de interfaz: «cero submenús», y si una sección
 * necesita pestañas internas probablemente son dos secciones o ninguna. El
 * segundo es más importante: en dos tablas, la misma persona aparecería dos
 * veces con dos puestos distintos y sin nada que explique por qué. Eso no es
 * enseñar dos datos, es sembrar una duda.
 *
 * Así que hay UNA lista —la oficial, en el orden en que la publica la
 * federación— y el cálculo interno entra por donde vale de verdad: **el
 * desglose**. Al tocar la fila de un tirador con ficha se abre su panel con el
 * puesto oficial arriba y, debajo y con su nombre puesto, de dónde sale cada
 * punto según la normativa. Lo que se pierde es el «puesto interno» como
 * número, que sobre tres tiradores emparejados no significaba nada.
 *
 * En móvil NO se hace scroll horizontal: se enseñan puesto, quién y puntos, y
 * el club y el año bajan a una segunda línea dentro de la celda del nombre.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ AQUÍ NO HAY BANDERAS, Y SÍ CÓDIGO DE CLUB
 * -------------------------------------------------------------------------
 * Son dos rankings distintos y cada uno tiene el dato que tiene:
 *
 *  · ESTE, el NACIONAL de la RFEE, son todos españoles. `official_ranking_entry`
 *    no tiene ni columna de país, y con razón: una bandera sería el mismo icono
 *    repetido en las 1.235 filas, o sea ruido con forma de dato. Lo que
 *    distingue a un tirador de otro aquí es el CLUB, y por eso el club está y
 *    la bandera no.
 *  · El MUNDIAL de la FIE sí tiene país por tirador, pero **lo que se guarda
 *    es el censo ESPAÑOL** —343 tiradores, 433 filas de `fie_world_ranking`—,
 *    así que también son todos `ESP`. No es una carencia que se arregle
 *    raspando más: el censo se pide por país a propósito, para no bajarse el
 *    ranking mundial de los otros once mil (ver la cabecera de
 *    `src/lib/ingest/sources/fie-tiradores.ts`).
 *
 * O sea que hoy una bandera no distinguiría nada en ninguno de los dos, y el
 * sitio donde el país SÍ informa —en qué país se celebra cada torneo— ya lo
 * pinta el calendario. Si algún día se guardan rivales extranjeros con su país,
 * el sitio es `fie_fencer.country_code`, que es `ESP` de tres letras y habría
 * que pasarlo a dos para cualquier solución de bandera.
 */
export function TablaRankingOficial({
  grupos,
  tablas,
  cortes,
  desgloses,
  internos,
  mios,
  grupoInicial,
  conMiFicha = false,
  armasAutorizadas = [],
}: {
  /**
   * Armas cuyo cálculo interno puede ver esta cuenta (`armasInternas`). El
   * bloque y las promesas del cálculo salen por el ARMA seleccionada: sin
   * permiso no se confunde la falta de acceso con la falta de resultados.
   */
  armasAutorizadas?: readonly Weapon[];
  grupos: Grupo[];
  tablas: Record<string, TablaOficial>;
  /** `grupo` -> `athleteId` -> distancia al corte, medida sobre el puesto oficial. */
  cortes: Record<string, Record<string, CutoffStatus>>;
  /** `grupo|athleteId` -> desglose del cálculo interno, donde exista. */
  desgloses: Record<string, BreakdownEntry[]>;
  /** `grupo|athleteId` -> fila del cálculo interno, para poder decir su puesto. */
  internos: Record<string, RankingRowView>;
  mios: string[];
  grupoInicial: string;
  /**
   * `true` cuando la pantalla ya enseña la ficha del tirador arriba
   * (`FichaRanking`), con su foto y el puesto como insignia.
   *
   * Entonces este bloque **no repite la cifra gigante**: el mismo «3» dos
   * veces en la misma pantalla se lee como un fallo, no como énfasis. Se queda
   * con lo que la ficha no dice, que es la distancia al corte de convocatoria,
   * y con el enlace al desglose del cálculo.
   */
  conMiFicha?: boolean;
}) {
  const [claveActual, setClaveActual] = React.useState(grupoInicial);
  const [abierto, setAbierto] = React.useState<string | null>(null);
  const [tope, setTope] = React.useState(PASO);
  const [busqueda, setBusqueda] = React.useState('');

  const grupo = grupos.find((g) => clave(g) === claveActual) ?? grupos[0];
  const tabla = tablas[clave(grupo)];
  const corteDelGrupo = cortes[clave(grupo)] ?? {};
  const verCalculo = puedeVerInterno(armasAutorizadas, grupo.weapon);

  /**
   * Al cambiar de arma se conservan género y categoría SI existen para la nueva
   * arma. Si no, se cae al primer grupo que sí exista: hoy hay espada femenina
   * M17 y M20 pero no absoluta, y el selector no puede quedarse apuntando a una
   * combinación vacía.
   */
  function elegir(cambio: Partial<RankingGroupKey>) {
    const deseado = { ...grupo, ...cambio };
    const exacto = grupos.find((g) => clave(g) === clave(deseado));
    if (exacto) return setClaveActual(clave(exacto));

    const porArmaGenero = grupos.find(
      (g) => g.weapon === deseado.weapon && g.gender === deseado.gender,
    );
    const porArma = grupos.find((g) => g.weapon === deseado.weapon);
    setClaveActual(clave(porArmaGenero ?? porArma ?? grupos[0]));
  }

  const misFilas = tabla.rows.filter(
    (r) => r.athleteId !== null && mios.includes(r.athleteId),
  );
  const filaAbierta = abierto
    ? (tabla.rows.find((r) => r.athleteId === abierto) ?? null)
    : null;

  const plazas = tabla.rule?.rankingPlaces ?? 0;
  const hayCorte = plazas > 0 && tabla.clasificados > plazas;
  const conFicha = tabla.rows.filter((r) => r.athleteId !== null).length;

  /**
   * Cuántas filas se enseñan, con las dos excepciones que hacen que recortar
   * no esconda nada importante.
   */
  const minimo = React.useMemo(() => {
    let suelo = PASO;

    // 1. Si el corte de convocatoria cae más allá, se estira hasta pasarlo:
    //    una lista que acaba en el puesto 50 con el corte en el 38 está bien,
    //    pero con el corte en el 64 dejaría fuera la línea de tijera, que es
    //    la razón por la que un seleccionador abre esta pantalla.
    if (hayCorte && plazas > 0) suelo = Math.max(suelo, plazas + 5);

    // 2. Si una de tus filas está más abajo, se estira hasta incluirla. Nadie
    //    tiene que pulsar «ver más» para encontrarse a sí mismo.
    for (const fila of tabla.rows) {
      if (fila.athleteId && mios.includes(fila.athleteId)) {
        const donde = tabla.rows.indexOf(fila) + 1;
        suelo = Math.max(suelo, donde + 3);
      }
    }

    return suelo;
  }, [hayCorte, plazas, tabla.rows, mios]);

  // Al cambiar de grupo se vuelve al tope de partida: arrastrar «ver más» de
  // una categoría de 259 filas a una de 32 pintaría la lista entera sin que
  // nadie lo haya pedido.
  React.useEffect(() => {
    setTope(PASO);
    setBusqueda('');
  }, [claveActual]);

  /**
   * El buscador filtra y, mientras hay algo escrito, NO se recorta: quien
   * escribe un nombre quiere ese nombre, y esconderlo detrás de «ver más»
   * porque va en el puesto 180 convierte el buscador en un adorno.
   */
  const filtradas = busqueda
    ? tabla.rows.filter((f) => nombreCasa(f.nombre, busqueda))
    : tabla.rows;
  const limite = Math.max(tope, minimo);
  const filasVisibles = busqueda ? filtradas : filtradas.slice(0, limite);
  const quedan = filtradas.length - filasVisibles.length;

  return (
    <div className="ranking flex min-w-0 flex-col gap-4">
      {/*
        Los controles, compartidos con la tabla del ranking mundial.

        Estaban escritos aquí —dos `ToggleGroup` y un `Select`— y se han ido a
        `selectores-grupo.tsx` cuando apareció la segunda tabla: dos juegos de
        selectores que se eligen igual acaban siendo distintos el día que se
        toca uno. De paso traen el buscador, que aquí hacía más falta que allí:
        el grupo más grande son 259 filas.
      */}
      <SelectoresGrupo
        grupos={grupos}
        grupo={grupo}
        onElegir={elegir}
        busqueda={busqueda}
        onBuscar={setBusqueda}
      />

      {/*
        Dónde estás tú, y a cuánto del corte.

        Es la única razón por la que un tirador abre esta pantalla, así que el
        puesto va en cifra de marcador: la tabla de abajo tiene doscientos
        números del mismo tamaño y, sin este contraste, el tuyo se pierde.
      */}
      {misFilas.map((fila) => (
        <Button
          variant="ghost"
          key={fila.id}
          type="button"
          onClick={() => setAbierto(fila.athleteId)}
          className="flex h-auto min-w-0 cursor-pointer items-start justify-start gap-4 rounded-none border-y border-filete-alto bg-card px-4 py-4 text-left whitespace-normal transition-colors hover:bg-accent"
        >
          {conMiFicha ? null : (
            <span className="flex w-16 shrink-0 flex-col">
              <span className="cifra text-5xl text-primary-text sm:text-6xl">
                {fila.position ?? '—'}
              </span>
              <span className="mt-1 text-xs leading-tight text-muted-foreground">
                {fila.position ? 'tu puesto oficial' : 'sin clasificar todavía'}
              </span>
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-base font-medium">
              {conMiFicha ? 'A cuánto estás del corte' : fila.nombre}
            </span>
            <span className="medida text-sm text-muted-foreground">
              <Corte
                corte={fila.athleteId ? (corteDelGrupo[fila.athleteId] ?? null) : null}
                puntosTotales={fila.totalPoints}
                deCuantos={tabla.clasificados}
              />
            </span>
            <span className="mt-1 inline-flex items-center gap-1 text-sm text-primary-text">
              {verCalculo ? 'Ver tus datos y el cálculo' : 'Ver tus datos'}
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </span>
          </span>
        </Button>
      ))}

      {/*
        DE DÓNDE SALE LA TABLA, EN UNA LÍNEA.

        Eran siete líneas de texto gris: cuántas filas hay, cuántas tienen
        puesto, que no la calcula esta aplicación, las plazas de la normativa,
        y un párrafo aparte explicando que el club es un código. El usuario lo
        señaló entero: *«hay mucho texto que no quiero, como todo esto»*.

        Se queda lo que responde «¿me puedo fiar de esto?»: **qué es, de qué
        temporada, cuándo se leyó y el enlace al original**. Los recuentos se
        ven contando la tabla que hay justo debajo, y lo del código de club lo
        dice ya la cabecera de su columna, «Club (código)», que es donde hace
        falta y no obliga a leer un párrafo para entender una celda.
      */}
      {/*
        Y NO SE REPITE LO QUE YA DICE LA CABECERA.

        Visto en la captura de producción: el subtítulo de la pantalla dice
        «Clasificación oficial de la RFEE, temporada 2026-2027» y esta línea lo
        repetía palabra por palabra dos renglones más abajo. Dicho dos veces es
        otra vez el «mucho texto» de la queja. Aquí queda solo lo que el
        subtítulo no dice: cuándo se leyó y dónde está el original.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-filete-alto pt-2 text-xs text-muted-foreground">
        <span>Clasificación oficial RFEE</span>
        {tabla.actualizadoEl ? <span>Leída {formatDateEs(tabla.actualizadoEl)}</span> : null}
        {tabla.sourceUrl ? (
          <Button variant="link" size="sm" className="px-0 text-xs text-primary-text" asChild>
            <a
              href={tabla.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ver la fuente
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </Button>
        ) : null}
      </div>

      {filasVisibles.length === 0 ? (
        <p className="border-y border-filete-alto py-6 text-sm text-muted-foreground">
          {busqueda ? 'Ningún tirador coincide. Prueba otro nombre.' : 'Sin puestos publicados en este grupo.'}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 pl-0 text-right">#</TableHead>
            <TableHead>Tirador</TableHead>
            {/*
              «Club (código)» y no «Club» a secas: la columna no lleva el
              nombre del club, lleva el código interno de Skermo, y encabezarla
              «Club» afirma que el club se llama «SAMA-M». Ver `CodigoClub`.
            */}
            <TableHead className="hidden md:table-cell">Club (código)</TableHead>
            <TableHead className="hidden w-20 text-right md:table-cell">Nació</TableHead>
            <TableHead className="w-20 pr-0 text-right">Puntos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filasVisibles.map((fila) => (
            <React.Fragment key={fila.id}>
              <Fila
                fila={fila}
                esMia={fila.athleteId !== null && mios.includes(fila.athleteId)}
                onAbrir={
                  fila.athleteId ? () => setAbierto(fila.athleteId) : undefined
                }
              />
              {hayCorte && fila.position === plazas ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="px-0 py-0">
                    <div className="flex items-center gap-2 border-y border-dashed border-gold/60 bg-gold/5 px-2 py-1.5 text-xs text-gold">
                      <Scissors className="size-3.5 shrink-0" aria-hidden />
                      <span className="whitespace-normal">
                        Corte de convocatoria: las {plazas} primeras plazas salen
                        por ranking
                        {tabla.rule && tabla.rule.technicalPlaces > 0
                          ? `; otras ${tabla.rule.technicalPlaces} las decide el criterio técnico`
                          : ''}
                        .
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>

      {/*
        «Ver más», con el número de lo que falta.

        Es un botón de 44 px de alto y ancho completo porque se toca con el
        pulgar al final de una lista larga, y dice cuántas filas quedan: «ver
        50 más» de «209» informa de dónde estás; «ver más» a secas, no.
      */}
      {quedan > 0 ? (
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => setTope(limite + PASO)}
        >
          Ver {Math.min(quedan, PASO)} puestos más
          <span className="cifra text-xs text-muted-foreground">
            quedan {quedan}
          </span>
        </Button>
      ) : null}

      {conFicha < tabla.rows.length ? (
        <p className="medida text-xs text-muted-foreground">
          <span className="cifra text-base">{tabla.rows.length - conFicha}</span>{' '}
          {tabla.rows.length - conFicha === 1 ? 'tirador' : 'tiradores'} sin ficha vinculada.
          {' '}Solo se muestran sus datos publicados por la RFEE,
          no sus plazos ni inscripciones{verCalculo ? ' ni su cálculo interno' : ''}.
        </p>
      ) : null}

      <Sheet
        open={filaAbierta !== null}
        onOpenChange={(v) => {
          if (!v) setAbierto(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {filaAbierta ? (
            <>
              <SheetHeader className="pb-0">
                <SheetTitle className="pr-10 text-xl">{filaAbierta.nombre}</SheetTitle>
                <SheetDescription className="pr-10">
                  {etiquetaGrupo(grupo)}
                  {filaAbierta.club ? `. Código de club ${filaAbierta.club}` : ''}
                </SheetDescription>
              </SheetHeader>
              <DetalleFilaOficial
                fila={filaAbierta}
                tabla={tabla}
                corte={
                  filaAbierta.athleteId
                    ? (corteDelGrupo[filaAbierta.athleteId] ?? null)
                    : null
                }
                desglose={
                  filaAbierta.athleteId
                    ? (desgloses[`${clave(grupo)}|${filaAbierta.athleteId}`] ?? null)
                    : null
                }
                interno={
                  filaAbierta.athleteId
                    ? (internos[`${clave(grupo)}|${filaAbierta.athleteId}`] ?? null)
                    : null
                }
                esTuyo={
                  filaAbierta.athleteId !== null && mios.includes(filaAbierta.athleteId)
                }
                verCalculo={verCalculo}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Cuerpo del panel de una fila oficial: el dato de la federación siempre y,
 * debajo y con su nombre puesto, el cálculo interno solo si esta cuenta puede
 * verlo para el arma de la tabla.
 *
 * Sin permiso no se pinta ni el bloque ni la frase «sin cálculo propio»:
 * decirla confundiría la falta de acceso con la falta de resultados.
 */
export function DetalleFilaOficial({
  fila,
  tabla,
  corte,
  desglose,
  interno,
  esTuyo,
  verCalculo,
}: {
  fila: FilaOficial;
  tabla: TablaOficial;
  corte: CutoffStatus | null;
  desglose: BreakdownEntry[] | null;
  interno: RankingRowView | null;
  esTuyo: boolean;
  verCalculo: boolean;
}) {
  return (
    <div className="flex flex-col gap-6 px-4 pb-10">
      <Oficial
        fila={fila}
        temporada={tabla.seasonLabel}
        deCuantos={tabla.clasificados}
        corte={corte}
        urlFuente={tabla.sourceUrl}
      />

      {verCalculo ? (
        /*
          El cálculo interno, con su nombre puesto y debajo del oficial.
          Nunca al lado sin etiqueta: son dos números distintos y
          confundirlos sería peor que no enseñar ninguno.
        */
        <div className="flex flex-col gap-3 border-t pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-lg">Cálculo de esta aplicación</h3>
            <p className="text-xs text-muted-foreground">
              No es el ranking de la federación
            </p>
          </div>

          {fila.athleteId && desglose ? (
            <Desglose
              puesto={interno?.position ?? 0}
              total={interno?.totalPoints ?? 0}
              pruebas={desglose}
              corte={null}
              regla={tabla.rule}
              esTuyo={esTuyo}
            />
          ) : (
            <p className="medida text-sm text-muted-foreground">
              Todavía no hay ningún resultado de esta temporada emparejado con
              su licencia, así que no hay cálculo propio que abrir. El puesto
              oficial de arriba no depende de esto: lo publica la federación.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Los datos oficiales del tirador, que son la cabecera del panel. */
function Oficial({
  fila,
  temporada,
  deCuantos,
  corte,
  urlFuente,
}: {
  fila: FilaOficial;
  temporada: string;
  deCuantos: number;
  corte: CutoffStatus | null;
  urlFuente: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <span className="flex items-baseline gap-2">
          <span className="cifra text-4xl">
            {fila.position ? `${fila.position}.º` : '—'}
          </span>
          <span className="max-w-28 text-xs leading-tight text-muted-foreground">
            {fila.position
              ? `de ${deCuantos} en la clasificación oficial`
              : 'sin clasificar en la oficial'}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="cifra text-4xl">
            {fila.totalPoints === null ? '—' : puntos(fila.totalPoints)}
          </span>
          <span className="max-w-24 text-xs leading-tight text-muted-foreground">
            puntos oficiales
          </span>
        </span>
        {fila.anioNacimiento ? (
          <span className="flex items-baseline gap-2">
            <span className="cifra text-2xl">{fila.anioNacimiento}</span>
            <span className="max-w-24 text-xs leading-tight text-muted-foreground">
              año de nacimiento
            </span>
          </span>
        ) : null}
      </div>

      {corte ? (
        <p
          className={cn(
            'medida rounded-lg border px-3 py-2.5 text-sm',
            corte.inside ? 'border-ok/40 text-ok' : 'text-muted-foreground',
          )}
        >
          {corte.explanation}
        </p>
      ) : null}

      <p className="medida text-xs text-muted-foreground">
        Temporada {temporada}, leído de la clasificación que publica la RFEE.
        {urlFuente ? (
          <>
            {' '}
            <a
              href={urlFuente}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary-text underline underline-offset-4"
            >
              Verlo allí
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Distancia al corte, en una línea.
 *
 * Medida sobre los puestos OFICIALES, que es la corrección que faltaba: el
 * corte de convocatoria lo decide la clasificación de la federación, no la
 * nuestra. La normativa (cuántas plazas y en qué fecha) sigue siendo la misma.
 */
function Corte({
  corte,
  puntosTotales,
  deCuantos,
}: {
  corte: CutoffStatus | null;
  puntosTotales: number | null;
  deCuantos: number;
}) {
  const conPuntos =
    puntosTotales === null ? 'sin puntos publicados' : `${puntos(puntosTotales)} puntos`;

  if (!corte || corte.rankingPlaces === 0) {
    return (
      <>
        {conPuntos} entre {deCuantos} tiradores. La normativa de la temporada no
        fija plazas por ranking en esta categoría, así que no se puede decir
        dónde está el corte.
      </>
    );
  }

  const tecnicas =
    corte.technicalPlaces > 0
      ? ` Otras ${corte.technicalPlaces} plazas las decide el criterio técnico.`
      : '';

  if (corte.inside) {
    return (
      <>
        {conPuntos}. Dentro de las {corte.rankingPlaces} plazas que salen por
        ranking.{tecnicas}
      </>
    );
  }

  return (
    <>
      A <span className="cifra text-sm text-foreground">{corte.placesAway}</span>{' '}
      {corte.placesAway === 1 ? 'puesto' : 'puestos'}
      {corte.pointsAway !== null ? (
        <>
          {' '}
          y{' '}
          <span className="cifra text-sm text-foreground">
            {puntos(corte.pointsAway)}
          </span>{' '}
          puntos
        </>
      ) : null}{' '}
      del corte, que está en el puesto {corte.rankingPlaces}.{tecnicas}
    </>
  );
}

/**
 * EL CLUB DEL RANKING NACIONAL ES UN CÓDIGO, Y SE DICE QUE LO ES.
 *
 * Skermo NO publica el nombre del club en ninguna parte: publica un código
 * interno («SAMA-M», «ATENEO-M», «FED-M-C», «CESJV-B»). Está comprobado
 * descargando las páginas, no supuesto:
 *
 *  · la tabla del ranking da `<td>SAMA-M</td>`, texto pelado, sin `title`, sin
 *    `data-*`, sin `abbr` y sin tooltip;
 *  · la ficha del tirador (`/ranking-rfee/public/RFEE/<id>`) da lo mismo;
 *  · el calendario completo (2,5 MB, 425 pruebas) no tiene ni un rótulo de
 *    club ni de organizador, y cero coincidencias de «Club de Esgrima», «Sala
 *    de Armas» o «Club d'Esgrima» en todo el documento;
 *  · la pestaña de inscritos, incluida la de equipos, también es código;
 *  · `/clubs`, `/club`, `/clubes`, `/entity` y media docena más dan 500.
 *
 * Así que hay 77 códigos distintos en las 1.235 filas del ranking y ninguna
 * fuente que los traduzca. Las dos salidas malas serían inventarse los nombres
 * —alguien se los creería— o dejar «SAMA-M» debajo de una columna que dice
 * «Club», que es afirmar que el club se llama así. Por eso se pinta como lo que
 * es: monoespaciado, apagado y con el `title` explicando de dónde sale. Debajo
 * de la tabla hay una línea que lo cuenta una sola vez.
 *
 * Si algún día aparece el nombre (un directorio de la RFEE, un listado nuevo de
 * Skermo), el sitio donde ponerlo es `club.skermo_club_code` -> `club.name`,
 * que ya existe para esto, y esta función pasa a preferir el nombre.
 *
 * NO LLEVA BANDERA, y también es una decisión medida: en el ranking NACIONAL
 * son todos españoles —`official_ranking_entry` no tiene ni columna de país—,
 * así que una bandera sería el mismo icono repetido 1.235 veces. Ver la nota de
 * la cabecera del fichero.
 */
function CodigoClub({ codigo }: { codigo: string | null }) {
  if (!codigo) {
    return <span className="text-muted-foreground/60">sin club publicado</span>;
  }
  return (
    <span
      className="font-mono text-[0.8em] uppercase tracking-tight"
      title={`Código de club de Skermo: ${codigo}. La fuente no publica el nombre completo.`}
    >
      {codigo}
    </span>
  );
}

function Fila({
  fila,
  esMia,
  onAbrir,
}: {
  fila: FilaOficial;
  esMia: boolean;
  /** Sin ficha en la aplicación no hay nada que abrir, y un clic muerto molesta. */
  onAbrir?: () => void;
}) {
  return (
    <TableRow
      onClick={onAbrir}
      tabIndex={onAbrir ? 0 : undefined}
      onKeyDown={
        onAbrir
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAbrir();
              }
            }
          : undefined
      }
      aria-label={onAbrir ? `Ver los datos de ${fila.nombre}` : undefined}
      className={cn(
        onAbrir && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        esMia && 'bg-marcado hover:bg-accent',
      )}
    >
      <TableCell className="pl-0 text-right align-top">
        <span
          className={cn(
            'cifra text-2xl',
            esMia ? 'text-primary-text' : 'text-foreground',
          )}
        >
          {fila.position ?? '—'}
        </span>
      </TableCell>

      <TableCell className="whitespace-normal align-top">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words font-medium text-foreground">{fila.nombre}</span>
          {esMia ? (
            <Badge variant="outline" className="border-primary/50 text-primary-text">
              Tú
            </Badge>
          ) : null}
        </span>
        {/*
          Segunda línea solo en móvil: aquí caben los datos de las columnas que
          se ocultan, sin obligar a desplazarse en horizontal. Con su rótulo
          delante, no encadenados con puntos medios.
        */}
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground md:hidden">
          {/*
            EN MÓVIL EL CÓDIGO VA CON LA PALABRA «CLUB» DELANTE.

            En escritorio lo explica la cabecera de la columna («Club
            (código)»), pero en móvil esa columna no existe y el código salía
            desnudo en su renglón: se leía «SAMA-M» debajo del nombre sin nada
            que dijera qué era, y lo más parecido a un dato suelto es una
            errata. Con el rótulo delante se entiende sin la cabecera.
          */}
          {/*
            Club y año COMPARTEN RENGLÓN. El club llevaba `basis-full` de
            cuando se recortaba con puntos suspensivos, y con eso cada fila
            medía tres renglones: en espada masculina absoluta, la de 259
            filas, eran 250 px por tirador. Juntos caben de sobra —«Club
            CNE-NA   Nació en 2006» son unos 260 px a 12 px— y la fila baja a
            dos renglones.
          */}
          <span className="min-w-0">
            Club <CodigoClub codigo={fila.club} />
          </span>
          {fila.anioNacimiento ? (
            <span>
              Nació en <span className="cifra text-foreground">{fila.anioNacimiento}</span>
            </span>
          ) : null}
          {fila.position === null ? <span>Sin clasificar</span> : null}
        </span>
      </TableCell>

      <TableCell className="hidden whitespace-normal align-top text-muted-foreground md:table-cell">
        <CodigoClub codigo={fila.club} />
      </TableCell>

      <TableCell className="hidden text-right align-top tabular-nums md:table-cell">
        {fila.anioNacimiento ?? '—'}
      </TableCell>

      <TableCell className="pr-0 text-right align-top">
        <span className="cifra text-lg text-foreground">
          {fila.totalPoints === null ? '—' : puntos(fila.totalPoints)}
        </span>
      </TableCell>
    </TableRow>
  );
}
