'use client';

import { ChevronRight, Scissors, TrendingDown, TrendingUp } from 'lucide-react';
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
  RankingGroupKey,
  RankingRowView,
  RankingTableView,
} from '@/lib/queries/ranking';
import type { CutoffStatus } from '@/lib/ranking/compute';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, cn, formatDateEs } from '@/lib/utils';
import { Desglose } from './desglose';
import { clave, etiquetaGrupo, puntos } from './formato';

type Grupo = RankingGroupKey & { athletes: number };

/**
 * La tabla del ranking.
 *
 * Todo viene cargado del servidor en una sola pasada, igual que el
 * calendario: cambiar de arma o abrir el desglose de un tirador no puede
 * depender de la cobertura del pabellón.
 *
 * En móvil NO se hace scroll horizontal. Se enseñan las tres columnas que
 * contestan la pregunta —puesto, quién y cuántos puntos— y el resto (club,
 * pruebas contadas, variación) baja a una segunda línea dentro de la celda
 * del nombre. Una tabla de seis columnas a 390 px o se corta o se sale.
 */
export function TablaRanking({
  grupos,
  tablas,
  cortes,
  desgloses,
  mios,
  grupoInicial,
}: {
  grupos: Grupo[];
  tablas: Record<string, RankingTableView>;
  cortes: Record<string, Record<string, CutoffStatus>>;
  desgloses: Record<string, BreakdownEntry[]>;
  mios: string[];
  grupoInicial: string;
}) {
  const [claveActual, setClaveActual] = React.useState(grupoInicial);
  const [abierto, setAbierto] = React.useState<string | null>(null);

  const grupo = grupos.find((g) => clave(g) === claveActual) ?? grupos[0];
  const tabla = tablas[clave(grupo)];
  const corteDelGrupo = cortes[clave(grupo)] ?? {};

  const armas = [...new Set(grupos.map((g) => g.weapon))];
  const generos = [...new Set(grupos.filter((g) => g.weapon === grupo.weapon).map((g) => g.gender))];
  const categorias = grupos
    .filter((g) => g.weapon === grupo.weapon && g.gender === grupo.gender)
    .map((g) => g.category);

  /**
   * Al cambiar de arma se conservan género y categoría SI existen para la
   * nueva arma. Si no, se cae al primer grupo que sí exista: nunca se deja al
   * selector apuntando a una combinación sin datos.
   */
  function elegir(cambio: Partial<RankingGroupKey>) {
    const deseado = { ...grupo, ...cambio };
    const exacto = grupos.find((g) => clave(g) === clave(deseado));
    if (exacto) return setClaveActual(clave(exacto));

    const porArmaGenero = grupos.find(
      (g) => g.weapon === deseado.weapon && g.gender === deseado.gender,
    );
    const porArma = grupos.find((g) => g.weapon === deseado.weapon);
    const destino = porArmaGenero ?? porArma ?? grupos[0];
    setClaveActual(clave(destino));
  }

  // Tiradores de esta cuenta que aparecen en la tabla que se está mirando.
  // Pueden ser varios: una madre con dos hijas en la misma categoría.
  const misFilas = tabla.rows.filter((r) => mios.includes(r.athleteId));

  const filaAbierta = abierto ? tabla.rows.find((r) => r.athleteId === abierto) : null;

  const plazas = tabla.rule?.rankingPlaces ?? 0;
  const hayCorte = plazas > 0 && tabla.rows.length > plazas;

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

        Es la única razón por la que un tirador abre esta pantalla, así que
        el puesto va en cifra de marcador y no en una pastilla: la tabla que
        viene debajo tiene treinta números del mismo tamaño y, sin este
        contraste, el tuyo se pierde entre ellos.
      */}
      {misFilas.map((fila) => (
        <button
          key={fila.athleteId}
          type="button"
          onClick={() => setAbierto(fila.athleteId)}
          className="flex cursor-pointer items-start gap-4 rounded-lg border-t border-filete bg-card px-4 py-4 text-left transition-colors hover:bg-accent"
        >
          <span className="flex w-16 shrink-0 flex-col">
            <span className="cifra text-5xl text-primary-text sm:text-6xl">
              {fila.position}
            </span>
            <span className="mt-1 text-xs leading-tight text-muted-foreground">
              tu puesto
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-base font-medium">{fila.athleteName}</span>
            <span className="medida text-sm text-muted-foreground">
              <Corte
                corte={corteDelGrupo[fila.athleteId] ?? null}
                puntosTotales={fila.totalPoints}
              />
            </span>
            <span className="mt-1 inline-flex items-center gap-1 text-sm text-primary-text">
              Ver de dónde salen tus puntos
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </span>
          </span>
        </button>
      ))}

      {/* Cuándo se calculó y con qué normativa. */}
      <p className="text-xs text-muted-foreground">
        {tabla.computedAt
          ? `Calculado el ${formatDateEs(tabla.computedAt)}`
          : 'Sin fecha de cálculo'}
        {tabla.rule
          ? `. Cuentan las ${tabla.rule.countingEvents} mejores pruebas` +
            (plazas > 0 ? `, y salen ${plazas} plazas por ranking` : '')
          : '. Sin normativa configurada para esta categoría'}
        {tabla.rule && tabla.rule.technicalPlaces > 0
          ? ` y ${tabla.rule.technicalPlaces} por criterio técnico`
          : ''}
        .
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 pl-0 text-right">#</TableHead>
            <TableHead>Tirador</TableHead>
            <TableHead className="hidden md:table-cell">Club</TableHead>
            <TableHead className="hidden w-20 text-right md:table-cell">
              Variación
            </TableHead>
            <TableHead className="hidden w-20 text-right md:table-cell">Pruebas</TableHead>
            <TableHead className="w-20 pr-0 text-right">Puntos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tabla.rows.map((fila) => (
            <React.Fragment key={fila.athleteId}>
              <Fila
                fila={fila}
                esMia={mios.includes(fila.athleteId)}
                onAbrir={() => setAbierto(fila.athleteId)}
              />
              {hayCorte && fila.position === plazas ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="px-0 py-0">
                    <div className="flex items-center gap-2 border-y border-dashed border-gold/60 bg-gold/5 px-2 py-1.5 text-xs text-gold">
                      <Scissors className="size-3.5 shrink-0" aria-hidden />
                      <span className="whitespace-normal">
                        Corte de convocatoria: las {plazas} primeras plazas salen por
                        ranking
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
                <SheetTitle className="pr-10 text-xl">
                  {filaAbierta.athleteName}
                </SheetTitle>
                <SheetDescription className="pr-10">
                  {etiquetaGrupo(grupo)}
                  {filaAbierta.clubName ? `. ${filaAbierta.clubName}` : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-10">
                <Desglose
                  puesto={filaAbierta.position}
                  total={filaAbierta.totalPoints}
                  pruebas={desgloses[`${clave(grupo)}|${filaAbierta.athleteId}`] ?? []}
                  corte={corteDelGrupo[filaAbierta.athleteId] ?? null}
                  regla={tabla.rule}
                  esTuyo={mios.includes(filaAbierta.athleteId)}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Distancia al corte, en una línea.
 *
 * El texto largo y completo de `explanation` está en el desglose, que es
 * donde se va a discutir. Aquí se resume, porque repetir "Vas 6.º" al lado de
 * un 6.º de 36 px es decir dos veces lo mismo.
 */
function Corte({
  corte,
  puntosTotales,
}: {
  corte: CutoffStatus | null;
  puntosTotales: number;
}) {
  if (!corte || corte.rankingPlaces === 0) {
    return (
      <>
        {puntos(puntosTotales)} puntos. La normativa de la temporada no fija plazas
        por ranking en esta categoría, así que no se puede decir dónde está el corte.
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
        {puntos(puntosTotales)} puntos. Dentro de las {corte.rankingPlaces} plazas que
        salen por ranking.{tecnicas}
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
          y <span className="cifra text-sm text-foreground">
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
  fila: RankingRowView;
  esMia: boolean;
  onAbrir: () => void;
}) {
  return (
    <TableRow
      onClick={onAbrir}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAbrir();
        }
      }}
      aria-label={`Ver el cálculo de ${fila.athleteName}`}
      className={cn('cursor-pointer', esMia && 'bg-primary/10 hover:bg-primary/15')}
    >
      <TableCell className="pl-0 text-right align-top">
        <span
          className={cn('cifra text-xl', esMia ? 'text-primary-text' : 'text-foreground')}
        >
          {fila.position}
        </span>
      </TableCell>

      <TableCell className="whitespace-normal align-top">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{fila.athleteName}</span>
          {esMia ? (
            <Badge variant="outline" className="border-primary/50 text-primary-text">
              Tú
            </Badge>
          ) : null}
        </span>
        {/*
          Segunda línea solo en móvil: aquí caben los datos de las columnas
          que se ocultan, sin obligar a desplazarse en horizontal. Con su
          rótulo delante, no encadenados con puntos medios: «3 · +2» no dice
          si son pruebas, puestos o puntos.
        */}
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground md:hidden">
          <span className="min-w-0 basis-full truncate">
            {fila.clubName ?? 'Sin club'}
          </span>
          <span>
            <span className="cifra text-foreground">{fila.countedEvents}</span>{' '}
            {fila.countedEvents === 1 ? 'prueba contada' : 'pruebas contadas'}
          </span>
          {fila.change !== null && fila.change !== 0 ? (
            <span className={fila.change > 0 ? 'text-ok' : 'text-danger'}>
              {fila.change > 0 ? 'Sube' : 'Baja'}{' '}
              <span className="cifra">{Math.abs(fila.change)}</span>{' '}
              {Math.abs(fila.change) === 1 ? 'puesto' : 'puestos'}
            </span>
          ) : null}
        </span>
      </TableCell>

      <TableCell className="hidden max-w-48 truncate align-top text-muted-foreground md:table-cell">
        {fila.clubName ?? 'sin club'}
      </TableCell>

      <TableCell className="hidden text-right align-top md:table-cell">
        <Variacion valor={fila.change} />
      </TableCell>

      <TableCell className="hidden text-right align-top tabular-nums md:table-cell">
        {fila.countedEvents}
      </TableCell>

      <TableCell className="pr-0 text-right align-top">
        <span className="cifra text-lg text-foreground">{puntos(fila.totalPoints)}</span>
      </TableCell>
    </TableRow>
  );
}

/** Variación desde el cálculo anterior. Nunca solo color: lleva signo e icono. */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) {
    return (
      <span className="text-xs text-muted-foreground" title="Primer cálculo de la temporada">
        nuevo
      </span>
    );
  }
  if (valor === 0) return <span className="text-xs text-muted-foreground">=</span>;

  const sube = valor > 0;
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-end gap-1 text-xs',
        sube ? 'text-ok' : 'text-danger',
      )}
    >
      <Icono className="size-3.5" aria-hidden />
      {sube ? '+' : '−'}
      {Math.abs(valor)}
      <span className="sr-only">{sube ? 'puestos ganados' : 'puestos perdidos'}</span>
    </span>
  );
}
