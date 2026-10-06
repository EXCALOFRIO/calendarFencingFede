'use client';

import { ExternalLink, Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { BurbujaOlimpica } from '@/components/olimpica/burbuja-olimpica';
import { FiltroOlimpico } from '@/components/olimpica/filtro-olimpico';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type {
  FilaFie,
  FormatoClasificacion,
  GrupoClasificacion,
  RankingGroupKey,
} from '@/lib/queries/ranking';
import { nombreCasa } from '@/lib/nombres';
import { ordenarSoloJjoo } from '@/lib/ranking/olimpica';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import { cn, formatDateEs } from '@/lib/utils';
import { FilaLinea } from './fila-linea';
import { clave } from './formato';
import { SelectoresGrupo } from './selectores-grupo';

/** Filas por tanda. Igual que en la tabla oficial. */
const PASO = 50;

/**
 * ===========================================================================
 * EL RANKING INTERNACIONAL DE LA FIE
 * ===========================================================================
 *
 * «Internacional» y nunca «Mundial»: «Mundial» es el Campeonato del Mundo.
 *
 * Dos clasificaciones y dos filtros:
 *
 *  - **Individual / Selecciones**, que son `type=I` y `type=E` de la FIE.
 *  - **«Solo España», APAGADO de entrada**: lo primero que se ve es el mundo.
 *    Encendido, la misma tabla con sus puestos intactos: el 13 sigue siendo
 *    el 13, no pasa a ser el 1.
 *  - **«Solo JJOO»**, sólo en las seis pruebas olímpicas (absoluto, masculino
 *    o femenino): quien entra hoy en Los Ángeles 2028 o está cerca, en el
 *    orden de `ordenarSoloJjoo`. La marca va en cada fila, detrás del nombre
 *    (`BurbujaOlimpica`), con el filtro encendido o no. Se recuerda en la URL
 *    (`?jjoo=1`) para poder compartir el enlace.
 *
 * Se pide un grupo a la vez (el más grande son ~1.250 filas): el de arranque
 * viene pintado del servidor y cambiar de arma pide sólo ese grupo, con sus
 * marcas olímpicas y la persona de cada fila (`completarTablaFie`).
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
  primeraTabla: TablaFieCompleta | null;
  mios: string[];
  /** Acción de servidor que trae un grupo. */
  cargar: (p: {
    format: FormatoClasificacion;
    weapon: RankingGroupKey['weapon'];
    gender: RankingGroupKey['gender'];
    category: RankingGroupKey['category'];
  }) => Promise<TablaFieCompleta | null>;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const parametros = useSearchParams();
  const [format, setFormat] = React.useState<FormatoClasificacion>(inicial.format);
  const [grupo, setGrupo] = React.useState<RankingGroupKey>({
    weapon: inicial.weapon,
    gender: inicial.gender,
    category: inicial.category,
  });
  const [tabla, setTabla] = React.useState<TablaFieCompleta | null>(primeraTabla);
  const [cargando, setCargando] = React.useState(false);
  const [soloEspana, setSoloEspana] = React.useState(false);
  const [jjooPedido, setJjooPedido] = React.useState(() => parametros.get('jjoo') === '1');
  const [busqueda, setBusqueda] = React.useState('');
  const [tope, setTope] = React.useState(PASO);

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
    setGrupo({ weapon: destino.weapon, gender: destino.gender, category: destino.category });
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
    const siguiente = { weapon: destino.weapon, gender: destino.gender, category: destino.category };
    setGrupo(siguiente);
    void pedir(format, siguiente);
  };

  const porEquipos = format === 'EQUIPOS';
  const olimpica = tabla?.olimpica ?? null;
  // Fuera de las pruebas olímpicas el `?jjoo=1` se ignora y el conmutador no se pinta.
  const soloJjoo = jjooPedido && olimpica !== null;

  const cambiarJjoo = (activo: boolean) => {
    setJjooPedido(activo);
    const siguiente = new URLSearchParams(parametros.toString());
    if (activo) siguiente.set('jjoo', '1');
    else siguiente.delete('jjoo');
    const consulta = siguiente.toString();
    router.replace(consulta ? `${ruta}?${consulta}` : ruta, { scroll: false });
  };

  const anotacionDe = React.useCallback(
    (r: FilaFie) => (porEquipos ? olimpica?.equipos[r.pais ?? ''] : olimpica?.individual[String(r.fieId)]),
    [olimpica, porEquipos],
  );

  const conJjoo = React.useMemo(() => {
    if (!olimpica) return [];
    const base = (tabla?.rows ?? []).filter((r) => !soloEspana || r.pais === 'ESP');
    return ordenarSoloJjoo(base, (r) => ({ anotacion: anotacionDe(r), posicion: r.position }));
  }, [tabla, olimpica, soloEspana, anotacionDe]);

  const filtradas = React.useMemo(() => {
    let f = soloJjoo ? conJjoo : (tabla?.rows ?? []).filter((r) => !soloEspana || r.pais === 'ESP');
    if (busqueda) {
      f = f.filter(
        (r) =>
          nombreCasa(r.nombre ?? '', busqueda) ||
          nombreCasa(r.paisNombre ?? '', busqueda) ||
          nombreCasa(r.pais ?? '', busqueda),
      );
    }
    return f;
  }, [tabla, soloEspana, soloJjoo, conJjoo, busqueda]);

  /**
   * Buscando o filtrando se enseña TODO lo que casa, sin «ver más»: quien
   * escribe un nombre quiere ese nombre.
   */
  const recorta = !busqueda && !soloEspana && !soloJjoo;
  const visibles = recorta ? filtradas.slice(0, tope) : filtradas;
  const quedan = filtradas.length - visibles.length;
  const conBandera = !soloEspana;

  const interruptores = (
    <>
      {/* Interruptor y no pastilla: «España» no es una categoría más. */}
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm">
        <Switch checked={soloEspana} onCheckedChange={setSoloEspana} aria-label="Enseñar solo España" />
        <span className={cn(soloEspana ? 'text-foreground' : 'text-muted-foreground')}>
          Solo España
          {tabla ? (
            <span className="ml-1.5 text-muted-foreground tabular-nums">
              ({tabla.espanoles} de {tabla.rows.length})
            </span>
          ) : null}
        </span>
      </label>
      {olimpica ? <FiltroOlimpico activo={soloJjoo} onCambio={cambiarJjoo} cuantos={conJjoo.length} /> : null}
      {cargando ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Cargando la clasificación…
        </span>
      ) : null}
    </>
  );

  return (
    <div className="ranking flex min-w-0 flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={format}
        onValueChange={(v) => v && cambiarFormato(v as FormatoClasificacion)}
        aria-label="Qué clasificación internacional"
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
        despues={interruptores}
      />

      {tabla ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-filete-alto pt-2 text-xs text-muted-foreground">
          <span>{porEquipos ? 'Ranking internacional de selecciones · FIE' : 'Ranking internacional individual · FIE'}</span>
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

      {visibles.length > 0 ? (
        <ol
          aria-label={porEquipos ? 'Ranking internacional de selecciones' : 'Ranking internacional individual'}
          className="grid w-full min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border"
        >
          {visibles.map((fila) => {
            const mio = fila.athleteId !== null && mios.includes(fila.athleteId);
            return (
              <FilaLinea
                key={`${fila.fieId}-${fila.position ?? 'sc'}`}
                puesto={fila.position}
                nombre={porEquipos ? (fila.paisNombre ?? fila.pais ?? '—') : (fila.nombre ?? `FIE ${fila.fieId}`)}
                personaId={porEquipos ? null : (tabla?.personas[String(fila.fieId)] ?? null)}
                enlaceExterno={porEquipos ? null : fila.fichaUrl}
                pais={conBandera || porEquipos ? fila.pais : null}
                puntos={fila.points}
                mio={mio}
                resaltada={fila.pais === 'ESP'}
                sinRetrato={porEquipos}
                tras={anotacionDe(fila)?.estado ? (
                  <BurbujaOlimpica anotacion={anotacionDe(fila)} fechaRanking={olimpica?.fechaRanking ?? null} compacta className="shrink-0" />
                ) : undefined}
              />
            );
          })}
        </ol>
      ) : null}

      {filtradas.length === 0 && !cargando ? (
        <p className="medida text-sm text-muted-foreground">
          {busqueda
            ? 'Ningún nombre coincide. Prueba otro nombre o país.'
            : soloJjoo
              ? 'Nadie de esta lista entra hoy ni está cerca de entrar en los Juegos.'
              : soloEspana
                ? 'España no tiene a nadie clasificado en esta prueba. Apaga «Solo España» para ver el resto.'
                : 'La FIE no publica clasificación de esta prueba.'}
        </p>
      ) : null}

      {quedan > 0 ? (
        <Button variant="outline" className="h-11 w-full" onClick={() => setTope(tope + PASO)}>
          Ver {Math.min(quedan, PASO)} más de {filtradas.length}
        </Button>
      ) : null}
    </div>
  );
}
