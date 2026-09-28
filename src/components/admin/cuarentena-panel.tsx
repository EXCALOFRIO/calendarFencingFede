'use client';

import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type { FilaCuarentena } from '@/app/(app)/admin/consultas';
import {
  reabrirCuarentena,
  resolverCuarentena,
  resolverVarias,
} from '@/app/(app)/admin/cuarentena/actions';
import { Vacio } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SOURCE_LABEL, cn, formatDateTimeEs } from '@/lib/utils';

/**
 * Cuarentena.
 *
 * Lo que no valida NO entra en el calendario. Un dato dudoso visible es
 * infinitamente mejor que un dato malo publicado, así que aquí se enseña
 * exactamente qué venía mal y qué se leyó, sin resumir.
 *
 * «Revisada» quiere decir «ya la he mirado», no «el dato ha entrado»: la fila
 * no se borra nunca porque es la prueba con la que se arregla el scraper.
 */

type ErrorValidacion = { path?: string; message?: string };

function errores(valor: unknown): ErrorValidacion[] {
  if (Array.isArray(valor)) return valor as ErrorValidacion[];
  if (valor && typeof valor === 'object') return [valor as ErrorValidacion];
  return [];
}

/**
 * El mensaje de Zod, en corto y sin la lista de opciones.
 *
 * Medido: `/admin/cuarentena` en un iPhone medía 33.678 px, y casi todo era el
 * mismo párrafo repetido. Una fila con veinte pruebas malas imprimía veinte
 * veces «Invalid option: expected one of "M9"|"M11"|"M13"|"M14"|"M15"|"M17"|
 * "M20"|"M23"|"ABS"|"V1"…», que además no cabe en 393 px porque es una sola
 * palabra sin espacios y se sale por la derecha.
 *
 * Esa lista no dice nada que no se sepa: las categorías válidas son las de la
 * aplicación. Lo que hace falta saber es DÓNDE falló y QUÉ llegó. Así que se
 * resume el mensaje y el volcado entero sigue estando a un toque, en «Ver lo
 * que se leyó», que es donde se puede leer sin romper la maquetación.
 */
