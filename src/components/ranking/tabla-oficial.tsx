'use client';

import { ChevronRight, ExternalLink, Scissors } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  BreakdownEntry,
  FilaOficial,
  RankingGroupKey,
  RankingRowView,
  TablaOficial,
} from '@/lib/queries/ranking';
import type { CutoffStatus } from '@/lib/ranking/compute';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, cn, formatDateEs } from '@/lib/utils';
import { Desglose } from './desglose';
import { clave, etiquetaGrupo, puntos } from './formato';

type Grupo = RankingGroupKey & { tiradores: number };

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
 */
export function TablaRankingOficial({
  grupos,
  tablas,
  cortes,
  desgloses,
  internos,
  mios,
  grupoInicial,
}: {
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
}) {
  const [claveActual, setClaveActual] = React.useState(grupoInicial);
  const [abierto, setAbierto] = React.useState<string | null>(null);

  const grupo = grupos.find((g) => clave(g) === claveActual) ?? grupos[0];
  const tabla = tablas[clave(grupo)];
  const corteDelGrupo = cortes[clave(grupo)] ?? {};

  const armas = [...new Set(grupos.map((g) => g.weapon))];
  const generos = [
    ...new Set(grupos.filter((g) => g.weapon === grupo.weapon).map((g) => g.gender)),
  ];
  const categorias = grupos
    .filter((g) => g.weapon === grupo.weapon && g.gender === grupo.gender)
    .map((g) => g.category);

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

  return (
    <div className="flex flex-col gap-5">
      {/* Controles: una sola fila que envuelve. */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={grupo.weapon}
          onValueChange={(v) => v && elegir({ weapon: v as RankingGroupKey['weapon'] })}
          aria-label="Arma"
        >
          {armas.map((a) => (
            <ToggleGroupItem key={a} value={a}>
              {WEAPON_LABEL[a]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ToggleGroup
          type="single"
          variant="outline"
          value={grupo.gender}
          onValueChange={(v) => v && elegir({ gender: v as RankingGroupKey['gender'] })}
          aria-label="Género"
        >
          {generos.map((g) => (
            <ToggleGroupItem key={g} value={g}>
              {GENDER_LABEL[g]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Select
          value={grupo.category}
          onValueChange={(v) => elegir({ category: v as RankingGroupKey['category'] })}
        >
          <SelectTrigger className="w-40" aria-label="Categoría">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categorias.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/*
        Dónde estás tú, y a cuánto del corte.

        Es la única razón por la que un tirador abre esta pantalla, así que el
        puesto va en cifra de marcador: la tabla de abajo tiene doscientos
        números del mismo tamaño y, sin este contraste, el tuyo se pierde.
      */}
      {misFilas.map((fila) => (
        <button
          key={fila.id}
          type="button"
          onClick={() => setAbierto(fila.athleteId)}
          className="flex cursor-pointer items-start gap-4 rounded-lg border-t border-filete bg-card px-4 py-4 text-left transition-colors hover:bg-accent"
        >
          <span className="flex w-16 shrink-0 flex-col">
            <span className="cifra text-5xl text-primary-text sm:text-6xl">
              {fila.position ?? '—'}
            </span>
            <span className="mt-1 text-xs leading-tight text-muted-foreground">
              {fila.position ? 'tu puesto oficial' : 'sin clasificar todavía'}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-base font-medium">{fila.nombre}</span>
            <span className="medida text-sm text-muted-foreground">
              <Corte
                corte={fila.athleteId ? (corteDelGrupo[fila.athleteId] ?? null) : null}
                puntosTotales={fila.totalPoints}
                deCuantos={tabla.clasificados}
              />
            </span>
            <span className="mt-1 inline-flex items-center gap-1 text-sm text-primary-text">
              Ver tus datos y el cálculo
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </span>
          </span>
        </button>
      ))}

      {/* De dónde sale esta tabla y con qué normativa se lee. */}
      <p className="medida text-xs text-muted-foreground">
        Clasificación oficial de la RFEE, temporada {tabla.seasonLabel}, con{' '}
        <span className="cifra text-sm">{tabla.rows.length}</span> tiradores, de
        los que <span className="cifra text-sm">{tabla.clasificados}</span> tienen
        puesto.{' '}
        {tabla.actualizadoEl
          ? `Leída de la fuente el ${formatDateEs(tabla.actualizadoEl)}; no la calcula esta aplicación.`
          : 'No la calcula esta aplicación: se copia tal cual.'}
        {tabla.rule
          ? ` Según la normativa de la temporada salen ${plazas} plazas por ranking` +
            (tabla.rule.technicalPlaces > 0
              ? ` y ${tabla.rule.technicalPlaces} por criterio técnico.`
              : '.')
          : ''}
        {tabla.sourceUrl ? (
          <>
            {' '}
            <a
              href={tabla.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary-text underline underline-offset-4"
            >
              Ver la fuente
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          </>
        ) : null}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 pl-0 text-right">#</TableHead>
            <TableHead>Tirador</TableHead>
            <TableHead className="hidden md:table-cell">Club</TableHead>
            <TableHead className="hidden w-20 text-right md:table-cell">Nació</TableHead>
            <TableHead className="w-20 pr-0 text-right">Puntos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tabla.rows.map((fila) => (
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

      {conFicha < tabla.rows.length ? (
        <p className="medida text-xs text-muted-foreground">
          De estos {tabla.rows.length} tiradores,{' '}
          <span className="cifra text-sm">{tabla.rows.length - conFicha}</span> no
          tienen ficha en la aplicación, así que de ellos solo se sabe lo que
          publica la federación: ni plazos, ni inscripciones, ni el cálculo
          abierto. Se arregla de uno en uno, y cada alta es una fila menos.
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
                  {filaAbierta.club ? `. Club ${filaAbierta.club}` : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-6 px-4 pb-10">
                <Oficial
                  fila={filaAbierta}
                  temporada={tabla.seasonLabel}
                  deCuantos={tabla.clasificados}
                  corte={
                    filaAbierta.athleteId
                      ? (corteDelGrupo[filaAbierta.athleteId] ?? null)
                      : null
                  }
                  urlFuente={tabla.sourceUrl}
                />

                {/*
                  El cálculo interno, con su nombre puesto y debajo del oficial.
                  Nunca al lado sin etiqueta: son dos números distintos y
                  confundirlos sería peor que no enseñar ninguno.
                */}
                <div className="flex flex-col gap-3 border-t pt-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="text-lg">Cálculo de esta aplicación</h3>
                    <p className="text-xs text-muted-foreground">
                      No es el ranking de la federación
                    </p>
                  </div>

                  {filaAbierta.athleteId &&
                  desgloses[`${clave(grupo)}|${filaAbierta.athleteId}`] ? (
                    <Desglose
                      puesto={
                        internos[`${clave(grupo)}|${filaAbierta.athleteId}`]
                          ?.position ?? 0
                      }
                      total={
                        internos[`${clave(grupo)}|${filaAbierta.athleteId}`]
                          ?.totalPoints ?? 0
                      }
                      pruebas={desgloses[`${clave(grupo)}|${filaAbierta.athleteId}`]}
                      corte={null}
                      regla={tabla.rule}
                      esTuyo={
                        filaAbierta.athleteId !== null &&
                        mios.includes(filaAbierta.athleteId)
                      }
                    />
                  ) : (
                    <p className="medida text-sm text-muted-foreground">
                      Todavía no hay ningún resultado de esta temporada
                      emparejado con su licencia, así que no hay cálculo propio
                      que abrir. El puesto oficial de arriba no depende de esto:
                      lo publica la federación.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
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
        onAbrir && 'cursor-pointer',
        esMia && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <TableCell className="pl-0 text-right align-top">
        <span
          className={cn(
            'cifra text-xl',
            esMia ? 'text-primary-text' : 'text-foreground',
          )}
        >
          {fila.position ?? '—'}
        </span>
      </TableCell>

      <TableCell className="whitespace-normal align-top">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{fila.nombre}</span>
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
          <span className="min-w-0 basis-full truncate">
            {fila.club ?? 'sin club publicado'}
          </span>
          {fila.anioNacimiento ? (
            <span>
              Nació en <span className="cifra text-foreground">{fila.anioNacimiento}</span>
            </span>
          ) : null}
          {fila.position === null ? <span>Sin clasificar</span> : null}
        </span>
      </TableCell>

      <TableCell className="hidden max-w-48 truncate align-top text-muted-foreground md:table-cell">
        {fila.club ?? 'sin club'}
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
