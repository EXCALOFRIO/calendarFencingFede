'use client';

import { Check, ExternalLink, Loader2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type {
  ResultadoSinEmparejar,
  TiradorParaEmparejar,
} from '@/app/(app)/admin/consultas';
import {
  asignarResultado,
  asignarTodosConEseNombre,
  desasignarResultado,
} from '@/app/(app)/admin/emparejar/actions';
import { Vacio } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  CATEGORY_LABEL,
  WEAPON_LABEL,
  formatDateEs,
  titular,
  yearFromIsoDate,
} from '@/lib/utils';

/**
 * Cola de resultados sin dueño.
 *
 * Llegan de Skermo con el nombre tal y como lo escribe la fuente y, a veces,
 * con licencia. El emparejado por nombre NO se hace automáticamente —hay
 * homónimos y los acentos van a su aire—, así que aquí decide una persona.
 *
 * Lo que sí se automatiza es la consecuencia: al asignar se ofrece guardar la
 * licencia en la ficha del tirador, y a partir de ese momento sus resultados
 * se emparejan solos. Es la diferencia entre resolver 80 filas una vez y
 * resolverlas cada semana.
 */
export function EmparejarPanel({
  resultados,
  tiradores,
  yaEmparejados,
}: {
  resultados: ResultadoSinEmparejar[];
  tiradores: TiradorParaEmparejar[];
  yaEmparejados: number;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = React.useState('');
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  const visibles = React.useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return resultados;
    return resultados.filter(
      (r) =>
        r.sourceAthleteName.toLowerCase().includes(texto) ||
        (r.sourceClub ?? '').toLowerCase().includes(texto) ||
        (r.sourceLicense ?? '').toLowerCase().includes(texto) ||
        (r.eventoNombre ?? '').toLowerCase().includes(texto),
    );
  }, [resultados, busqueda]);

  const grupos = React.useMemo(() => {
    const mapa = new Map<string, ResultadoSinEmparejar[]>();
    for (const r of visibles) {
      const clave = r.eventoNombre ?? 'Sin evento enlazado';
      const lista = mapa.get(clave) ?? [];
      lista.push(r);
      mapa.set(clave, lista);
    }
    return [...mapa.entries()].map(([evento, filas]) => ({
      evento,
      fecha: filas[0]?.eventoInicio ?? null,
      filas: [...filas].sort((a, b) => a.position - b.position),
    }));
  }, [visibles]);

  /** Cuántas filas comparten exactamente el mismo nombre de origen. */
  const repeticiones = React.useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const r of resultados) {
      cuenta.set(r.sourceAthleteName, (cuenta.get(r.sourceAthleteName) ?? 0) + 1);
    }
    return cuenta;
  }, [resultados]);

  async function asignar(
    fila: ResultadoSinEmparejar,
    tirador: TiradorParaEmparejar,
    guardarLicencia: boolean,
    todas: boolean,
  ) {
    setOcupado(fila.id);
    try {
      const resultado = todas
        ? await asignarTodosConEseNombre(fila.sourceAthleteName, tirador.id)
        : await asignarResultado(fila.id, tirador.id, { guardarLicencia });

      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }

      toast.success(resultado.message, {
        action: todas
          ? undefined
          : {
              label: 'Deshacer',
              onClick: async () => {
                const vuelta = await desasignarResultado(fila.id);
                if (vuelta.ok) {
                  toast.success(vuelta.message);
                  router.refresh();
                } else {
                  toast.error(vuelta.error);
                }
              },
            },
      });
      router.refresh();
    } catch {
      toast.error('No se ha podido asignar el resultado. Vuelve a intentarlo.');
    } finally {
      setOcupado(null);
    }
  }

  if (resultados.length === 0) {
    return (
      <Vacio
        titulo="No queda ningún resultado por asignar"
        explicacion={
          yaEmparejados > 0
            ? `Los ${yaEmparejados} resultados leídos están asignados a un tirador y cuentan en el ranking. Cuando entre uno sin licencia reconocible, aparecerá aquí.`
            : 'Cuando la ingestión lea resultados que no pueda asignar por licencia, aparecerán aquí para asignarlos a mano.'
        }
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar nombre, licencia, club o prueba"
          className="h-8 w-full sm:w-72"
          aria-label="Buscar en la cola de emparejado"
        />
        <span className="text-xs text-muted-foreground">
          {visibles.length} de {resultados.length} sin emparejar
          {yaEmparejados > 0 ? ` · ${yaEmparejados} ya asignados` : ''}
        </span>
      </div>

      {grupos.length === 0 ? (
        <Vacio
          titulo="Ninguno coincide con esa búsqueda"
          explicacion={`Ningún resultado pendiente contiene «${busqueda}». Borra la búsqueda para ver los ${resultados.length} que quedan.`}
        />
      ) : null}

      {grupos.map((grupo) => (
        <section key={grupo.evento} className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-base">{titular(grupo.evento)}</h2>
            <span className="text-xs text-muted-foreground">
              {grupo.fecha ? `${formatDateEs(grupo.fecha)} · ` : ''}
              {grupo.filas.length} sin emparejar
            </span>
          </div>

          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {grupo.filas.map((fila) => (
              <li
                key={fila.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3"
              >
                <span
                  className="cifra w-8 shrink-0 text-xl text-muted-foreground"
                  aria-label={`Puesto ${fila.position}`}
                >
                  {fila.position}
                </span>

                <div className="flex min-w-40 flex-1 flex-col">
                  <span className="font-medium">{titular(fila.sourceAthleteName)}</span>
                  {/* Cada dato en su hueco, no encadenados con puntos. */}
                  <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {fila.sourceLicense
                        ? `Licencia ${fila.sourceLicense}`
                        : 'La fuente no publica licencia'}
                    </span>
                    {fila.sourceClub ? <span>{fila.sourceClub}</span> : null}
                    {fila.weapon ? (
                      <span>
                        {WEAPON_LABEL[fila.weapon as keyof typeof WEAPON_LABEL]}
                        {fila.category
                          ? ` ${CATEGORY_LABEL[fila.category as keyof typeof CATEGORY_LABEL] ?? fila.category}`
                          : ''}
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {fila.sourceUrl ? (
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a
                        href={fila.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Ver el resultado en la fuente"
                      >
                        <ExternalLink />
                      </a>
                    </Button>
                  ) : null}

                  <SelectorTirador
                    fila={fila}
                    tiradores={tiradores}
                    repeticiones={repeticiones.get(fila.sourceAthleteName) ?? 1}
                    ocupado={ocupado === fila.id}
                    onElegir={asignar}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Selector de tirador.
 *
 * El buscador va dentro del desplegable y no en la fila: con 80 filas, 80
 * campos de búsqueda montados a la vez es lo que convierte una pantalla en
 * una que tarda tres segundos en responder al teclado.
 */
function SelectorTirador({
  fila,
  tiradores,
  repeticiones,
  ocupado,
  onElegir,
}: {
  fila: ResultadoSinEmparejar;
  tiradores: TiradorParaEmparejar[];
  repeticiones: number;
  ocupado: boolean;
  onElegir: (
    fila: ResultadoSinEmparejar,
    tirador: TiradorParaEmparejar,
    guardarLicencia: boolean,
    todas: boolean,
  ) => Promise<void>;
}) {
  const [abierto, setAbierto] = React.useState(false);
  const [guardarLicencia, setGuardarLicencia] = React.useState(
    Boolean(fila.sourceLicense),
  );
  const [todas, setTodas] = React.useState(false);

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={ocupado}>
          {ocupado ? <Loader2 className="animate-spin" /> : <UserPlus />}
          Asignar a…
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex flex-col gap-2 border-b px-3 py-2.5">
          <p className="text-xs text-muted-foreground">
            Asignando el puesto {fila.position} de{' '}
            <span className="text-foreground">{titular(fila.sourceAthleteName)}</span>.
          </p>

          {fila.sourceLicense ? (
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor={`licencia-${fila.id}`}
                className="text-xs leading-tight font-normal text-muted-foreground"
              >
                Guardar la licencia {fila.sourceLicense} en su ficha
              </Label>
              <Switch
                id={`licencia-${fila.id}`}
                checked={guardarLicencia}
                onCheckedChange={setGuardarLicencia}
              />
            </div>
          ) : null}

          {repeticiones > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor={`todas-${fila.id}`}
                className="text-xs leading-tight font-normal text-muted-foreground"
              >
                Asignar los {repeticiones} resultados con este mismo nombre
              </Label>
              <Switch id={`todas-${fila.id}`} checked={todas} onCheckedChange={setTodas} />
            </div>
          ) : null}
        </div>

        <Command>
          <CommandInput placeholder="Buscar tirador…" />
          <CommandList>
            <CommandEmpty>
              Nadie con ese nombre. Si la ficha no existe todavía, créala en Gestión ›
              Usuarios y vuelve aquí.
            </CommandEmpty>
            <CommandGroup>
              {tiradores.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.nombre} ${t.clubNombre ?? ''} ${t.rfeeLicense ?? ''}`}
                  onSelect={async () => {
                    setAbierto(false);
                    await onElegir(fila, t, guardarLicencia, todas);
                  }}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="flex-1 truncate">{t.nombre}</span>
                    {t.rfeeLicense === fila.sourceLicense && fila.sourceLicense ? (
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <Check className="size-3" aria-hidden /> Misma licencia
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex w-full flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>{yearFromIsoDate(t.birthDate)}</span>
                    {t.clubNombre ? (
                      <span className="min-w-0 truncate">{t.clubNombre}</span>
                    ) : null}
                    <span>
                      {t.rfeeLicense
                        ? `Licencia ${t.rfeeLicense}`
                        : 'sin licencia'}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
