'use client';

import { ExternalLink, Loader2 } from 'lucide-react';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
  FilaFie,
  FormatoClasificacion,
  GrupoClasificacion,
  RankingGroupKey,
  TablaClasificacionFie,
} from '@/lib/queries/ranking';
import { nombreCasa } from '@/lib/nombres';
import { cn, formatDateEs } from '@/lib/utils';
import { clave, puntos } from './formato';
import { SelectoresGrupo } from './selectores-grupo';

/** Filas por tanda. Igual que en la tabla oficial. */
const PASO = 50;

/**
 * ===========================================================================
 * LA CLASIFICACIÓN MUNDIAL DE LA FIE
 * ===========================================================================
 *
 * Dos clasificaciones y un filtro, que es lo que el usuario pidió con el caso
 * delante: *«no veo botón en el ranking para poner el ranking con tiradores
 * también no españoles»*, *«tampoco veo para ver el ranking de países»* y *«el
 * toggle para ver solo los de España, que por defecto estará apagado»*.
 *
 *  - **Individual / Selecciones**, que son `type=I` y `type=E` de la FIE. Los
 *    dos valores los dijo su propia API al rechazar `type=T`.
 *  - **«Solo España», APAGADO de entrada**: lo primero que se ve es el mundo,
 *    con Italia primera y España donde esté. Encendido, la misma tabla con sus
 *    puestos mundiales intactos: el 13 sigue siendo el 13, no pasa a ser el 1.
 *    Eso es lo que hace que el filtro informe en vez de mentir.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE PIDE UN GRUPO A LA VEZ
 * ---------------------------------------------------------------------------
 * La clasificación completa son **11.561 filas**. Mandarlas al navegador para
 * enseñar cincuenta es lo que el usuario pidió que no pasara. Así que de
 * entrada viene el grupo con el que se abre —ya pintado en el servidor, sin
 * parpadeo— y cambiar de arma pide **solo ese grupo**. El más grande son 1.253
 * filas, y con el grupo entero en la mano el buscador, el filtro y la
 * paginación funcionan sin volver a la red.
 *
 * ---------------------------------------------------------------------------
 * LAS BANDERAS
 * ---------------------------------------------------------------------------
 * Con «solo España» apagado la tabla es mundial, y ahí la bandera **es un
 * dato**, no un adorno: distingue las filas. Con el filtro encendido son todas
 * españolas y la columna sobra, así que se esconde. Es la misma regla que en
 * la tabla de la RFEE, donde no hay banderas porque las 1.235 filas son
 * españolas y sería el mismo icono repetido.
 */
