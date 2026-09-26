'use client';

import { ChevronDown, ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { EventView, Gender, Weapon } from '@/lib/queries/calendar';
import {
  CATEGORY_LABEL,
  CIRCUIT_LABEL,
  capitalizar,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
  titularTorneo,
} from '@/lib/utils';
import type { QuienVa } from '@/app/(app)/inscritos';
import { FichaEvento } from './ficha-evento';
import { IconoArma } from './iconos-arma';
import { NOMBRE_ARMA } from './marca-arma';
import { RejillaMes } from './rejilla-mes';

export type TiradorOpcion = {
  id: string;
  fullName: string;
  gender: 'M' | 'F' | 'MIXTO';
  weapons: string[];
  eligibleCategories: string[];
};

type Vista = 'mes' | 'trimestre';

const ARMAS: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: { v: 'M' | 'F'; t: string; largo: string }[] = [
  { v: 'M', t: 'M', largo: 'Masculino' },
  { v: 'F', t: 'F', largo: 'Femenino' },
];

function esArma(v: string): v is Weapon {
  return ARMAS.includes(v as Weapon);
}

/**
 * Orden de las categorías, de la más pequeña a la más grande. Se usa para
 * presentarlas siempre igual, sin depender del orden en que lleguen.
 */
const ORDEN_CATEGORIAS = [
  'M9',
  'M11',
  'M13',
  'M14',
  'M15',
  'M17',
  'M20',
  'M23',
  'ABS',
  'VET',
];

function ordenarCategorias(codigos: string[]): string[] {
  return [...codigos].sort(
    (a, b) => ORDEN_CATEGORIAS.indexOf(a) - ORDEN_CATEGORIAS.indexOf(b),
  );
}

/**
 * El calendario, que es la aplicación.
 *
 * Dos vistas: **mes** para el detalle y **trimestre** para planificar la
 * temporada, que es cuando hay que decidir a qué se va y pedir días con
 * antelación. Al tocar un torneo se abre su ficha en una hoja lateral; no
 * hay navegación a otra página.
 */
export function VistaCalendario({
  eventos,
  tiradores,
  inscripciones,
  temporada,
  actualizado,
  solicitarInscripcion,
  cargarInscritos,
}: {
  eventos: EventView[];
  tiradores: TiradorOpcion[];
  /** competitionId -> estado legible de la inscripción de esta cuenta. */
  inscripciones: Record<string, string>;
  temporada: string | null;
  actualizado: string | null;
  solicitarInscripcion: (
    competitionId: string,
    athleteId: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  /** Quién va a un torneo. Se pide al abrir la ficha, no antes. */
  cargarInscritos: (eventId: string) => Promise<QuienVa>;
}) {
  /**
   * Con quién se está mirando el calendario.
   *
   * Una cuenta de tutor lleva a dos hijos, y cada uno tira de un arma y en
   * una categoría distinta. Antes se cogía siempre `tiradores[0]`: el
   * calendario salía filtrado por el arma del mayor y, peor, el boton de
   * inscribir mandaba SIEMPRE al mayor, así que al pequeño no había forma de
   * apuntarlo desde aqui.
   */
  const [tiradorId, setTiradorId] = React.useState<string | null>(
    tiradores[0]?.id ?? null,
  );
  const tirador = tiradores.find((t) => t.id === tiradorId) ?? tiradores[0] ?? null;

  /**
   * Filtros de arranque: **lo tuyo**.
   *
   * Al entrar, un tirador ve su arma y su género, que es el 95 % de las
   * veces lo que quiere. No se guardan entre visitas a propósito: recargar
   * devuelve a lo suyo, y así nadie se queda mirando un calendario filtrado
   * por algo que tocó hace tres semanas y ya no recuerda.
   *
   * Desde ahí se puede abrir a lo que sea: varias armas a la vez, los dos
   * géneros, o todo.
   */
  const armasPropias = React.useMemo(() => {
    const suyas = (tirador?.weapons ?? []).filter(esArma);
    return suyas.length > 0 ? suyas : (['FLORETE'] as Weapon[]);
  }, [tirador]);

  const generosPropios = React.useMemo<('M' | 'F')[]>(
    () => (tirador?.gender === 'M' || tirador?.gender === 'F' ? [tirador.gender] : ['M', 'F']),
    [tirador],
  );

  /**
   * Categorías que hay DE VERDAD en el calendario.
   *
   * No se ofrece M9 si esta temporada no hay ninguna prueba M9: un filtro con
   * opciones que no cambian nada es ruido.
   */
  const categoriasDisponibles = React.useMemo(
    () =>
      ordenarCategorias([
        ...new Set(eventos.flatMap((e) => e.competitions.map((c) => c.category))),
      ]),
    [eventos],
  );

  /**
   * Las categorías en las que PUEDE tirar.
   *
   * Aquí estaba el fallo gordo: el calendario filtraba por arma y por género,
   * pero no por categoría, así que a Carlos Llavador —absoluto, 34 años— le
   * salían las Copas del Mundo cadete de florete masculino como si le
   * tocaran. `deriveCategoriesFromBirthDate` ya calcula la escalera correcta
   * (a un absoluto le corresponden absoluto y veteranos; a un M17, M17, M20 y
   * absoluto) y solo hacía falta usarla.
   */
  const categoriasPropias = React.useMemo(() => {
    const suyas = (tirador?.eligibleCategories ?? []).filter((c) =>
      categoriasDisponibles.includes(c),
    );
    return suyas.length > 0 ? ordenarCategorias(suyas) : categoriasDisponibles;
  }, [tirador, categoriasDisponibles]);

  const [vista, setVista] = React.useState<Vista>('mes');
  const [ancla, setAncla] = React.useState(() => new Date());
  const [armas, setArmas] = React.useState<Weapon[]>(armasPropias);
  const [generos, setGeneros] = React.useState<('M' | 'F')[]>(generosPropios);
  const [categorias, setCategorias] = React.useState<string[]>(categoriasPropias);
  const [busqueda, setBusqueda] = React.useState('');
  /**
   * Hacia dónde se movió la última vez.
   *
   * El único movimiento no pedido de esta pantalla: al cambiar de mes, la
   * rejilla entra por el lado del que viene. Sirve para algo —dice si vas
   * hacia delante o hacia atrás en la temporada, que en un calendario es la
   * orientación básica— y dura 200 ms. Cualquier otra cosa animada aquí
   * sería decoración sobre una rejilla que la gente mira treinta veces al
   * día.
   */
  const [direccion, setDireccion] = React.useState<-1 | 0 | 1>(0);
  const [abierto, setAbierto] = React.useState<EventView | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);

  /**
   * Quién va al torneo abierto.
   *
   * Se pide al abrir la ficha y no con el calendario: son 249 torneos y
   * traerse las inscripciones de todos para enseñar las de uno sería un
   * viaje de red enorme a cambio de nada. `null` significa «todavía no ha
   * llegado», que en pantalla es «Mirando quién va…».
   */
  const [inscritos, setInscritos] = React.useState<QuienVa | null>(null);

  React.useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    setInscritos(null);
    cargarInscritos(abierto.id)
      .then((r) => {
        if (vigente) setInscritos(r);
      })
      // Que no se sepa quién va no puede tumbar la ficha: se deja la lista
      // vacía y el resto de la información sigue estando.
      .catch(() => {
        if (vigente) setInscritos({ oficiales: [], pendientes: [] });
      });
    return () => {
      vigente = false;
    };
  }, [abierto, cargarInscritos]);

  const todoPuesto =
    armas.length === ARMAS.length &&
    generos.length === GENEROS.length &&
    categorias.length === categoriasDisponibles.length;

  const verTodo = () => {
    setArmas([...ARMAS]);
    setGeneros(['M', 'F']);
    setCategorias(categoriasDisponibles);
  };
  const verLoMio = () => {
    setArmas(armasPropias);
    setGeneros(generosPropios);
    setCategorias(categoriasPropias);
  };

  /**
   * Al cambiar de tirador, los filtros se van con él.
   *
   * Si no, se queda uno mirando el calendario de espada femenino con el hijo
   * de sable seleccionado, que es la forma más rápida de inscribir a quien no
   * era.
   */
  const cambiarTirador = (id: string) => {
    const nuevo = tiradores.find((t) => t.id === id);
    if (!nuevo) return;
    setTiradorId(id);
    const suyas = nuevo.weapons.filter(esArma);
    setArmas(suyas.length > 0 ? suyas : [...ARMAS]);
    setGeneros(
      nuevo.gender === 'M' || nuevo.gender === 'F' ? [nuevo.gender] : ['M', 'F'],
    );
    const suyasCategorias = nuevo.eligibleCategories.filter((c) =>
      categoriasDisponibles.includes(c),
    );
    setCategorias(
      suyasCategorias.length > 0
        ? ordenarCategorias(suyasCategorias)
        : categoriasDisponibles,
    );
  };

  const filtrados = React.useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    return eventos
      .map((e) => ({
        ...e,
        competitions: e.competitions.filter(
          (c) =>
            armas.includes(c.weapon) &&
            // Las pruebas por equipos mixtos no tienen género propio: se ven
            // siempre, porque descartarlas sería esconder competiciones.
            (c.gender === 'MIXTO' || generos.includes(c.gender as 'M' | 'F')) &&
            categorias.includes(c.category),
        ),
      }))
      .filter((e) => {
        if (e.competitions.length === 0) return false;
        if (t && !`${e.name} ${e.city ?? ''}`.toLowerCase().includes(t)) return false;
        return true;
      });
  }, [eventos, armas, generos, categorias, busqueda]);

  /** Se cuentan pruebas, no torneos: es lo que de verdad se puede tirar. */
  const numPruebas = React.useMemo(
    () => filtrados.reduce((n, e) => n + e.competitions.length, 0),
    [filtrados],
  );

  const meses = React.useMemo(
    () =>
      Array.from(
        { length: vista === 'mes' ? 1 : 3 },
        (_, i) => new Date(ancla.getFullYear(), ancla.getMonth() + i, 1),
      ),
    [ancla, vista],
  );

  const mover = (paso: number) => {
    setDireccion(paso > 0 ? 1 : -1);
    setAncla(
      (p) => new Date(p.getFullYear(), p.getMonth() + paso * (vista === 'mes' ? 1 : 3), 1),
    );
  };

  const nombreMes = (d: Date, conAnio = true) =>
    capitalizar(
      new Intl.DateTimeFormat('es-ES', {
        month: 'long',
        ...(conAnio ? { year: 'numeric' } : {}),
      })
        .format(d)
        .replace(' de ', ' '),
    );

  const rotulo =
    vista === 'mes'
      ? nombreMes(ancla)
      : `${nombreMes(meses[0], false)} – ${nombreMes(meses[2])}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/*
        Cabecera en UNA línea.

        En el móvil cada fila de cabecera son píxeles que le quita a la
        rejilla, que es lo único que la gente ha venido a ver. Medido: con el
        título, el recuento y la hora de actualización en tres renglones, al
        calendario le quedaban 180 px de 659 y una semana con tres torneos
        salía cortada. Lo accesorio (temporada y hora de actualización) solo
        aparece cuando hay sitio.
      */}
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h1 className="text-xl sm:text-3xl">{rotulo}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="cifra text-base text-foreground">{numPruebas}</span>{' '}
          {numPruebas === 1 ? 'prueba' : 'pruebas'}
          {filtrados.length !== numPruebas ? ` en ${filtrados.length} torneos` : ''}
          <span className="hidden sm:inline">{temporada ? ` · ${temporada}` : ''}</span>
        </p>
        {/*
          «Ver todo» vive en la cabecera y no entre los controles.

          Medido en un iPhone: con la raíz a 18 px, la fila de controles
          necesitaba cuatro renglones y el calendario se quedaba con media
          pantalla y la última semana cortada. Este botón es el que menos se
          toca de los cinco, así que es el que se va arriba, al hueco que en
          el móvil deja la hora de actualización.
        */}
        <div className="ml-auto flex items-baseline gap-3">
          {actualizado ? (
            <p className="hidden text-xs text-muted-foreground sm:block">
              Actualizado {actualizado}
            </p>
          ) : null}
          {tirador ? (
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 h-8 px-2"
              onClick={todoPuesto ? verLoMio : verTodo}
            >
              {todoPuesto ? 'Solo lo mío' : 'Ver todo'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Controles en una sola fila que envuelve. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
        <div className="relative order-1 min-w-0 flex-1 basis-28">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar torneo o ciudad"
            type="search"
            aria-label="Buscar torneo o ciudad"
            className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </div>

        <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)} className="order-2">
          <TabsList className="h-9">
            <TabsTrigger value="mes">Mes</TabsTrigger>
            <TabsTrigger value="trimestre">Trimestre</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="order-4 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => mover(-1)}
            aria-label="Anterior"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setDireccion(0);
              setAncla(new Date());
            }}
          >
            Hoy
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => mover(1)}
            aria-label="Siguiente"
          >
            <ChevronRight />
          </Button>
        </div>

        {/*
          Armas y géneros: se pueden marcar varios a la vez. Nunca se queda
          vacío —un calendario en blanco no es una respuesta útil—, así que
          al intentar quitar el último se ignora el cambio.
        */}
        <ToggleGroup
          type="multiple"
          value={armas}
          onValueChange={(v) => v.length > 0 && setArmas(v.filter(esArma))}
          variant="outline"
          aria-label="Armas"
          className="order-5 h-9"
        >
          {ARMAS.map((a) => (
            <ToggleGroupItem
              key={a}
              value={a}
              aria-label={NOMBRE_ARMA[a]}
              className="h-9 px-2.5 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {/* En pantalla estrecha solo cabe el icono, que es la misma
                  marca que llevan las barras del calendario. */}
              <IconoArma arma={a} className="size-4 shrink-0" />
              <span className="hidden sm:inline">{NOMBRE_ARMA[a]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ToggleGroup
          type="multiple"
          value={generos}
          onValueChange={(v) =>
            v.length > 0 && setGeneros(v.filter((g): g is 'M' | 'F' => g === 'M' || g === 'F'))
          }
          variant="outline"
          aria-label="Género"
          className="order-6 h-9"
        >
          {GENEROS.map((g) => (
            <ToggleGroupItem
              key={g.v}
              value={g.v}
              aria-label={g.largo}
              className="h-9 w-8 px-0 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground sm:w-9"
            >
              {g.t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/*
          Categoría: aquí no valen pastillas.

          Hay hasta diez —de M9 a veteranos— y diez pastillas se comen la fila
          entera y media pantalla del móvil. Va en un desplegable que dice en
          su propia etiqueta qué está filtrando, así que no hay que abrirlo
          para saberlo: «Absoluto», «3 categorías» o «Todas».
        */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="order-7 h-9 gap-1 px-2 sm:gap-1.5 sm:px-3"
              aria-label="Categoría"
            >
              {/*
                En el móvil va el código y en escritorio la palabra: «ABS»
                ocupa tres caracteres y «Absoluto» ocho, y esos cinco de
                diferencia son los que hacen que la fila de controles quepa
                en dos renglones en vez de tres.
              */}
              {categorias.length === categoriasDisponibles.length ? (
                'Todas'
              ) : categorias.length === 1 ? (
                <>
                  <span className="sm:hidden">{categorias[0]}</span>
                  <span className="hidden sm:inline">
                    {CATEGORY_LABEL[categorias[0] as keyof typeof CATEGORY_LABEL] ??
                      categorias[0]}
                  </span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">{categorias.length} cat.</span>
                  <span className="hidden sm:inline">
                    {categorias.length} categorías
                  </span>
                </>
              )}
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </Button>
          </PopoverTrigger>

          <PopoverContent align="end" className="w-52 p-1.5">
            <ul className="flex flex-col">
              {categoriasDisponibles.map((c) => {
                const puesta = categorias.includes(c);
                return (
                  <li key={c}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={puesta}
                      onClick={() =>
                        setCategorias((previas) => {
                          const siguientes = puesta
                            ? previas.filter((x) => x !== c)
                            : ordenarCategorias([...previas, c]);
                          // Nunca vacío: un calendario en blanco no responde
                          // a ninguna pregunta.
                          return siguientes.length > 0 ? siguientes : previas;
                        })
                      }
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                        puesta ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c}
                      {puesta ? (
                        <span className="text-primary-text" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-1 flex gap-1 border-t pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 flex-1 px-2 text-xs"
                onClick={() => setCategorias(categoriasDisponibles)}
              >
                Todas
              </Button>
              {tirador ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 px-2 text-xs"
                  onClick={() => setCategorias(categoriasPropias)}
                >
                  Las mías
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        {/*
          Selector de tirador: solo cuando la cuenta lleva a más de uno. Con
          un solo tirador sería un control que nunca cambia nada.
        */}
        {tiradores.length > 1 ? (
          <ToggleGroup
            type="single"
            value={tirador?.id ?? ''}
            onValueChange={(v) => v && cambiarTirador(v)}
            variant="outline"
            aria-label="Tirador"
            className="order-9 h-9"
          >
            {tiradores.map((t) => (
              <ToggleGroupItem
                key={t.id}
                value={t.id}
                className="h-9 px-2.5 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {nombreCorto(t.fullName)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}


      </div>

      {aviso ? (
        <p className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">{aviso}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setAviso(null)}
            aria-label="Cerrar aviso"
          >
            <X />
          </Button>
        </p>
      ) : null}

      {/*
        Trimestre: tres columnas en escritorio, y en el móvil una debajo de
        otra CON desplazamiento propio.

        Sin esto, los tres meses se repartían el alto de la pantalla y cada
        uno se quedaba en 180 px: se veía una semana y media de cada mes y el
        resto cortado. Un trimestre no cabe en la pantalla de un teléfono, y
        fingir que sí es peor que desplazarse: cada mes conserva su alto
        mínimo y se pasa el dedo. El desplazamiento es del bloque, no de la
        página, así que la cabecera y la leyenda no se mueven.
      */}
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-3',
          vista === 'trimestre'
            ? 'overflow-y-auto lg:grid-cols-3 lg:overflow-visible'
            : 'grid-cols-1',
        )}
      >
        {meses.map((m) => (
          <section
            key={`${m.getFullYear()}-${m.getMonth()}`}
            className={cn(
              'flex flex-col',
              // En trimestre y móvil cada mes reserva su alto; en el resto
              // de casos el mes se ajusta al hueco disponible.
              vista === 'trimestre' ? 'min-h-[19rem] lg:min-h-0' : 'min-h-0',
              'animate-in fade-in-0 duration-200',
              direccion === 1 && 'slide-in-from-right-6',
              direccion === -1 && 'slide-in-from-left-6',
            )}
          >
            {vista === 'trimestre' ? (
              <h2 className="pb-1.5 text-lg">{nombreMes(m, false)}</h2>
            ) : null}
            <RejillaMes
              ancla={m}
              eventos={filtrados}
              compacta={vista === 'trimestre'}
              inscripciones={inscripciones}
              onAbrirEvento={setAbierto}
            />
          </section>
        ))}
      </div>

      <Leyenda />

      <Sheet open={abierto !== null} onOpenChange={(o) => !o && setAbierto(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {abierto ? <CabeceraFicha evento={abierto} /> : null}
          {abierto ? (
            <FichaEvento
              evento={abierto}
              tirador={tirador}
              inscripciones={inscripciones}
              inscritos={inscritos}
              onSolicitar={async (competitionId) => {
                if (!tirador) return;
                const r = await solicitarInscripcion(competitionId, tirador.id);
                setAbierto(null);
                setAviso(r.ok ? r.message : r.error);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Cabecera de la ficha.
 *
 * Cuando la fuente publica cartel, el título va **encima de la imagen**, no
 * debajo: es lo que hace el calendario de la FIE y es lo que convierte una
 * lista de datos en la ficha de un torneo. La imagen se enlaza a su origen
 * (`static.fie.org`), nunca se copia.
 *
 * Cuando no hay cartel no se pone un hueco gris ni un dibujo de relleno: se
 * pinta una franja con el color del organismo, que ya dice algo —de quién
 * es el torneo— en lugar de ocupar sitio por ocupar.
 */
function CabeceraFicha({ evento }: { evento: EventView }) {
  const [fallo, setFallo] = React.useState(false);
  React.useEffect(() => setFallo(false), [evento.id]);

  const hayFoto = Boolean(evento.imageUrl) && !fallo;
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const tinte = {
    RFEE: 'from-org-rfee/40',
    FIE: 'from-org-fie/35',
    EFC: 'from-org-efc/40',
    AUT: 'from-muted-foreground/30',
  }[organismo];

  return (
    <div className="relative">
      {/*
        Sin cartel no se reserva sitio para el cartel.

        Antes, cuando la fuente no publicaba imagen se pintaba una franja
        de 96 px con un degradado tan sutil que en pantalla era un hueco
        negro: 140 px de nada antes del título. Solo 26 de los 249 torneos
        traen cartel, así que el caso normal es este. Ahora sin foto queda
        una banda fina del color de quien organiza, que además dice algo.
      */}
      {hayFoto ? (
        /*
          El hueco de la foto lleva el color de quien organiza DEBAJO.

          Los carteles de la FIE son JPEG de 4000 px enlazados a
          `static.fie.org`: tardan medio segundo largo en pintar y durante
          ese rato la hoja abria con un rectángulo negro de 200 px. Con el
          tinte detras, el hueco se lee como parte del diseño mientras la
          foto llega, y si no llega nunca tampoco pasa nada.
        */
        <div className={cn('relative w-full bg-gradient-to-br to-card', tinte)}>
          <img
            src={evento.imageUrl ?? ''}
            alt=""
            className="h-44 w-full object-cover sm:h-52"
            fetchPriority="high"
            /* Nada de `lazy`: es lo primero que se ve de la hoja. Con carga
               diferida el hueco se reservaba y la foto entraba medio segundo
               despues, de modo que la ficha siempre abria con un boquete. */
            loading="eager"
            decoding="async"
            /* Y si el cartel ha desaparecido de `static.fie.org`, se quita el
               hueco en vez de dejar 200 px de nada con un icono roto. */
            onError={() => setFallo(true)}
          />
          {/* Velo de abajo arriba para que el texto se lea sobre la foto. */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/10"
            aria-hidden
          />
        </div>
      ) : (
        <div className={cn('h-1 w-full bg-gradient-to-r to-transparent', tinte)} aria-hidden />
      )}

      <SheetHeader
        className={cn(
          'relative gap-2 px-4 pb-0',
          hayFoto ? '-mt-16 sm:-mt-20' : 'pt-4',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{organismo}</Badge>
          <Badge variant="outline">
            {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
          </Badge>
        </div>
        <SheetTitle className="text-3xl leading-[0.95] sm:text-4xl">
          {titularTorneo(evento.name)}
        </SheetTitle>
        {/*
          Dónde y cuándo, en dos columnas con su rótulo.

          Antes era una cadena «Casablanca, MA · 15-18 oct 2026». Una línea
          de datos pegados con puntos medios es rápida de escribir y lenta de
          leer: hay que analizarla para saber qué es cada trozo. En columnas
          se ve de un vistazo, que es justo lo que se pidió.
        */}
        <SheetDescription asChild>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1">
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Dónde</dt>
              <dd className="flex items-center gap-1.5 text-sm text-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {evento.city ? titular(evento.city) : 'Sede sin publicar'}
                  {evento.country ? `, ${evento.country}` : ''}
                </span>
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Cuándo</dt>
              <dd className="text-sm text-foreground">
                {formatDateRangeEs(evento.startDate, evento.endDate)}
              </dd>
            </div>
          </dl>
        </SheetDescription>
      </SheetHeader>
    </div>
  );
}

/**
 * Leyenda.
 *
 * Sin ella el código de color es decoración: nadie adivina que el oro es la
 * FIE. Va siempre visible, también en trimestre, que es donde más falta
 * hace. Enseña además qué significan las iniciales de las barras, que es
 * donde se aprende a leerlas.
 */
function Leyenda() {
  const E = [
    { c: 'bg-org-rfee', t: 'Nacional (RFEE)' },
    { c: 'bg-org-fie', t: 'Internacional (FIE)' },
    { c: 'bg-org-efc', t: 'Europeo (EFC)' },
  ];
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {E.map((e) => (
        <li key={e.t} className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', e.c)} aria-hidden />
          {e.t}
        </li>
      ))}
      {/* Las iniciales ya se enseñan en los botones de arma de arriba, así
          que en el móvil se ahorran: cada renglón de leyenda es un renglón
          menos de calendario. */}
      {ARMAS.map((a) => (
        <li key={a} className="hidden items-center gap-1.5 sm:flex">
          <IconoArma arma={a} className="size-4" />
          {NOMBRE_ARMA[a]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span
          className="grid size-3.5 place-items-center rounded-full bg-foreground text-[8px] font-bold text-background"
          aria-hidden
        >
          ✓
        </span>
        Ya estás inscrito
      </li>
    </ul>
  );
}

/** El nombre de pila basta para distinguir a dos hermanos en un botón. */
function nombreCorto(nombre: string): string {
  return nombre.replace(/^DEMO\s+/i, '').split(/\s+/)[0] ?? nombre;
}
