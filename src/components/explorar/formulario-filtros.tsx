'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { CampoFecha } from '@/components/admin/campo-fecha';
import { BuscadorPersonas } from './buscador-personas';
import { ACTIVO } from '@/components/nav';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RUTA_EXPLORAR,
  CLAVES_CRITERIO,
  alternarEspana,
  construirUrl,
  etiquetaTemporada,
  hayCriterios,
  type CriteriosExplorar,
  type OpcionTemporada,
} from '@/lib/sport/explorar/url';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, esFechaIsoReal } from '@/lib/utils';

type Opcion = { valor: string; etiqueta: string };
type Grupo = { etiqueta: string; opciones: Opcion[] };

const NOMBRE_FUENTE: Record<OpcionTemporada['fuente'], string> = {
  FIE: 'FIE (internacional, año en que termina)',
  RFEE: 'RFEE (nacional, septiembre a agosto)',
};

export const ARMAS: Opcion[] = Object.entries(WEAPON_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const GENEROS: Opcion[] = Object.entries(GENDER_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const CATEGORIAS: Opcion[] = Object.entries(CATEGORY_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }));
const AMBITOS: Opcion[] = [
  { valor: 'NACIONAL', etiqueta: 'Nacional' },
  { valor: 'INTERNACIONAL', etiqueta: 'Internacional' },
  { valor: 'AUTONOMICO', etiqueta: 'Autonómico' },
];

/** Radix no admite un valor vacío en una opción: este centinela significa «sin filtro». */
const CUALQUIERA = 'cualquiera';

const CLAVES_AVANZADAS = [
  'categoria',
  'ambito',
  'nacionalidad',
  'temporada',
  'torneo',
  'desde',
  'hasta',
] as const;

