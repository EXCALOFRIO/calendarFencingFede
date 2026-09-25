'use client';

import { ChevronDown, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { Vacio } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Weapon } from '@/lib/auth/session';
import {
  CATEGORY_LABEL,
  WEAPON_LABEL,
  cn,
  formatDateEs,
  titular,
} from '@/lib/utils';
import type { TiradorVista } from './tipos';

/**
 * La pantalla del seleccionador.
 *
 * Responde a una pregunta muy concreta: cuáles de mis tiradores van a cada
 * competición, y cómo van. Por eso hay DOS vistas de los mismos datos y no
 * dos pantallas: «por tirador» para preparar una conversación con alguien, y
 * «por competición» para preparar un viaje. Girar la lista es un clic, no
 * volver a navegar.
 *
 * El filtro por arma empieza en la del seleccionador porque es lo suyo, pero
 * puede ver el resto: no se le esconde nada a nadie.
 */

const ARMAS: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];
const TODAS = '__todas__';

/**
 * Concordancia de género al hablar de UNA persona concreta.
 *
 * Media selección española es femenina, así que «nacido en 1999» debajo del
 * nombre de una tiradora canta. El dato ya está en la ficha (`gender`), o sea
 * que la concordancia sale gratis. Cuando no se sabe —o la ficha es mixta— se
 * usa una fórmula que no marca género en vez de elegir uno por defecto.
 */
function nacimiento(genero: 'M' | 'F' | 'MIXTO', fechaIso: string): string {
  const anio = fechaIso.slice(0, 4);
  if (genero === 'F') return `nacida en ${anio}`;
  if (genero === 'M') return `nacido en ${anio}`;
  return `nacimiento: ${anio}`;
}

