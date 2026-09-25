'use client';

import { ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { EventView, Gender, Weapon } from '@/lib/queries/calendar';
import {
  CIRCUIT_LABEL,
  capitalizar,
  cn,
  formatDateRangeEs,
  organismoDe,
  titular,
} from '@/lib/utils';
import type { Inscrito } from '@/app/(app)/inscritos';
import { FichaEvento } from './ficha-evento';
import { MarcaArma, NOMBRE_ARMA } from './marca-arma';
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
  cargarInscritos: (eventId: string) => Promise<Inscrito[]>;
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

  const [vista, setVista] = React.useState<Vista>('mes');
  const [ancla, setAncla] = React.useState(() => new Date());
  const [armas, setArmas] = React.useState<Weapon[]>(armasPropias);
  const [generos, setGeneros] = React.useState<('M' | 'F')[]>(generosPropios);
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
  const [inscritos, setInscritos] = React.useState<Inscrito[] | null>(null);

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
        if (vigente) setInscritos([]);
      });
    return () => {
      vigente = false;
    };
  }, [abierto, cargarInscritos]);

  const todoPuesto =
    armas.length === ARMAS.length && generos.length === GENEROS.length;

  const verTodo = () => {
    setArmas([...ARMAS]);
    setGeneros(['M', 'F']);
  };
  const verLoMio = () => {
    setArmas(armasPropias);
    setGeneros(generosPropios);
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
            (c.gender === 'MIXTO' || generos.includes(c.gender as 'M' | 'F')),
        ),
      }))
      .filter((e) => {
        if (e.competitions.length === 0) return false;
        if (t && !`${e.name} ${e.city ?? ''}`.toLowerCase().includes(t)) return false;
        return true;
      });
  }, [eventos, armas, generos, busqueda]);

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
        {actualizado ? (
          <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
            Actualizado {actualizado}
          </p>
        ) : null}
      </div>

      {/* Controles en una sola fila que envuelve. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
        <div className="relative order-1 min-w-0 flex-1 basis-32">
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
              {/* En pantalla estrecha solo cabe la inicial, que es la misma
                  marca que llevan las barras del calendario. */}
              <span className="sm:hidden">{a[0]}</span>
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
              className="h-9 w-9 px-0 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {g.t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

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
            className="order-8 h-9"
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

        {tirador ? (
          <Button
            variant="ghost"
            size="sm"
            className="order-3 h-9 px-2 sm:order-7 sm:px-3"
            onClick={todoPuesto ? verLoMio : verTodo}
          >
            {todoPuesto ? 'Solo lo mío' : 'Ver todo'}
          </Button>
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
  const organismo = organismoDe(evento.source, evento.scope, evento.circuit);
  const tinte = {
    RFEE: 'from-org-rfee/35',
    FIE: 'from-org-fie/30',
    EFC: 'from-org-efc/35',
    AUT: 'from-muted',
  }[organismo];

  return (
    <div className="relative">
      {evento.imageUrl ? (
        <img
          src={evento.imageUrl}
          alt=""
          className="h-44 w-full object-cover sm:h-52"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={cn('h-24 w-full bg-gradient-to-br to-card', tinte)} aria-hidden />
      )}

      {/* Velo de abajo arriba para que el texto se lea sobre cualquier foto. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/10"
        aria-hidden
      />

      <SheetHeader className="relative -mt-16 gap-2 px-4 pb-0 sm:-mt-20">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{organismo}</Badge>
          <Badge variant="outline">
            {CIRCUIT_LABEL[evento.circuit] ?? evento.circuit}
          </Badge>
        </div>
        <SheetTitle className="text-3xl leading-none">
          {titular(evento.name)}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2">
          <MapPin className="size-3.5" aria-hidden />
          {titular(evento.city ?? 'Sede sin publicar')}
          {evento.country ? `, ${evento.country}` : ''}
          <span aria-hidden>·</span>
          {formatDateRangeEs(evento.startDate, evento.endDate)}
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
          <MarcaArma armas={[a]} />
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