export function CampoSelect({
  id,
  etiqueta,
  valor,
  opciones,
  grupos = [],
  textoVacio,
  onChange,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  opciones: Opcion[];
  grupos?: Grupo[];
  textoVacio: string;
  onChange: (valor: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Select
        value={valor === '' ? CUALQUIERA : valor}
        onValueChange={(v) => onChange(v === CUALQUIERA ? '' : v)}
      >
        <SelectTrigger id={id} className="min-h-11 w-full bg-secondary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CUALQUIERA}>{textoVacio}</SelectItem>
          {opciones.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.etiqueta}
            </SelectItem>
          ))}
          {grupos.map((g) => (
            <SelectGroup key={g.etiqueta}>
              <SelectLabel>{g.etiqueta}</SelectLabel>
              {g.opciones.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Opciones del selector de temporada: un grupo por fuente y, aparte, la
 * temporada de la URL si no está entre las ofrecidas, para que el selector
 * nunca muestre «Todas» mientras el filtro está activo.
 */
export function agruparTemporadas(
  temporadas: OpcionTemporada[],
  actual: string,
): { sueltas: Opcion[]; grupos: Grupo[] } {
  const sueltas =
    actual !== '' && !temporadas.some((t) => t.valor === actual)
      ? [{ valor: actual, etiqueta: etiquetaTemporada(actual) }]
      : [];
  const grupos = (['FIE', 'RFEE'] as const).map((fuente) => ({
    etiqueta: NOMBRE_FUENTE[fuente],
    opciones: temporadas
      .filter((t) => t.fuente === fuente)
      .map(({ valor, etiqueta }) => ({ valor, etiqueta })),
  }));
  return { sueltas, grupos };
}

type ClaveError = 'torneo' | 'nacionalidad' | 'desde' | 'hasta' | 'intervalo';

const MENSAJE_FECHA = (nombre: string) =>
  `«${nombre}» no es una fecha válida. Escríbela como 03/10/2026 o bórrala para poder buscar.`;

/**
 * Una fecha rellena que no existe (`31/02/2026`, `2026-99-99`) es un error,
 * no un campo vacío: enviarla en blanco ampliaría la búsqueda sin avisar.
 */
export function erroresDe(c: CriteriosExplorar): Partial<Record<ClaveError, string>> {
  const errores: Partial<Record<ClaveError, string>> = {};
  if (c.torneo.length === 1) errores.torneo = 'Escribe al menos dos letras del torneo.';
  if (c.nacionalidad !== '' && !/^[A-Z]{3}$/.test(c.nacionalidad)) {
    errores.nacionalidad = 'El país son tres letras, por ejemplo ESP o FRA.';
  }
  const desdeReal = c.desde !== '' && esFechaIsoReal(c.desde);
  const hastaReal = c.hasta !== '' && esFechaIsoReal(c.hasta);
  if (c.desde !== '' && !desdeReal) errores.desde = MENSAJE_FECHA('Desde');
  if (c.hasta !== '' && !hastaReal) errores.hasta = MENSAJE_FECHA('Hasta');
  if (desdeReal && hastaReal && c.desde > c.hasta) {
    errores.intervalo = 'La fecha «Desde» tiene que ser anterior o igual a «Hasta».';
  }
  return errores;
}

export type PreparacionBusqueda =
  | { ok: true; url: string }
  | { ok: false; errores: Partial<Record<ClaveError, string>> };

/** Única puerta entre el borrador del formulario y la URL: sin errores no hay navegación. */
export function prepararBusqueda(c: CriteriosExplorar): PreparacionBusqueda {
  const errores = erroresDe(c);
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, url: construirUrl(c) };
}

/**
 * Filtros de Explorar. El borrador vive en el estado del formulario y sólo al
 * buscar se escribe en la URL con `router.push`: así el botón Atrás vuelve a
 * la búsqueda anterior y cada búsqueda empieza en la primera página. La
 * página remonta este componente (`key`) cuando cambia la URL.
 */
export function FormularioFiltros({
  criterios,
  temporadas,
  atajoEspana,
}: {
  criterios: CriteriosExplorar;
  temporadas: OpcionTemporada[];
  atajoEspana: boolean;
}) {
  const router = useRouter();
  const [pendiente, empezar] = React.useTransition();
  const [borrador, setBorrador] = React.useState<CriteriosExplorar>(criterios);
  const [avisar, setAvisar] = React.useState(false);

  const avanzadosActivos = CLAVES_AVANZADAS.filter((k) => criterios[k] !== '').length;
  const [abierto, setAbierto] = React.useState(avanzadosActivos > 0);

  const errores = erroresDe(borrador);
  const hayErrores = Object.keys(errores).length > 0;

  const poner = (parcial: Partial<CriteriosExplorar>) =>
    setBorrador((actual) => ({ ...actual, ...parcial }));

  const buscar = (siguiente: CriteriosExplorar) => {
    const preparada = prepararBusqueda(siguiente);
    if (!preparada.ok) {
      setAvisar(true);
      // Un error en un filtro avanzado no puede quedar tras el panel plegado.
      if (CLAVES_AVANZADAS.some((k) => k in preparada.errores)) setAbierto(true);
      return;
    }
    setAvisar(false);
    empezar(() => router.push(preparada.url));
  };

  const { sueltas: temporadaFueraDeLista, grupos: gruposTemporada } = agruparTemporadas(
    temporadas,
    borrador.temporada,
  );

  const espanaActiva = borrador.nacionalidad === 'ESP';

  return (
    <form
      action={RUTA_EXPLORAR}
      method="get"
      role="search"
      aria-label="Buscar deportistas"
      aria-busy={pendiente}
      className="flex min-w-0 flex-col gap-3 border-y bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        buscar(borrador);
      }}
    >
      {CLAVES_CRITERIO.filter((k) => k !== 'q').map((clave) => (
        <input key={clave} type="hidden" name={clave} value={borrador[clave]} />
      ))}
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <BuscadorPersonas valor={borrador.q} onChange={(q) => poner({ q })} />

        <CampoSelect
          id="explorar-arma"
          etiqueta="Arma"
          valor={borrador.arma}
          opciones={ARMAS}
          textoVacio="Todas"
          onChange={(arma) => poner({ arma })}
        />
        <CampoSelect
          id="explorar-genero"
          etiqueta="Género"
          valor={borrador.genero}
          opciones={GENEROS}
          textoVacio="Todos"
          onChange={(genero) => poner({ genero })}
        />

        <Button type="submit" disabled={pendiente} className="col-span-2 min-h-11 md:col-span-1">
          {pendiente ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {atajoEspana ? (
            <>
              <Button
                type="button"
                variant="outline"
                aria-pressed={espanaActiva}
                aria-describedby="explorar-espana-ayuda"
                disabled={pendiente}
                className={espanaActiva ? ACTIVO : undefined}
                onClick={() => {
                  const siguiente = alternarEspana(borrador);
                  setBorrador(siguiente);
                  buscar(siguiente);
                }}
              >
                Solo España
              </Button>
              <p id="explorar-espana-ayuda" className="sr-only">
                Todas las personas españolas indexadas, tengan cuenta o no, estén activas o retiradas. Combínalo con arma o categoría.
              </p>
            </>
          ) : null}
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="min-h-11">
              <ChevronDown
                className={abierto ? 'rotate-180 transition-transform motion-reduce:transition-none' : 'transition-transform motion-reduce:transition-none'}
                aria-hidden
              />
              Más filtros{avanzadosActivos > 0 ? ` (${avanzadosActivos} activos)` : ''}
            </Button>
          </CollapsibleTrigger>
          {hayCriterios(criterios) ? (
            <Button asChild variant="ghost" size="sm" className="min-h-11 sm:ml-auto">
              <Link href={RUTA_EXPLORAR} prefetch={false}>
                Quitar todos los filtros
              </Link>
            </Button>
          ) : null}
        </div>
        <CollapsibleContent className="mt-3 border-t pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CampoSelect
              id="explorar-categoria"
              etiqueta="Categoría"
              valor={borrador.categoria}
              opciones={CATEGORIAS}
              textoVacio="Todas"
              onChange={(categoria) => poner({ categoria })}
            />
            <CampoSelect
              id="explorar-ambito"
              etiqueta="Ámbito"
              valor={borrador.ambito}
              opciones={AMBITOS}
              textoVacio="Todos"
              onChange={(ambito) => poner({ ambito })}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="explorar-pais">País (tres letras)</Label>
              <Input
                id="explorar-pais"
                value={borrador.nacionalidad}
                maxLength={3}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="ESP"
                aria-invalid={Boolean(errores.nacionalidad)}
                aria-describedby="explorar-pais-ayuda"
                onChange={(e) => poner({ nacionalidad: e.target.value.replace(/[^a-z]/gi, '').toUpperCase() })}
              />
              <p
                id="explorar-pais-ayuda"
                className={errores.nacionalidad ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}
              >
                {errores.nacionalidad ?? 'Código FIE, por ejemplo ESP, FRA o ITA.'}
              </p>
            </div>
            <CampoSelect
              id="explorar-temporada"
              etiqueta="Temporada"
              valor={borrador.temporada}
              opciones={temporadaFueraDeLista}
              grupos={gruposTemporada}
              textoVacio="Todas"
              onChange={(temporada) => poner({ temporada })}
            />
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="explorar-torneo">Torneo</Label>
              <Input
                id="explorar-torneo"
                value={borrador.torneo}
                maxLength={80}
                autoComplete="off"
                placeholder="Parte del nombre del torneo"
                aria-invalid={Boolean(errores.torneo)}
                aria-describedby="explorar-torneo-ayuda"
                onChange={(e) => poner({ torneo: e.target.value })}
              />
              <p
                id="explorar-torneo-ayuda"
                className={errores.torneo ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}
              >
                {errores.torneo ?? 'Con temporada o fechas, sólo cuenta la edición de ese periodo.'}
              </p>
            </div>
            <CampoFecha
              id="explorar-desde"
              etiqueta="Desde"
              valorIso={borrador.desde}
              onChange={(desde) => poner({ desde })}
              conservarInvalido
              ayuda="Opcional."
            />
            <CampoFecha
              id="explorar-hasta"
              etiqueta="Hasta"
              valorIso={borrador.hasta}
              onChange={(hasta) => poner({ hasta })}
              conservarInvalido
              ayuda="Opcional."
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {avisar && hayErrores ? (
        <p role="alert" className="text-sm text-danger">
          {Object.values(errores).join(' ')}
        </p>
      ) : errores.intervalo ? (
        <p className="text-sm text-danger">{errores.intervalo}</p>
      ) : null}
    </form>
  );
}
