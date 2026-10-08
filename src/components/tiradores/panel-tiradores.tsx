'use client';

import { ChevronDown, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { Buscador } from '@/components/admin/buscador';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { Pastilla } from '@/components/sistema/pastilla';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { Weapon } from '@/lib/auth/session';
import { ARMAS, armasDeArranque, type PerfilAmbito } from '@/lib/ambito';
import { diasEntre, fechaCorta, hoyMadrid } from '@/lib/fechas';
import { rotuloArma, rotuloCategoria, rotuloPrueba } from '@/lib/sport/rotulos';
import { cn, titular } from '@/lib/utils';
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
 *
 * Se marcan VARIAS armas a la vez, igual que en el calendario. Antes era de
 * una sola, y un seleccionador que lleve florete y espada —los hay— no tenía
 * forma de pedir sus dos armas: le arrancaba en «Todas», o sea con los
 * tiradores de sable de otro dentro de su lista.
 */

/**
 * Concordancia de género al hablar de UNA persona concreta.
 *
 * Media selección española es femenina, así que «nacido en 1999» debajo del
 * nombre de una tiradora canta. El dato ya está en la ficha (`gender`), o sea
 * que la concordancia sale gratis. Cuando no se sabe —o la ficha es mixta— se
 * usa una fórmula que no marca género en vez de elegir uno por defecto.
 */
/** «florete», «florete y espada», «florete, espada y sable». */
function nombresDeArmas(armas: Weapon[]): string {
  const nombres = armas.map((a) => rotuloArma(a).toLowerCase());
  if (nombres.length <= 1) return nombres[0] ?? 'ninguna arma';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

function nacimiento(genero: 'M' | 'F' | 'MIXTO', fechaIso: string): string {
  const anio = fechaIso.slice(0, 4);
  if (genero === 'F') return `nacida en ${anio}`;
  if (genero === 'M') return `nacido en ${anio}`;
  return `nacimiento: ${anio}`;
}

export function PanelTiradores({
  tiradores,
  perfil,
  esAdmin,
}: {
  tiradores: TiradorVista[];
  /** Papel y armas: deciden con qué armas arranca la lista. */
  perfil: PerfilAmbito;
  esAdmin: boolean;
}) {
  const [vista, setVista] = React.useState<'tiradores' | 'competiciones'>('tiradores');
  const [armas, setArmas] = React.useState<Weapon[]>(() => armasDeArranque(perfil));
  const [busqueda, setBusqueda] = React.useState('');

  const todasPuestas = armas.length === ARMAS.length;

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
      if (!t.weapons.some((a) => armas.includes(a as Weapon))) return false;
      if (!texto) return true;
      return (
        t.fullName.toLowerCase().includes(texto) ||
        (t.clubName ?? '').toLowerCase().includes(texto)
      );
    });
  }, [tiradores, armas, busqueda]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorSegmentado
          etiqueta="Vista"
          tamano="sm"
          anchoMinimo={8}
          valor={vista}
          onCambio={(v) => setVista(v as 'tiradores' | 'competiciones')}
          opciones={[
            { valor: 'tiradores', etiqueta: 'Por tirador' },
            { valor: 'competiciones', etiqueta: 'Por competición' },
          ]}
          className="w-full sm:w-80"
        />

        {/* Nunca se queda vacío: una lista en blanco no responde a nada. */}
        <FilaChips etiqueta="Armas">
          {ARMAS.map((a) => {
            const marcada = armas.includes(a);
            return (
              <ChipFiltro
                key={a}
                marcado={marcada}
                contador={porArma.get(a) ?? 0}
                onClick={() => {
                  const siguiente = marcada ? armas.filter((x) => x !== a) : [...armas, a];
                  if (siguiente.length > 0) setArmas(ARMAS.filter((x) => siguiente.includes(x)));
                }}
              >
                {rotuloArma(a)}
              </ChipFiltro>
            );
          })}
        </FilaChips>


        {/*
          Con las tres marcadas no hace falta ofrecer «todas»: ya lo están.
          El botón es el camino de vuelta para el seleccionador, que arranca
          en la suya.
        */}
        {!todasPuestas ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => setArmas([...ARMAS])}
          >
            Ver las tres armas
            <span className="cifra ml-2 text-xs text-muted-foreground">
              {tiradores.length}
            </span>
          </Button>
        ) : null}

        {/*
          El buscador es un ICONO en el móvil. Ver `components/admin/buscador`:
          en 393 px no cabe al lado de las tres armas y se llevaba un renglón
          entero para algo que se usa de vez en cuando.
        */}
        <Buscador
          valor={busqueda}
          onCambio={setBusqueda}
          etiqueta="Buscar tirador o club"
          marcador="Buscar tirador"
        />
      </div>

      {visibles.length === 0 ? (
        <EstadoVacio
          titulo="Nadie coincide con este filtro"
          descripcion={

            busqueda
              ? `Nadie coincide con «${busqueda}» en ${nombresDeArmas(armas)}. ` +
                'Prueba con las tres armas o con otro nombre.'
              : esAdmin
                ? `Todavía no hay ninguna ficha de ${nombresDeArmas(armas)}. Las fichas se crean en Gestión › Usuarios.`
                : `Todavía no hay ninguna ficha de ${nombresDeArmas(armas)}. Pídeselo a la dirección técnica.`
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
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-4">
              {/* Puesto en el ranking: la cifra que de verdad ordena. */}
              {hayRanking ? (
                <div className="flex w-14 shrink-0 flex-col">
                  {t.ranking.length > 0 ? (
                    <>
                      <span className="cifra text-3xl">{t.ranking[0].position}</span>
                      <span className="mt-1 text-xs leading-tight text-muted-foreground">
                        en {rotuloCategoria(t.ranking[0].category) || t.ranking[0].category}
                      </span>

                    </>
                  ) : (
                    <>
                      <span className="cifra text-3xl text-muted-foreground">—</span>
                      <span className="mt-1 text-xs
 leading-tight text-muted-foreground">
                        sin puesto
                      </span>
                    </>
                  )}
                </div>
              ) : null}

              <div className="flex min-w-44 flex-1 flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{t.fullName}</span>
                  {t.weapons.map((a) => (
                    <Pastilla key={a}>{rotuloArma(a)}</Pastilla>
                  ))}
                  {t.category ? <Pastilla>{rotuloCategoria(t.category) || t.category}</Pastilla> : null}

                </span>

                {/* Cada dato con su rótulo, no encadenados con puntos. */}
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                    <TriangleAlert className="mt-1 size-3.5 shrink-0" aria-hidden />
                    <span className="flex flex-col gap-1">

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
                <span className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-1">
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
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-sm">A dónde va</h3>
                  {t.upcoming.length === 0 && t.enClub.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No tiene ninguna inscripción viva. Si debería ir a algo,
                      todavía no se ha pedido.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {t.upcoming.map((u) => (
                        <li
                          key={`${u.eventId}-${u.weapon}-${u.category}`}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {fechaCorta(u.date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {titular(u.name)}
                          </span>
                          <span className="text-muted-foreground">
                            {rotuloPrueba({ arma: u.weapon, categoria: u.category })}
                          </span>

                        </li>
                      ))}
                      {t.enClub.map((u) => (
                        <li
                          key={`club-${u.eventId}-${u.weapon}-${u.category}`}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {fechaCorta(u.date)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {titular(u.name)}
                          </span>
                          <span className="text-warn">sin confirmar</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-2">
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
                            {fechaCorta(r.date)}
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
    <span className="flex flex-col gap-1 text-xs">
      <span className="flex flex-wrap items-center gap-x-2">
        {enMarcha > 0 ? (
          <span className="text-ok">
            {enMarcha} {enMarcha === 1 ? 'inscripción' : 'inscripciones'} en marcha
          </span>
        ) : null}
        {esperando > 0 ? (
          <span className="text-warn">
            {esperando} sin confirmar
          </span>
        ) : null}
      </span>
      {tirador.nextEvent ? (
        <span className="text-muted-foreground">
          La próxima: {titular(tirador.nextEvent.name)}, el{' '}
          {fechaCorta(tirador.nextEvent.date)}
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
      <EstadoVacio
        titulo="Todavía no va nadie a ninguna competición"
        descripcion=
"En cuanto se pida una inscripción para una competición futura, aparecerá aquí agrupada por competición, con quién va a cada una."
      />
    );
  }

  const hoy = hoyMadrid();

  return (
    <ul className="flex flex-col gap-3">
      {grupos.map((g) => {
        const dias = diasEntre(hoy, g.fecha);

        return (
          <li key={g.eventId} className="min-w-0 rounded-xl border bg-card">
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
                <span>{fechaCorta(g.fecha)}</span>
                {g.ciudad ? <span>{g.ciudad}</span> : null}
                <span>
                  <span className="cifra text-foreground">
                    {g.asistentes.length}
                  </span>{' '}
                  {g.asistentes.length === 1 ? 'inscripción' : 'inscripciones'}
                </span>
              </span>
            </div>

            {/*
              LA FILA ES UNA TARJETA EN MÓVIL.

              Eran cuatro datos en una línea que envolvía —nombre recortado,
              arma, avisos y estado— y en un iPhone el nombre se quedaba en
              `min-w-32` con puntos suspensivos mientras el estado se iba a su
              propia línea. Quién va es el dato de esta lista, así que va
              entero en su renglón y lo demás baja debajo, apagado.
            */}
            <ul className="divide-y">
              {g.asistentes.map((a, i) => (
                <li
                  key={`${a.id}-${a.weapon}-${a.category}-${i}`}
                  className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <span className="min-w-0 flex-1 text-sm leading-tight">{a.nombre}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">
                      {rotuloPrueba({ arma: a.weapon, categoria: a.category })}
                    </span>

                    {a.avisos.length > 0 ? (
                      <span
                        className="flex items-center gap-1 text-warn"
                        title={a.avisos.join('. ')}
                      >
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                        {a.avisos.length === 1
                          ? a.avisos[0]
                          : `${a.avisos.length} avisos`}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        'font-medium',
                        a.estado === 'en_marcha' ? 'text-ok' : 'text-warn',
                      )}
                    >
                      {a.estado === 'en_marcha' ? 'En marcha' : 'Sin confirmar'}
                    </span>
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
