'use client';

import { ArrowLeftRight, Plus, TriangleAlert, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { guardarConvocados } from '@/lib/callups/actions';
import type { SeleccionConvocado } from '@/lib/callups/actions';
import type {
  AthletePicker,
  CallUpAthleteRow,
  RankingPrueba,
} from '@/lib/callups/tipos';
import { cn, formatDateEs, titular } from '@/lib/utils';
import { cargarRankingDelEvento, cargarTiradores } from '@/app/(app)/convocatorias/actions';

type Elegido = SeleccionConvocado & { nombre: string; prueba: string };

function clave(a: { athleteId: string; eventCompetitionId: string | null }): string {
  return `${a.athleteId}|${a.eventCompetitionId ?? ''}`;
}

/**
 * Quién va a la competición.
 *
 * Dos caminos, porque hay dos tipos de plaza y no se deciden igual: las de
 * ranking salen de la clasificación y se marcan sobre ella; las técnicas las
 * elige el seleccionador y se buscan a mano. Mezclarlas en una sola lista
 * borraría la diferencia, que es justo lo que luego hay que poder explicar.
 *
 * Si no hay ranking calculado para una prueba NO se inventa un orden: se dice
 * y se pasa a elección manual.
 */
export function ElegirConvocados({
  callUpId,
  eventId,
  eventName,
  yaConvocados,
}: {
  callUpId: string;
  eventId: string;
  eventName: string;
  yaConvocados: CallUpAthleteRow[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = React.useState(false);
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pruebas, setPruebas] = React.useState<RankingPrueba[]>([]);
  const [tiradores, setTiradores] = React.useState<AthletePicker[]>([]);
  const [guardando, setGuardando] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);

  const [elegidos, setElegidos] = React.useState<Map<string, Elegido>>(() =>
    inicial(yaConvocados),
  );

  /**
   * La carga se dispara una sola vez, al abrir la hoja.
   *
   * El guardia va en una `ref` y no en el estado a propósito: con
   * `cargando` en las dependencias, el propio `setCargando(true)` volvía a
   * lanzar el efecto, la limpieza del anterior cancelaba la respuesta y la
   * hoja se quedaba en "Cargando la clasificación…" para siempre.
   */
  const pedido = React.useRef(false);

  React.useEffect(() => {
    if (!abierto || pedido.current) return;

    pedido.current = true;
    setCargando(true);
    setError(null);

    void Promise.all([cargarRankingDelEvento(eventId), cargarTiradores()]).then(
      ([ranking, gente]) => {
        setCargando(false);
        if (!ranking.ok) return setError(ranking.error);
        if (!gente.ok) return setError(gente.error);
        setPruebas(ranking.datos.pruebas);
        setTiradores(gente.datos);
      },
      () => {
        setCargando(false);
        setError('No se pudo cargar la clasificación. Cierra y vuelve a abrir.');
      },
    );
  }, [abierto, eventId]);

  function alternar(e: Elegido) {
    setElegidos((previo) => {
      const copia = new Map(previo);
      const k = clave(e);
      if (copia.has(k)) copia.delete(k);
      else copia.set(k, e);
      return copia;
    });
  }

  function cambiarTipo(k: string) {
    setElegidos((previo) => {
      const copia = new Map(previo);
      const actual = copia.get(k);
      if (!actual) return previo;
      copia.set(k, {
        ...actual,
        placeType: actual.placeType === 'ranking' ? 'tecnica' : 'ranking',
        // Una plaza técnica no tiene puesto de ranking asociado: dejarlo
        // puesto haría creer que se la ganó en la pista.
        rankingPositionAtCutoff:
          actual.placeType === 'ranking' ? null : actual.rankingPositionAtCutoff,
      });
      return copia;
    });
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const r = await guardarConvocados(
      callUpId,
      [...elegidos.values()].map((e) => ({
        athleteId: e.athleteId,
        eventCompetitionId: e.eventCompetitionId,
        placeType: e.placeType,
        rankingPositionAtCutoff: e.rankingPositionAtCutoff,
      })),
    );
    setGuardando(false);
    setAviso(r.ok ? r.message : r.error);
    if (r.ok) router.refresh();
  }

  const lista = [...elegidos.entries()];
  const sinNingunRanking =
    pruebas.length > 0 && pruebas.every((p) => p.candidatos === null);

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer">
          <Users aria-hidden />
          {yaConvocados.length > 0 ? 'Cambiar convocados' : 'Elegir convocados'}
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="pr-10">{titular(eventName)}</SheetTitle>
          <SheetDescription className="medida pr-10">
            Marca las plazas de ranking sobre la clasificación y añade a mano las
            de criterio técnico. Nadie recibe ningún aviso hasta que publiques.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-10">
          {/* Lo elegido, siempre a la vista: es la lista que se va a guardar. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="cifra text-2xl">{lista.length}</span>
              <span className="text-sm text-muted-foreground">
                {lista.length === 1 ? 'convocado' : 'convocados'}
              </span>
            </div>

            {lista.length === 0 ? (
              <p className="medida text-sm text-muted-foreground">
                Todavía no has elegido a nadie. Marca abajo a quien va por ranking o
                busca a quien va por criterio técnico.
              </p>
            ) : (
              <ul className="flex flex-col">
                {lista.map(([k, e]) => (
                  <li
                    key={k}
                    className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{e.nombre}</span>
                      <span className="block text-xs text-muted-foreground">
                        {e.prueba}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Badge
                        variant="outline"
                        className={
                          e.placeType === 'ranking'
                            ? 'border-gold/50 text-gold'
                            : undefined
                        }
                      >
                        {e.placeType === 'ranking'
                          ? `Ranking${e.rankingPositionAtCutoff ? ` · ${e.rankingPositionAtCutoff}.º` : ''}`
                          : 'Técnica'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="cursor-pointer"
                        onClick={() => cambiarTipo(k)}
                        aria-label={`Cambiar el tipo de plaza de ${e.nombre}`}
                      >
                        <ArrowLeftRight aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="cursor-pointer"
                        onClick={() => alternar(e)}
                        aria-label={`Quitar a ${e.nombre}`}
                      >
                        <X aria-hidden />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          {cargando ? (
            <p className="text-sm text-muted-foreground">Cargando la clasificación…</p>
          ) : null}

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          {/* Si NINGUNA prueba tiene ranking, el aviso se da una vez: repetirlo
              ocho veces es ruido y acaba no leyéndose. */}
          {sinNingunRanking ? (
            <p className="medida flex items-start gap-2 rounded-md border border-warn/40 px-3 py-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              No hay ranking calculado para ninguna prueba de esta competición, así
              que no se puede proponer un orden. Elige a mano a quién convocas: las
              plazas quedarán marcadas como de criterio técnico.
            </p>
          ) : null}

          {pruebas.map((p) => (
            <Prueba
              key={p.eventCompetitionId}
              prueba={p}
              tiradores={tiradores}
              elegidos={elegidos}
              onAlternar={alternar}
              avisoAparte={sinNingunRanking}
            />
          ))}

          {!cargando && !error && pruebas.length === 0 ? (
            <p className="medida text-sm text-muted-foreground">
              Esta competición no tiene pruebas cargadas en el calendario, así que no
              se puede decir a qué se convoca. Revisa la ficha del evento.
            </p>
          ) : null}

          {aviso ? (
            <p className="text-sm text-muted-foreground" role="status">
              {aviso}
            </p>
          ) : null}

          <Button onClick={guardar} disabled={guardando} className="cursor-pointer">
            {guardando ? 'Guardando…' : 'Guardar la lista'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Prueba({
  prueba,
  tiradores,
  elegidos,
  onAlternar,
  avisoAparte,
}: {
  prueba: RankingPrueba;
  tiradores: AthletePicker[];
  elegidos: Map<string, Elegido>;
  onAlternar: (e: Elegido) => void;
  /** El aviso de "no hay ranking" ya se ha dado arriba para todas. */
  avisoAparte: boolean;
}) {
  const [buscador, setBuscador] = React.useState(false);
  const plazas = prueba.rankingPlaces ?? 0;

  // Se enseñan las plazas de ranking más un margen: el corte se discute
  // justo en la frontera, y sin ver a los siguientes no se puede valorar.
  const visibles = prueba.candidatos?.slice(0, Math.max(plazas + 5, 12)) ?? [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base">{prueba.label}</h3>
        <p className="text-xs text-muted-foreground">
          {plazas > 0 ? `${plazas} plazas por ranking` : 'sin plazas configuradas'}
          {prueba.technicalPlaces ? ` · ${prueba.technicalPlaces} técnicas` : ''}
          {prueba.computedAt ? ` · ranking del ${formatDateEs(prueba.computedAt)}` : ''}
        </p>
      </div>

      {prueba.candidatos === null ? (
        avisoAparte ? null : (
          <p className="medida flex items-start gap-2 rounded-md border border-warn/40 px-3 py-2 text-sm text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            No hay ranking calculado para esta prueba, así que no se puede proponer
            un orden. Elige a mano a quién convocas; las plazas quedarán marcadas
            como de criterio técnico.
          </p>
        )
      ) : (
        <ul className="flex flex-col">
          {visibles.map((c) => {
            const elegido: Elegido = {
              athleteId: c.athleteId,
              eventCompetitionId: prueba.eventCompetitionId,
              placeType: 'ranking',
              rankingPositionAtCutoff: c.position,
              nombre: c.athleteName,
              prueba: prueba.label,
            };
            const marcado = elegidos.has(clave(elegido));

            return (
              <li key={c.athleteId}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 border-b py-2 transition-colors hover:bg-muted/40',
                    plazas > 0 && c.position > plazas && 'text-muted-foreground',
                  )}
                >
                  <Checkbox
                    checked={marcado}
                    onCheckedChange={() => onAlternar(elegido)}
                  />
                  <span className="cifra w-6 shrink-0 text-right text-lg">
                    {c.position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">
                      {c.athleteName}
                    </span>
                    {c.clubName ? (
                      <span className="block text-xs text-muted-foreground">
                        {c.clubName}
                      </span>
                    ) : null}
                  </span>
                  <span className="cifra shrink-0 text-sm text-muted-foreground">
                    {c.totalPoints}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {/* Plaza técnica: cualquiera de la lista de tiradores activos. */}
      <Popover open={buscador} onOpenChange={setBuscador}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit cursor-pointer">
            <Plus aria-hidden />
            Añadir por criterio técnico
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput placeholder="Apellidos del tirador…" />
            <CommandList>
              <CommandEmpty>Ningún tirador activo con ese nombre.</CommandEmpty>
              <CommandGroup>
                {tiradores.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.name} ${t.rfeeLicense ?? ''}`}
                    className="cursor-pointer"
                    onSelect={() => {
                      onAlternar({
                        athleteId: t.id,
                        eventCompetitionId: prueba.eventCompetitionId,
                        placeType: 'tecnica',
                        rankingPositionAtCutoff: null,
                        nombre: t.name,
                        prueba: prueba.label,
                      });
                      setBuscador(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[t.clubName, t.rfeeLicense].filter(Boolean).join(' · ') ||
                          'sin club ni licencia'}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </section>
  );
}

function inicial(filas: CallUpAthleteRow[]): Map<string, Elegido> {
  return new Map(
    filas.map((f) => [
      clave({ athleteId: f.athleteId, eventCompetitionId: f.eventCompetitionId }),
      {
        athleteId: f.athleteId,
        eventCompetitionId: f.eventCompetitionId,
        placeType: f.placeType,
        rankingPositionAtCutoff: f.rankingPositionAtCutoff,
        nombre: f.athleteName,
        prueba: f.competition ?? 'prueba sin especificar',
      },
    ]),
  );
}
