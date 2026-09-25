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

export function CuarentenaPanel({ filas }: { filas: FilaCuarentena[] }) {
  const router = useRouter();
  const [pestana, setPestana] = React.useState<'pendientes' | 'revisadas'>('pendientes');
  const [elegidas, setElegidas] = React.useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = React.useState(false);

  const pendientes = filas.filter((f) => !f.resolvedAt);
  const revisadas = filas.filter((f) => f.resolvedAt);
  const visibles = pestana === 'pendientes' ? pendientes : revisadas;

  React.useEffect(() => {
    setElegidas(new Set());
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
            const resumen = resumenPayload(fila.rawPayload);

            return (
              <li key={fila.id} className="min-w-0 rounded-lg border bg-card">
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
                      className="mt-1"
                    />
                  ) : null}

                  <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-normal">
                        {SOURCE_LABEL[fila.source] ?? fila.source}
                      </Badge>
                      <span className="min-w-0 truncate text-sm font-medium">
                        {resumen.nombre ?? fila.sourceId ?? 'Fila sin identificar'}
                      </span>
                    </div>

                    <ul className="flex flex-col gap-0.5">
                      {lista.length === 0 ? (
                        <li className="text-sm text-muted-foreground">
                          La fuente no dejó detalle del error.
                        </li>
                      ) : (
                        lista.map((e, i) => (
                          <li
                            key={`${fila.id}-${i}`}
                            className="text-sm text-danger"
                          >
                            {e.path ? (
                              <span className="font-mono text-xs">{e.path}: </span>
                            ) : null}
                            {e.message ?? 'Error sin mensaje.'}
                          </li>
                        ))
                      )}
                    </ul>

                    <p className="text-xs text-muted-foreground">
                      Leída el {formatDateTimeEs(fila.createdAt)}
                      {resumen.fechas ? ` · fechas en la fuente: ${resumen.fechas}` : ''}
                      {fila.resolvedAt
                        ? ` · revisada el ${formatDateTimeEs(fila.resolvedAt)}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                      Ver lo que se leyó
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre
                      className={cn(
                        'max-h-72 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed',
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
    </div>
  );
}