export function PanelTiradores({
  tiradores,
  armasPropias,
  esAdmin,
}: {
  tiradores: TiradorVista[];
  armasPropias: Weapon[];
  esAdmin: boolean;
}) {
  const [vista, setVista] = React.useState<'tiradores' | 'competiciones'>('tiradores');
  const [arma, setArma] = React.useState<string>(
    armasPropias.length === 1 ? armasPropias[0] : TODAS,
  );
  const [busqueda, setBusqueda] = React.useState('');

  const porArma = React.useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const t of tiradores) {
      for (const a of t.weapons) cuenta.set(a, (cuenta.get(a) ?? 0) + 1);
    }
    return cuenta;
  }, [tiradores]);

  const visibles = React.useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return tiradores.filter((t) => {
      if (arma !== TODAS && !t.weapons.includes(arma as Weapon)) return false;
      if (!texto) return true;
      return (
        t.fullName.toLowerCase().includes(texto) ||
        (t.clubName ?? '').toLowerCase().includes(texto)
      );
    });
  }, [tiradores, arma, busqueda]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={vista}
          onValueChange={(v) => v && setVista(v as 'tiradores' | 'competiciones')}
          variant="outline"
          size="sm"
          spacing={1}
        >
          <ToggleGroupItem value="tiradores">Por tirador</ToggleGroupItem>
          <ToggleGroupItem value="competiciones">Por competición</ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          type="single"
          value={arma}
          onValueChange={(v) => v && setArma(v)}
          variant="outline"
          size="sm"
          spacing={1}
          className="max-w-full flex-wrap"
        >
          <ToggleGroupItem value={TODAS} className="gap-1.5">
            Todas
            <span className="cifra text-xs text-muted-foreground">
              {tiradores.length}
            </span>
          </ToggleGroupItem>
          {ARMAS.map((a) => (
            <ToggleGroupItem key={a} value={a} className="gap-1.5">
              {WEAPON_LABEL[a]}
              <span className="cifra text-xs text-muted-foreground">
                {porArma.get(a) ?? 0}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar tirador o club"
          className="h-8 w-full sm:w-56"
          aria-label="Buscar tirador"
        />
      </div>

      {visibles.length === 0 ? (
        <Vacio
          titulo="Nadie coincide con este filtro"
          explicacion={
            busqueda
              ? `Nadie coincide con «${busqueda}» en ${arma === TODAS ? 'ninguna arma' : WEAPON_LABEL[arma as Weapon].toLowerCase()}. Prueba con «Todas».`
              : esAdmin
                ? 'Todavía no hay ninguna ficha de esa arma. Las fichas se crean en Gestión › Usuarios.'
                : 'Todavía no hay ninguna ficha de esa arma. Pídeselo a la dirección técnica.'
          }
        />
      ) : vista === 'tiradores' ? (
        <ListaTiradores tiradores={visibles} />
      ) : (
        <ListaCompeticiones tiradores={visibles} />
      )}
    </div>
  );
}

// ------------------------------------------------------- por tirador ---

function ListaTiradores({ tiradores }: { tiradores: TiradorVista[] }) {
  /**
   * Si nadie tiene puesto todavía, la columna del ranking desaparece.
   *
   * Repetir «— sin ranking» una vez por tirador gastaba un tercio del ancho
   * de un móvil para no decir nada. Se dice una vez, arriba, y se recupera el
   * sitio para lo que sí hay.
   */
  const hayRanking = tiradores.some((t) => t.ranking.length > 0);

  return (
    <div className="flex flex-col gap-2">
      {!hayRanking ? (
        <p className="text-xs text-muted-foreground">
          El ranking de la temporada todavía no se ha calculado, así que aquí no hay
          puestos que enseñar.
        </p>
      ) : null}

      {/*
        Bandas separadas por un filete, no una tarjeta por tirador.

        Con cien fichas, cien recuadros idénticos no jerarquizan nada: lo que
        ordena la lista es el puesto en el ranking, y para que se lea hace
        falta que sea la única cifra grande de cada banda.
      */}
      <ul className="flex flex-col divide-y border-t">
        {tiradores.map((t) => (
        <li key={t.id} className="min-w-0">
          <Collapsible>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3.5">
              {/* Puesto en el ranking: la cifra que de verdad ordena. */}
              {hayRanking ? (
                <div className="flex w-14 shrink-0 flex-col">
                  {t.ranking.length > 0 ? (
                    <>
                      <span className="cifra text-4xl">{t.ranking[0].position}</span>
                      <span className="mt-0.5 text-xs leading-tight text-muted-foreground">
                        en{' '}
                        {CATEGORY_LABEL[
                          t.ranking[0].category as keyof typeof CATEGORY_LABEL
                        ] ?? t.ranking[0].category}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="cifra text-4xl text-muted-foreground">—</span>
                      <span className="mt-0.5 text-xs leading-tight text-muted-foreground">
                        sin puesto
                      </span>
                    </>
                  )}
                </div>
              ) : null}

              <div className="flex min-w-44 flex-1 flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{t.fullName}</span>
                  {t.weapons.map((a) => (
                    <Badge key={a} variant="secondary" className="font-normal">
                      {WEAPON_LABEL[a]}
                    </Badge>
                  ))}
                  {t.category ? (
                    <Badge variant="outline" className="font-normal">
                      {CATEGORY_LABEL[t.category as keyof typeof CATEGORY_LABEL] ??
                        t.category}
                    </Badge>
                  ) : null}
                </span>

                {/* Cada dato con su rótulo, no encadenados con puntos. */}
                <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{t.clubName ?? 'Sin club en su ficha'}</span>
                  {t.rfeeLicense ? (
                    <span>
                      Licencia{' '}
                      <span className="text-foreground">{t.rfeeLicense}</span>
                    </span>
                  ) : null}
                  <span>{nacimiento(t.gender, t.birthDate)}</span>
                </span>

                <EstadoInscripciones tirador={t} />

                {t.warnings.length > 0 ? (
                  <span className="flex flex-wrap items-start gap-x-2 gap-y-1 text-xs text-warn">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="flex flex-col gap-0.5">
                      {t.warnings.map((aviso) => (
                        <span key={aviso}>{aviso}</span>
                      ))}
                    </span>
                  </span>
                ) : null}
              </div>

              {/* En móvil la cuenta y el botón comparten una línea propia; en
                  escritorio se alinean a la derecha de la ficha. */}
              <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <span className="flex items-baseline gap-1.5 sm:flex-col sm:items-end sm:gap-0.5">
                  <span className="cifra text-3xl">
                    {t.upcoming.length + t.enClub.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    próximas competiciones
                  </span>
                </span>

                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/det ms-auto shrink-0 text-xs text-muted-foreground sm:ms-0"
                  >
                    <ChevronDown className="transition-transform group-data-[state=open]/det:rotate-180" />
                    Detalle
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>

            <CollapsibleContent>
              <div className="grid gap-4 border-t border-filete bg-card px-3 py-3 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="text-sm">A dónde va</h3>
                  {t.upcoming.length === 0 && t.enClub.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No tiene ninguna inscripción viva. Si debería ir a algo, su club
                      todavía no lo ha pedido.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {t.upcoming.map((u) => (
                        <li
                          key={`${u.eventId}-${u.weapon}-${u.category}`}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {formatDateEs(u.date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {titular(u.name)}
                          </span>
                          <span className="text-muted-foreground">
                            {WEAPON_LABEL[u.weapon]}{' '}
                            {CATEGORY_LABEL[u.category as keyof typeof CATEGORY_LABEL] ??
                              u.category}
                          </span>
                        </li>
                      ))}
                      {t.enClub.map((u) => (
                        <li
                          key={`club-${u.eventId}-${u.weapon}-${u.category}`}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {formatDateEs(u.date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {titular(u.name)}
                          </span>
                          <span className="text-warn">pendiente en su club</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="text-sm">Últimos resultados</h3>
                  {t.recentResults.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Todavía no hay resultados suyos emparejados. Si ha competido,
                      pueden estar esperando en Gestión › Emparejar.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {t.recentResults.map((r, i) => (
                        <li
                          key={`${r.eventName}-${r.date}-${i}`}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                        >
                          <span className="cifra w-6 text-sm">{r.position}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {titular(r.eventName)}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDateEs(r.date)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.resultCount > t.recentResults.length ? (
                    <p className="text-xs text-muted-foreground">
                      {t.resultCount} resultados en total
                      {t.bestPosition !== null
                        ? `, mejor puesto ${t.bestPosition}`
                        : ''}
                      .
                    </p>
                  ) : null}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </li>
        ))}
      </ul>
    </div>
  );
}

function EstadoInscripciones({ tirador }: { tirador: TiradorVista }) {
  const enMarcha = tirador.upcoming.length;
  const esperando = tirador.enClub.length;

  if (enMarcha === 0 && esperando === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Sin inscripciones vivas ahora mismo.
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-0.5 text-xs">
      <span className="flex flex-wrap items-center gap-x-2">
        {enMarcha > 0 ? (
          <span className="text-ok">
            {enMarcha} {enMarcha === 1 ? 'inscripción' : 'inscripciones'} en marcha
          </span>
        ) : null}
        {esperando > 0 ? (
          <span className="text-warn">
            {esperando} {esperando === 1 ? 'esperando' : 'esperando'} al club
          </span>
        ) : null}
      </span>
      {tirador.nextEvent ? (
        <span className="text-muted-foreground">
          La próxima: {titular(tirador.nextEvent.name)}, el{' '}
          {formatDateEs(tirador.nextEvent.date)}
        </span>
      ) : null}
    </span>
  );
}

// --------------------------------------------------- por competición ---

type FilaCompeticion = {
  eventId: string;
  nombre: string;
  fecha: string;
  ciudad: string | null;
  asistentes: {
    id: string;
    nombre: string;
    weapon: Weapon;
    category: string;
    estado: 'en_marcha' | 'en_club';
    avisos: string[];
  }[];
};

function ListaCompeticiones({ tiradores }: { tiradores: TiradorVista[] }) {
  const grupos = React.useMemo<FilaCompeticion[]>(() => {
    const mapa = new Map<string, FilaCompeticion>();

    const anotar = (
      evento: { eventId: string; name: string; date: string; city: string | null },
      asistente: FilaCompeticion['asistentes'][number],
    ) => {
      const actual = mapa.get(evento.eventId);
      if (actual) {
        actual.asistentes.push(asistente);
        return;
      }
      mapa.set(evento.eventId, {
        eventId: evento.eventId,
        nombre: evento.name,
        fecha: evento.date,
        ciudad: evento.city,
        asistentes: [asistente],
      });
    };

    for (const t of tiradores) {
      for (const u of t.upcoming) {
        anotar(u, {
          id: t.id,
          nombre: t.fullName,
          weapon: u.weapon,
          category: u.category,
          estado: 'en_marcha',
          avisos: t.warnings,
        });
      }
      for (const u of t.enClub) {
        anotar(u, {
          id: t.id,
          nombre: t.fullName,
          weapon: u.weapon,
          category: u.category,
          estado: 'en_club',
          avisos: t.warnings,
        });
      }
    }

    return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [tiradores]);

  if (grupos.length === 0) {
    return (
      <Vacio
        titulo="Todavía no va nadie a ninguna competición"
        explicacion="En cuanto sus clubes soliciten inscripciones para competiciones futuras, aparecerán aquí agrupadas por competición."
      />
    );
  }

  const hoy = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

  return (
    <ul className="flex flex-col gap-3">
      {grupos.map((g) => {
        const dias = Math.round(
          (Date.parse(`${g.fecha}T00:00:00Z`) - hoy) / 86_400_000,
        );
        return (
          <li key={g.eventId} className="min-w-0 rounded-lg border-t border-filete bg-card">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-3">
              {/* Un «0 días» repetido cinco veces se lee como un fallo de
                  cálculo. Cuando la competición es hoy, se dice hoy. */}
              {dias <= 0 ? (
                <span className="cifra text-2xl text-primary-text">Hoy</span>
              ) : (
                <>
                  <span className="cifra text-3xl">{dias}</span>
                  <span className="text-xs text-muted-foreground">
                    {dias === 1 ? 'día' : 'días'}
                  </span>
                </>
              )}
              <h2 className="min-w-0 flex-1 text-base">{titular(g.nombre)}</h2>
              <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                <span>{formatDateEs(g.fecha)}</span>
                {g.ciudad ? <span>{g.ciudad}</span> : null}
                <span>
                  <span className="cifra text-foreground">
                    {g.asistentes.length}
                  </span>{' '}
                  {g.asistentes.length === 1 ? 'inscripción' : 'inscripciones'}
                </span>
              </span>
            </div>

            <ul className="divide-y">
              {g.asistentes.map((a, i) => (
                <li
                  key={`${a.id}-${a.weapon}-${a.category}-${i}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                >
                  <span className="min-w-32 flex-1 truncate text-sm">{a.nombre}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {WEAPON_LABEL[a.weapon]}{' '}
                    {CATEGORY_LABEL[a.category as keyof typeof CATEGORY_LABEL] ??
                      a.category}
                  </span>
                  {a.avisos.length > 0 ? (
                    <span
                      className="flex shrink-0 items-center gap-1 text-xs text-warn"
                      title={a.avisos.join('. ')}
                    >
                      <TriangleAlert className="size-3.5" aria-hidden />
                      {a.avisos.length === 1 ? a.avisos[0] : `${a.avisos.length} avisos`}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium',
                      a.estado === 'en_marcha' ? 'text-ok' : 'text-warn',
                    )}
                  >
                    {a.estado === 'en_marcha' ? 'Inscripción en marcha' : 'Pendiente en su club'}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
