'use client';

import { ChevronDown, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { CampoFecha } from '@/components/admin/campo-fecha';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RUTA_EXPLORAR,
  alternarEspana,
  construirUrl,
  hayCriterios,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';

type Opcion = { valor: string; etiqueta: string };

const ARMAS: Opcion[] = Object.entries(WEAPON_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }));
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

function CampoSelect({
  id,
  etiqueta,
  valor,
  opciones,
  textoVacio,
  onChange,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  opciones: Opcion[];
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
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CUALQUIERA}>{textoVacio}</SelectItem>
          {opciones.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.etiqueta}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function erroresDe(c: CriteriosExplorar): Partial<Record<'torneo' | 'nacionalidad' | 'intervalo', string>> {
  const errores: Partial<Record<'torneo' | 'nacionalidad' | 'intervalo', string>> = {};
  if (c.torneo.length === 1) errores.torneo = 'Escribe al menos dos letras del torneo.';
  if (c.nacionalidad !== '' && !/^[A-Z]{3}$/.test(c.nacionalidad)) {
    errores.nacionalidad = 'El país son tres letras, por ejemplo ESP o FRA.';
  }
  if (c.desde && c.hasta && c.desde > c.hasta) {
    errores.intervalo = 'La fecha «Desde» tiene que ser anterior o igual a «Hasta».';
  }
  return errores;
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
  temporadas: string[];
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
    if (Object.keys(erroresDe(siguiente)).length > 0) {
      setAvisar(true);
      return;
    }
    setAvisar(false);
    empezar(() => router.push(construirUrl(siguiente)));
  };

  const opcionesTemporada: Opcion[] = (
    borrador.temporada && !temporadas.includes(borrador.temporada)
      ? [borrador.temporada, ...temporadas]
      : temporadas
  ).map((t) => ({ valor: t, etiqueta: t }));

  const espanaActiva = borrador.nacionalidad === 'ESP';

  return (
    <form
      role="search"
      aria-label="Buscar deportistas"
      aria-busy={pendiente}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        buscar(borrador);
      }}
    >
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 md:col-span-1">
          <Label htmlFor="explorar-q">Nombre o alias</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="explorar-q"
              type="search"
              value={borrador.q}
              maxLength={80}
              autoComplete="off"
              placeholder="Apellido, nombre o alias"
              className="pl-8"
              onChange={(e) => poner({ q: e.target.value })}
            />
          </div>
        </div>

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

        <Button type="submit" disabled={pendiente} className="col-span-2 md:col-span-1">
          {pendiente ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      {atajoEspana ? (
        <div className="flex flex-col gap-1">
          <div>
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
          </div>
          <p id="explorar-espana-ayuda" className="text-xs text-muted-foreground">
            Todas las personas españolas indexadas, tengan cuenta o no, estén activas o retiradas. Combínalo con arma o categoría.
          </p>
        </div>
      ) : null}

      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="-ml-2 min-h-11">
            <ChevronDown
              className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'}
              aria-hidden
            />
            Más filtros{avanzadosActivos > 0 ? ` (${avanzadosActivos} activos)` : ''}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
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
              opciones={opcionesTemporada}
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
              ayuda="Opcional."
            />
            <CampoFecha
              id="explorar-hasta"
              etiqueta="Hasta"
              valorIso={borrador.hasta}
              onChange={(hasta) => poner({ hasta })}
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

      {hayCriterios(criterios) ? (
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 min-h-11">
            <Link href={RUTA_EXPLORAR} prefetch={false}>
              Quitar todos los filtros
            </Link>
          </Button>
        </div>
      ) : null}
    </form>
  );
}