export function TablaRankingFie({
  grupos,
  inicial,
  primeraTabla,
  mios,
  cargar,
}: {
  grupos: GrupoClasificacion[];
  inicial: { format: FormatoClasificacion } & RankingGroupKey;
  /** El grupo de arranque, ya resuelto en el servidor. */
  primeraTabla: TablaClasificacionFie | null;
  mios: string[];
  /** Acción de servidor que trae un grupo. */
  cargar: (p: {
    format: FormatoClasificacion;
    weapon: RankingGroupKey['weapon'];
    gender: RankingGroupKey['gender'];
    category: RankingGroupKey['category'];
  }) => Promise<TablaClasificacionFie | null>;
}) {
  const [format, setFormat] = React.useState<FormatoClasificacion>(inicial.format);
  const [grupo, setGrupo] = React.useState<RankingGroupKey>({
    weapon: inicial.weapon,
    gender: inicial.gender,
    category: inicial.category,
  });
  const [tabla, setTabla] = React.useState<TablaClasificacionFie | null>(primeraTabla);
  const [cargando, setCargando] = React.useState(false);
  const [soloEspana, setSoloEspana] = React.useState(false);
  const [busqueda, setBusqueda] = React.useState('');
  const [tope, setTope] = React.useState(PASO);

  /** Las combinaciones que existen PARA EL FORMATO elegido. */
  const gruposDelFormato = React.useMemo(
    () => grupos.filter((g) => g.format === format),
    [grupos, format],
  );

  /**
   * Pide un grupo y lo pinta. Si llegan dos respuestas cruzadas —se toca arma
   * dos veces seguidas— gana la última que se pidió, no la última que llega.
   */
  const peticion = React.useRef(0);
  const pedir = React.useCallback(
    async (f: FormatoClasificacion, g: RankingGroupKey) => {
      const mia = ++peticion.current;
      setCargando(true);
      try {
        const r = await cargar({ format: f, ...g });
        if (peticion.current === mia) {
          setTabla(r);
          setTope(PASO);
          setBusqueda('');
        }
      } finally {
        if (peticion.current === mia) setCargando(false);
      }
    },
    [cargar],
  );

  /** Al cambiar de formato se conserva el grupo si existe allí. */
  const cambiarFormato = (f: FormatoClasificacion) => {
    const disponibles = grupos.filter((g) => g.format === f);
    const destino =
      disponibles.find((g) => clave(g) === clave(grupo)) ??
      disponibles.find((g) => g.weapon === grupo.weapon) ??
      disponibles[0];
    if (!destino) return;
    setFormat(f);
    setGrupo({
      weapon: destino.weapon,
      gender: destino.gender,
      category: destino.category,
    });
    void pedir(f, destino);
  };

  const elegir = (parcial: Partial<RankingGroupKey>) => {
    const pedido = { ...grupo, ...parcial };
    const existe = gruposDelFormato.some((g) => clave(g) === clave(pedido));
    const destino = existe
      ? pedido
      : (gruposDelFormato.find(
          (g) =>
            (parcial.weapon ? g.weapon === parcial.weapon : true) &&
            (parcial.gender ? g.gender === parcial.gender : true) &&
            (parcial.category ? g.category === parcial.category : true),
        ) ?? gruposDelFormato[0]);
    if (!destino) return;
    const siguiente = {
      weapon: destino.weapon,
      gender: destino.gender,
      category: destino.category,
    };
    setGrupo(siguiente);
    void pedir(format, siguiente);
  };

  const porEquipos = format === 'EQUIPOS';

  const filtradas = React.useMemo(() => {
    let f = tabla?.rows ?? [];
    if (soloEspana) f = f.filter((r) => r.pais === 'ESP');
    if (busqueda) {
      f = f.filter(
        (r) =>
          nombreCasa(r.nombre ?? '', busqueda) ||
          nombreCasa(r.paisNombre ?? '', busqueda) ||
          nombreCasa(r.pais ?? '', busqueda),
      );
    }
    return f;
  }, [tabla, soloEspana, busqueda]);

  /**
   * Buscando o filtrando se enseña TODO lo que casa, sin «ver más»: quien
   * escribe un nombre quiere ese nombre, y esconderlo detrás de un botón
   * porque va en el puesto 907 convierte el buscador en un adorno.
   */
  const recorta = !busqueda && !soloEspana;
  const visibles = recorta ? filtradas.slice(0, tope) : filtradas;
  const quedan = filtradas.length - visibles.length;

  const hayPruebas = (tabla?.rows ?? []).some((f) => f.eventCount !== null);
  const conBandera = !soloEspana;

  return (
    <div className="ranking flex min-w-0 flex-col gap-4">
      {/* Individual o selecciones. Las dos clasificaciones de la FIE. */}
      <ToggleGroup
        type="single"
        variant="outline"
        value={format}
        onValueChange={(v) => v && cambiarFormato(v as FormatoClasificacion)}
        aria-label="Qué clasificación mundial"
        spacing={1}
        className="w-full sm:w-auto"
      >
        <ToggleGroupItem value="INDIVIDUAL" className="h-11 flex-1 sm:flex-none">
          Individual
        </ToggleGroupItem>
        <ToggleGroupItem value="EQUIPOS" className="h-11 flex-1 sm:flex-none">
          Selecciones
        </ToggleGroupItem>
      </ToggleGroup>

      <SelectoresGrupo
        grupos={gruposDelFormato}
        grupo={grupo}
        onElegir={elegir}
        busqueda={busqueda}
        onBuscar={setBusqueda}
        etiquetaBusqueda={porEquipos ? 'Buscar un país' : 'Buscar un tirador'}
      />

      {/*
        «Solo España», apagado de entrada.

        Va con `Switch` y no con otra pastilla: es un interruptor de encendido y
        apagado, no una elección entre dos cosas, y mezclarlo con los selectores
        de arma haría dudar de si «España» es una categoría más.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm">
          <Switch
            checked={soloEspana}
            onCheckedChange={setSoloEspana}
            aria-label="Enseñar solo España"
          />
          <span className={cn(soloEspana ? 'text-foreground' : 'text-muted-foreground')}>
            Solo España
            {tabla ? (
              <span className="ml-1.5 text-muted-foreground">
                ({tabla.espanoles} de {tabla.rows.length})
              </span>
            ) : null}
          </span>
        </label>

        {cargando ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Cargando la clasificación…
          </span>
        ) : null}
      </div>

      {tabla ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-filete-alto pt-2 text-xs text-muted-foreground">
          <span>{porEquipos
            ? 'Ranking mundial de selecciones de la FIE'
            : 'Ranking mundial individual de la FIE'}</span>
          <span>Temporada {tabla.season}</span>
          {tabla.actualizadoEl ? <span>Leído {formatDateEs(tabla.actualizadoEl)}</span> : null}
          {tabla.sourceUrl ? (
            <Button variant="link" size="sm" className="px-0 text-xs text-primary-text" asChild>
              <a href={tabla.sourceUrl} target="_blank" rel="noreferrer">
                Ver la fuente
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            {/* «Mundial» y no «#»: el número no es el puesto en esta lista. */}
            <TableHead className="w-14 pl-0 text-right text-xs sm:w-16 sm:text-sm">Mundial</TableHead>
            {conBandera ? <TableHead className="hidden w-20 sm:table-cell">País</TableHead> : null}
            <TableHead>{porEquipos ? 'Selección' : 'Tirador'}</TableHead>
            {hayPruebas && !porEquipos ? (
              <TableHead className="hidden w-20 text-right sm:table-cell">
                Pruebas
              </TableHead>
            ) : null}
            <TableHead className="w-14 pr-0 text-right text-xs sm:w-20 sm:text-sm">Puntos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((fila) => (
            <Fila
              key={`${fila.fieId}-${fila.position ?? 'sc'}`}
              fila={fila}
              marca={marcaDe(fila, mios)}
              conBandera={conBandera}
              conPruebas={hayPruebas && !porEquipos}
              porEquipos={porEquipos}
            />
          ))}
        </TableBody>
      </Table>

      {filtradas.length === 0 && !cargando ? (
        <p className="medida text-sm text-muted-foreground">
          {busqueda
            ? 'Ningún nombre coincide. Prueba otro nombre o país.'
            : soloEspana
              ? 'España no tiene a nadie clasificado en esta prueba. Apaga «solo España» para ver el resto del mundo.'
              : 'La FIE no publica clasificación de esta prueba.'}
        </p>
      ) : null}

      {quedan > 0 ? (
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => setTope(tope + PASO)}
        >
          Ver {Math.min(quedan, PASO)} más de {filtradas.length}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Qué se marca y con qué fuerza.
 *
 * Tres niveles, porque son tres preguntas distintas en una tabla mundial:
 *
 *  - **`espanol`**: la fila es de España. En una lista con 136 países es LA
 *    señal que se busca, así que va con el fondo rojo tenue.
 *  - **`nuestro`**: además está en esta aplicación, o sea que es alguien de
 *    quien se siguen plazos e inscripciones. El puesto en rojo.
 *  - **`mio`**: y además es de quien está mirando. En negrita y con el
 *    distintivo «Tú» al lado, igual que en la tabla nacional: en una lista de
 *    mil nombres ni el color ni la negrita solos bastan para encontrarse, y el
 *    estado no puede comunicarse solo por color.
 */
function marcaDe(
  fila: FilaFie,
  mios: string[],
): { espanol: boolean; nuestro: boolean; mio: boolean } {
  return {
    espanol: fila.pais === 'ESP',
    nuestro: fila.athleteId !== null,
    mio: fila.athleteId !== null && mios.includes(fila.athleteId),
  };
}

function Fila({
  fila,
  marca,
  conBandera,
  conPruebas,
  porEquipos,
}: {
  fila: FilaFie;
  marca: { espanol: boolean; nuestro: boolean; mio: boolean };
  conBandera: boolean;
  conPruebas: boolean;
  porEquipos: boolean;
}) {
  return (
    <TableRow className={cn(marca.espanol && 'bg-marcado hover:bg-accent')}>
      <TableCell className="pl-0 text-right align-top">
        <span
          className={cn(
            'cifra text-2xl',
            marca.nuestro ? 'text-primary-text' : 'text-foreground',
          )}
        >
          {fila.position ?? '—'}
        </span>
      </TableCell>

      {conBandera ? (
        <TableCell className="hidden align-top sm:table-cell">
          <BanderaPais pais={fila.pais} tamaño="fila" />
        </TableCell>
      ) : null}

      <TableCell className="whitespace-normal align-top">
        {porEquipos ? (
          /*
            En selecciones la fila ES el país, y la FIE lo publica en inglés y
            en mayúsculas («HONG KONG, CHINA»). Se escribe tal cual: traducir
            nombres de país a mano es la clase de tabla que se queda vieja.
          */
          <span className={cn('min-w-0', marca.espanol && 'font-semibold')}>
            {fila.paisNombre ?? fila.pais ?? '—'}
          </span>
        ) : fila.fichaUrl ? (
          <a
            href={fila.fichaUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex min-h-[44px] min-w-0 items-center gap-1.5 whitespace-normal hover:underline',
              marca.mio && 'font-semibold',
            )}
          >
            <span className="min-w-0 break-words">{fila.nombre ?? `FIE ${fila.fieId}`}</span>
            <ExternalLink
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </a>
        ) : (
          <span className={cn(marca.mio && 'font-semibold')}>
            {fila.nombre ?? `FIE ${fila.fieId}`}
          </span>
        )}
        {marca.mio ? (
          <Badge
            variant="outline"
            className="ml-2 border-primary/50 align-middle text-primary-text"
          >
            Tú
          </Badge>
        ) : null}
        {conBandera ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
            <BanderaPais pais={fila.pais} tamaño="fila" />
            <span className="min-w-0 break-words">{fila.paisNombre ?? fila.pais ?? 'País no publicado'}</span>
          </span>
        ) : null}
        {/* Las pruebas, cuando la columna está escondida en el móvil. */}
        {conPruebas && fila.eventCount !== null ? (
          <span className="block text-xs text-muted-foreground sm:hidden">
            {fila.eventCount} {fila.eventCount === 1 ? 'prueba' : 'pruebas'}
          </span>
        ) : null}
      </TableCell>

      {conPruebas ? (
        <TableCell className="hidden text-right align-top sm:table-cell">
          <span className="cifra text-sm text-muted-foreground">
            {fila.eventCount ?? '—'}
          </span>
        </TableCell>
      ) : null}

      <TableCell className="pr-0 text-right align-top">
        <span className="cifra font-medium">
          {fila.points === null ? '—' : puntos(fila.points)}
        </span>
      </TableCell>
    </TableRow>
  );
}