function mensajeCorto(texto: string): string {
  const enumeracion = /^Invalid (option|enum value)[:,]?\s*expected one of\s*/i;
  if (enumeracion.test(texto)) return 'valor que no reconocemos';

  const recibido = /invalid_type|expected .* received/i;
  if (recibido.test(texto)) return texto.replace(/\s+/g, ' ').slice(0, 90);

  return texto.replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * El camino del error, en español y sin el índice.
 *
 * `competitions.6.category` es exacto pero no se lee: agrupar catorce errores
 * iguales exige quitar el índice, y el primer intento lo sustituía por un
 * punto medio (`competitions.·.category`). Visto en la captura, ese punto se
 * lee como una errata, no como «cualquiera».
 *
 * Así que se traduce lo que se conoce —son cuatro campos, y son siempre los
 * mismos— y lo que no, se deja en monoespaciado con `[]` en el hueco del
 * índice, que es la convención de toda la vida para «cualquier elemento».
 */
const CAMPO_EN_ESPANOL: Record<string, string> = {
  'competitions[].category': 'la categoría de una prueba',
  'competitions[].weapon': 'el arma de una prueba',
  'competitions[].gender': 'el género de una prueba',
  'competitions[].format': 'individual o por equipos',
  'competitions[].startDate': 'la fecha de una prueba',
  startDate: 'la fecha de inicio',
  endDate: 'la fecha de fin',
  name: 'el nombre de la competición',
  country: 'el país',
  city: 'la ciudad',
};

function campoDe(path: string): { clave: string; humano: string | null } {
  const clave = path.replace(/\.\d+\./g, '[].').replace(/\.\d+$/, '[]');
  return { clave, humano: CAMPO_EN_ESPANOL[clave] ?? null };
}

type ErrorAgrupado = {
  campo: string;
  humano: string | null;
  mensaje: string;
  cuantos: number;
};

/**
 * Los errores de una fila, agrupados por campo y mensaje.
 *
 * De veinte líneas idénticas sale una con su cuenta. El detalle exacto de cada
 * una no se pierde: está en el volcado, con el índice y todo.
 */
function agrupar(lista: ErrorValidacion[]): ErrorAgrupado[] {
  const mapa = new Map<string, ErrorAgrupado>();

  for (const e of lista) {
    const { clave: campo, humano } = campoDe(e.path ?? '');
    const mensaje = mensajeCorto(e.message ?? 'error sin mensaje');
    const clave = `${campo}|${mensaje}`;
    const actual = mapa.get(clave);
    if (actual) actual.cuantos += 1;
    else mapa.set(clave, { campo, humano, mensaje, cuantos: 1 });
  }

  return [...mapa.values()].sort((a, b) => b.cuantos - a.cuantos);
}

/** Lo poco que se puede enseñar de un payload sin saber su forma. */
function resumenPayload(valor: unknown): {
  nombre: string | null;
  url: string | null;
  fechas: string | null;
} {
  if (!valor || typeof valor !== 'object') {
    return { nombre: null, url: null, fechas: null };
  }
  const p = valor as Record<string, unknown>;
  const texto = (clave: string) => (typeof p[clave] === 'string' ? (p[clave] as string) : null);
  const inicio = texto('startDate');
  const fin = texto('endDate');

  return {
    nombre: texto('name') ?? texto('title'),
    url: texto('sourceUrl') ?? texto('pdfUrl'),
    fechas: inicio ? (fin && fin !== inicio ? `${inicio} → ${fin}` : inicio) : null,
  };
}

/**
 * Cuántas filas se pintan de golpe. «Ver más» añade otro tanto.
 *
 * Con las 67 pendientes de hoy la pantalla medía 33.678 px en un iPhone: 86
 * pantallas de desplazamiento para una lista en la que se trabaja de arriba
 * abajo. Doce llenan tres pantallas, que es lo que se revisa de una sentada.
 */
const PASO = 12;

export function CuarentenaPanel({ filas }: { filas: FilaCuarentena[] }) {
  const router = useRouter();
  const [pestana, setPestana] = React.useState<'pendientes' | 'revisadas'>('pendientes');
  const [elegidas, setElegidas] = React.useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = React.useState(false);
  const [tope, setTope] = React.useState(PASO);

  const pendientes = filas.filter((f) => !f.resolvedAt);
  const revisadas = filas.filter((f) => f.resolvedAt);
  const delMonton = pestana === 'pendientes' ? pendientes : revisadas;
  const visibles = delMonton.slice(0, tope);
  const quedan = delMonton.length - visibles.length;

  React.useEffect(() => {
    setElegidas(new Set());
    setTope(PASO);
  }, [pestana]);

  async function ejecutar(accion: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setOcupado(true);
    try {
      const resultado = await accion();
      if (resultado.ok) {
        toast.success(resultado.message ?? 'Hecho.');
        setElegidas(new Set());
        router.refresh();
      } else {
        toast.error(resultado.error ?? 'No se ha podido aplicar.');
      }
    } catch {
      toast.error('No se ha podido aplicar el cambio. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={pestana}
          onValueChange={(v) => v && setPestana(v as 'pendientes' | 'revisadas')}
          variant="outline"
          size="sm"
          spacing={1}
          className="max-w-full flex-wrap"
        >
          <ToggleGroupItem value="pendientes" className="gap-1.5">
            Pendientes
            <span className="cifra text-xs text-muted-foreground">
              {pendientes.length}
            </span>
          </ToggleGroupItem>
          <ToggleGroupItem value="revisadas" className="gap-1.5">
            Revisadas
            <span className="cifra text-xs text-muted-foreground">
              {revisadas.length}
            </span>
          </ToggleGroupItem>
        </ToggleGroup>

        {elegidas.size > 0 ? (
          <Button
            size="sm"
            disabled={ocupado}
            onClick={() => ejecutar(() => resolverVarias([...elegidas]))}
          >
            {ocupado ? <Loader2 className="animate-spin" /> : null}
            Marcar {elegidas.size} como revisadas
          </Button>
        ) : null}

        {/*
          Cuántas se están viendo de cuántas. Sin esto, con doce filas en
          pantalla y sesenta y siete en el montón, parecía que faltaban.
        */}
        {delMonton.length > visibles.length ? (
          <span className="text-xs text-muted-foreground">
            <span className="cifra text-foreground">{visibles.length}</span> de{' '}
            <span className="cifra text-foreground">{delMonton.length}</span>
          </span>
        ) : null}
      </div>

      {visibles.length === 0 ? (
        <Vacio
          titulo={
            pestana === 'pendientes'
              ? 'Nada pendiente de revisar'
              : 'Todavía no has revisado ninguna'
          }
          explicacion={
            pestana === 'pendientes'
              ? 'Cuando la ingestión lea una competición que no valide, la fila aparecerá aquí con el motivo exacto en lugar de entrar al calendario a medias.'
              : 'Las filas que marques como revisadas se quedan guardadas aquí: son la prueba de qué venía mal y con qué se arregla el scraper.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visibles.map((fila) => {
            const lista = errores(fila.validationErrors);
            const agrupados = agrupar(lista);
            const resumen = resumenPayload(fila.rawPayload);

            return (
              <li
                key={fila.id}
                className="min-w-0 rounded-lg border-t border-filete bg-card"
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3">
                  {pestana === 'pendientes' ? (
                    <Checkbox
                      checked={elegidas.has(fila.id)}
                      onCheckedChange={() =>
                        setElegidas((previas) => {
                          const siguiente = new Set(previas);
                          if (siguiente.has(fila.id)) siguiente.delete(fila.id);
                          else siguiente.add(fila.id);
                          return siguiente;
                        })
                      }
                      aria-label="Seleccionar esta fila"
                      className="mt-1.5"
                    />
                  ) : null}

                  <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                    {/*
                      EL NOMBRE PRIMERO Y ENTERO, LA FUENTE DEBAJO.

                      Estaba la pastilla de la fuente delante y el nombre
                      detrás con `truncate`: en un iPhone se leía «Skermo ·
                      autonómica» a tamaño normal y del nombre de la
                      competición —que es lo que identifica la fila— la mitad.
                      Se ha invertido la jerarquía: manda el nombre.
                    */}
                    <span className="min-w-0 break-words text-[0.95rem] font-medium leading-tight">
                      {resumen.nombre ?? fila.sourceId ?? 'Fila sin identificar'}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-normal">
                        {SOURCE_LABEL[fila.source] ?? fila.source}
                      </Badge>
                      {agrupados.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          <span className="cifra text-danger">
                            {agrupados.reduce((n, e) => n + e.cuantos, 0)}
                          </span>{' '}
                          {agrupados.reduce((n, e) => n + e.cuantos, 0) === 1
                            ? 'campo mal'
                            : 'campos mal'}
                        </span>
                      ) : null}
                    </div>

                    {/*
                      QUÉ VENÍA MAL, AGRUPADO Y SIN SALIRSE DE LA PANTALLA.

                      `break-words` no es opcional aquí: los caminos de Zod
                      (`competitions.14.category`) y los valores de la fuente
                      son palabras largas sin espacios, y sin esto se salían
                      por la derecha del móvil.
                    */}
                    <ul className="flex min-w-0 flex-col gap-1">
                      {agrupados.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                          La fuente no dejó detalle del error.
                        </li>
                      ) : (
                        agrupados.slice(0, 4).map((e) => (
                          <li
                            key={`${fila.id}-${e.campo}-${e.mensaje}`}
                            className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm"
                          >
                            {/*
                              En español lo que se sabe traducir, y el camino
                              exacto detrás y apagado: el primero sirve para
                              entender, el segundo para arreglar el scraper.
                            */}
                            <span className="min-w-0 break-words text-danger">
                              {e.humano ?? e.mensaje}
                            </span>
                            {/*
                              Sin alfa en el texto: `npm run contraste` mide
                              los tokens, no sus variantes translúcidas, y
                              `text-danger/80` a 12 px se queda por debajo de
                              AA sin que el guion lo cante.
                            */}
                            {e.humano ? (
                              <span className="text-xs text-danger">{e.mensaje}</span>
                            ) : null}
                            {e.cuantos > 1 ? (
                              <span className="text-xs text-muted-foreground">
                                <span className="cifra">{e.cuantos}</span> veces
                              </span>
                            ) : null}
                            {e.campo ? (
                              <span className="min-w-0 break-words font-mono text-[11px] text-muted-foreground">
                                {e.campo}
                              </span>
                            ) : null}
                          </li>
                        ))
                      )}
                      {agrupados.length > 4 ? (
                        <li className="text-xs text-muted-foreground">
                          y{' '}
                          <span className="cifra text-foreground">
                            {agrupados.length - 4}
                          </span>{' '}
                          más, en el volcado de abajo
                        </li>
                      ) : null}
                    </ul>

                    {/*
                      Cada dato con su rótulo, no encadenados con puntos
                      medios: `UI.md` § 3 bis lo cuenta entre los cinco rasgos
                      de «generado por IA» que el usuario rechazó.
                    */}
                    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        Leída el{' '}
                        <span className="tabular-nums">
                          {formatDateTimeEs(fila.createdAt)}
                        </span>
                      </span>
                      {resumen.fechas ? (
                        <span>
                          Fechas que traía{' '}
                          <span className="tabular-nums">{resumen.fechas}</span>
                        </span>
                      ) : null}
                      {fila.resolvedAt ? (
                        <span className="text-ok">
                          Revisada el{' '}
                          <span className="tabular-nums">
                            {formatDateTimeEs(fila.resolvedAt)}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {/*
                    En móvil las acciones van a la derecha de su propia fila, no
                    colgando a la izquierda debajo del texto: así el pulgar las
                    encuentra donde las espera y no compiten con el nombre.
                  */}
                  <div className="ms-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {resumen.url ? (
                      <Button variant="ghost" size="icon-sm" asChild>
                        <a
                          href={resumen.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir la ficha en la fuente"
                        >
                          <ExternalLink />
                        </a>
                      </Button>
                    ) : null}

                    {fila.resolvedAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => ejecutar(() => reabrirCuarentena(fila.id))}
                      >
                        Volver a pendiente
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => ejecutar(() => resolverCuarentena(fila.id))}
                      >
                        Marcar revisada
                      </Button>
                    )}
                  </div>
                </div>

                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="group/ver w-full justify-start rounded-none border-t text-xs text-muted-foreground"
                    >
                      <ChevronDown className="transition-transform group-data-[state=open]/ver:rotate-180" />
                      Ver lo que se leyó, con los errores enteros
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {/*
                      Los errores SIN resumir, y luego el volcado.

                      Arriba se agrupan y se acortan para que la lista se pueda
                      recorrer; aquí está el texto literal de la validación,
                      que es lo que hace falta para arreglar el scraper. Sin
                      esta parte, resumir sería perder la prueba.
                    */}
                    {lista.length > 0 ? (
                      <ul className="flex flex-col gap-1 border-t px-3 py-2">
                        {lista.map((e, i) => (
                          <li
                            key={`${fila.id}-crudo-${i}`}
                            className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-danger"
                          >
                            {e.path ? `${e.path}: ` : ''}
                            {e.message ?? 'error sin mensaje'}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <pre
                      className={cn(
                        'max-h-72 overflow-auto border-t px-3 py-2 font-mono text-xs leading-relaxed',
                        'whitespace-pre-wrap break-all text-muted-foreground',
                      )}
                    >
                      {JSON.stringify(fila.rawPayload, null, 2)}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      )}

      {quedan > 0 ? (
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => setTope((n) => n + PASO)}
        >
          Ver {Math.min(quedan, PASO)} más
          <span className="cifra text-xs text-muted-foreground">{quedan}</span>
        </Button>
      ) : null}
    </div>
  );
}
