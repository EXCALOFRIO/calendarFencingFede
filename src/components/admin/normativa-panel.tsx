'use client';

import { CalendarRange, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import type {
  CategoriaFila,
  Normativa,
  PlazoFila,
  ReglaRankingFila,
} from '@/app/(app)/admin/consultas';
import {
  borrarCategoria,
  borrarPlazo,
  borrarReglaRanking,
  crearTemporada,
  guardarCategoria,
  guardarPlazo,
  guardarReglaRanking,
  marcarTemporadaActual,
} from '@/app/(app)/admin/normativa/actions';
import { CampoFecha } from '@/components/admin/campo-fecha';
import {
  EditorPares,
  type Par,
  paresAJson,
  paresDesde,
} from '@/components/admin/editor-pares';
import { Procedencia, Vacio } from '@/components/admin/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toCampoFecha } from '@/lib/callups/fechas';
import {
  CATEGORY_LABEL,
  CIRCUIT_LABEL,
  WEAPON_LABEL,
  formatDateEs,
  formatEur,
} from '@/lib/utils';

/**
 * Normativa configurable.
 *
 * Ningún número de la normativa vive en el código: los plazos, los recargos,
 * los años de nacimiento de cada categoría y los coeficientes del ranking se
 * editan aquí. El motivo es que la normativa de la RFEE cambia cada
 * temporada, y con los importes escritos en un `.ts` cambiarlos exige tocar
 * código y desplegar.
 *
 * Por eso cada valor enseña SIEMPRE de qué documento sale y de cuándo es. Un
 * importe sin procedencia no se puede defender cuando un club lo discute, y
 * ese es el momento en que hace falta.
 */

const AMBITOS = [
  { valor: 'NACIONAL', etiqueta: 'Nacional' },
  { valor: 'INTERNACIONAL', etiqueta: 'Internacional' },
  { valor: 'AUTONOMICO', etiqueta: 'Autonómico' },
] as const;

const TIPOS_PLAZO = [
  { valor: 'L1', etiqueta: 'L1 · plazo ordinario' },
  { valor: 'L2', etiqueta: 'L2 · segundo plazo, con recargo' },
  { valor: 'L3', etiqueta: 'L3 · tercer plazo, con recargo' },
  { valor: 'FIE_D7', etiqueta: 'FIE D-7 · cierre duro de la FIE' },
] as const;

const CUALQUIERA = '__cualquiera__';

const CIRCUITOS = Object.entries(CIRCUIT_LABEL).map(([valor, etiqueta]) => ({
  valor,
  etiqueta,
}));

const CATEGORIAS = Object.entries(CATEGORY_LABEL).map(([valor, etiqueta]) => ({
  valor,
  etiqueta,
}));

const ARMAS = Object.entries(WEAPON_LABEL).map(([valor, etiqueta]) => ({
  valor,
  etiqueta,
}));

type Editor =
  | { tipo: 'plazo'; fila: PlazoFila | null }
  | { tipo: 'categoria'; fila: CategoriaFila | null }
  | { tipo: 'ranking'; fila: ReglaRankingFila | null }
  | { tipo: 'temporada' }
  | null;

export function NormativaPanel({ normativa }: { normativa: Normativa }) {
  const router = useRouter();
  const [editor, setEditor] = React.useState<Editor>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [temporadaId, setTemporadaId] = React.useState(
    normativa.temporadaActual?.id ?? normativa.temporadas[0]?.id ?? '',
  );

  const temporada = normativa.temporadas.find((t) => t.id === temporadaId) ?? null;

  const plazos = normativa.plazos.filter((p) => p.seasonId === temporadaId);
  const categorias = normativa.categorias.filter((c) => c.seasonId === temporadaId);
  const reglas = normativa.reglasRanking.filter((r) => r.seasonId === temporadaId);

  async function ejecutar(
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    alTerminar?: () => void,
  ) {
    setOcupado(true);
    try {
      const resultado = await accion();
      if (resultado.ok) {
        toast.success(resultado.message ?? 'Guardado.');
        alTerminar?.();
        router.refresh();
      } else {
        toast.error(resultado.error ?? 'No se ha podido guardar.', { duration: 8000 });
      }
    } catch {
      toast.error('No se ha podido guardar. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
    }
  }

  if (normativa.temporadas.length === 0) {
    return (
      <>
        <Vacio
          titulo="Todavía no hay ninguna temporada"
          explicacion="Los plazos, las categorías y los coeficientes cuelgan de una temporada, así que lo primero es crearla con las fechas de la circular."
          accion={
            <Button size="sm" onClick={() => setEditor({ tipo: 'temporada' })}>
              <Plus /> Crear la temporada
            </Button>
          }
        />
        <SheetTemporada
          abierto={editor?.tipo === 'temporada'}
          ocupado={ocupado}
          onCerrar={() => setEditor(null)}
          onGuardar={(datos) => ejecutar(() => crearTemporada(datos), () => setEditor(null))}
        />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* Temporada: manda sobre todo lo de abajo, así que va arriba y sola. */}
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="temporada" className="text-sm text-muted-foreground">
          Temporada
        </Label>
        <Select value={temporadaId} onValueChange={setTemporadaId}>
          <SelectTrigger id="temporada" className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {normativa.temporadas.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
                {t.current ? ' · actual' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {temporada ? (
          <span className="text-xs text-muted-foreground">
            {formatDateEs(temporada.startDate)} – {formatDateEs(temporada.endDate)}
          </span>
        ) : null}

        {temporada && !temporada.current ? (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() => ejecutar(() => marcarTemporadaActual(temporada.id))}
          >
            Marcar como actual
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          onClick={() => setEditor({ tipo: 'temporada' })}
        >
          <CalendarRange /> Nueva temporada
        </Button>
      </div>

      <Tabs defaultValue="plazos">
        <TabsList className="no-scrollbar max-w-full overflow-x-auto">
          <TabsTrigger value="plazos">Plazos y recargos</TabsTrigger>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------ plazos --- */}
        <TabsContent value="plazos" className="flex flex-col gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="medida w-full text-sm text-muted-foreground sm:w-auto sm:flex-1">
              Días naturales antes del comienzo del evento. Lo que sale de aquí se marca
              siempre como estimado: si la fuente publica el plazo real de un evento, ese
              gana.
            </p>
            <Button
              size="sm"
              className="ms-auto"
              onClick={() => setEditor({ tipo: 'plazo', fila: null })}
            >
              <Plus /> Añadir plazo
            </Button>
          </div>

          {plazos.length === 0 ? (
            <Vacio
              titulo="Esta temporada no tiene plazos configurados"
              explicacion="Sin ellos, el semáforo del calendario no puede estimar cuándo cierra una inscripción y se queda en «sin plazo»."
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {plazos.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3"
                >
                  <div className="flex w-16 shrink-0 flex-col">
                    <span className="cifra text-2xl">{p.daysBefore}</span>
                    <span className="text-xs text-muted-foreground">
                      días antes
                    </span>
                  </div>

                  <div className="flex min-w-44 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.label}</span>
                      <Badge variant="secondary" className="font-normal">
                        {p.type}
                      </Badge>
                      {!p.active ? (
                        <Badge variant="outline" className="font-normal">
                          Desactivado
                        </Badge>
                      ) : null}
                      {p.blocking ? (
                        <Badge
                          variant="outline"
                          className="border-danger/40 font-normal text-danger"
                        >
                          Cierre duro
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {AMBITOS.find((a) => a.valor === p.scope)?.etiqueta ?? p.scope}
                      {p.circuit ? ` · ${CIRCUIT_LABEL[p.circuit] ?? p.circuit}` : ' · cualquier circuito'}
                      {p.category
                        ? ` · ${CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ?? p.category}`
                        : ' · cualquier categoría'}
                    </span>
                    <Procedencia
                      documento={p.sourceDocument}
                      url={p.sourceUrl}
                      fecha={p.updatedAt}
                    />
                    {p.actualizadoPor ? (
                      <span className="text-xs text-muted-foreground/80">
                        Último cambio: {p.actualizadoPor}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="cifra text-lg">
                      {p.blocking
                        ? 'sin recargo'
                        : p.surchargeEur === null
                          ? 'no publicado'
                          : formatEur(p.surchargeEur)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.blocking ? 'no se puede inscribir' : 'recargo'}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado}
                      onClick={() => setEditor({ tipo: 'plazo', fila: p })}
                    >
                      <Pencil /> Editar
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Borrar el plazo ${p.label}`}
                      disabled={ocupado}
                      onClick={() => ejecutar(() => borrarPlazo(p.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* -------------------------------------------------- categorías --- */}
        <TabsContent value="categorias" className="flex flex-col gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="medida w-full text-sm text-muted-foreground sm:w-auto sm:flex-1">
              Años de nacimiento inclusivos. La categoría de un tirador se deriva de
              aquí, nunca se escribe a mano en su ficha.
            </p>
            <Button
              size="sm"
              className="ms-auto"
              onClick={() => setEditor({ tipo: 'categoria', fila: null })}
            >
              <Plus /> Añadir categoría
            </Button>
          </div>

          {categorias.length === 0 ? (
            <Vacio
              titulo="Esta temporada no tiene categorías"
              explicacion="Sin ellas nadie tiene categoría asignada y el calendario no puede marcar qué pruebas le tocan a cada tirador."
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {categorias.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3"
                >
                  <span className="cifra w-14 shrink-0 text-xl">
                    {CATEGORY_LABEL[c.code as keyof typeof CATEGORY_LABEL] ?? c.code}
                  </span>

                  <div className="flex min-w-40 flex-1 flex-col gap-0.5">
                    <span className="text-sm">
                      {c.birthYearMin === null && c.birthYearMax === null
                        ? 'Sin franja de años definida'
                        : c.birthYearMin === null
                          ? `Nacidos hasta ${c.birthYearMax}`
                          : c.birthYearMax === null
                            ? `Nacidos desde ${c.birthYearMin}`
                            : `Nacidos entre ${c.birthYearMin} y ${c.birthYearMax}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Orden {c.rank} ·{' '}
                      {c.laddered
                        ? 'en la escalera: se puede subir, no bajar'
                        : 'fuera de la escalera'}
                    </span>
                    <Procedencia
                      documento={c.sourceDocument}
                      url={c.sourceUrl}
                      fecha={c.updatedAt}
                    />
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado}
                      onClick={() => setEditor({ tipo: 'categoria', fila: c })}
                    >
                      <Pencil /> Editar
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Borrar la categoría ${c.code}`}
                      disabled={ocupado}
                      onClick={() => ejecutar(() => borrarCategoria(c.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ----------------------------------------------------- ranking --- */}
        <TabsContent value="ranking" className="flex flex-col gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="medida w-full text-sm text-muted-foreground sm:w-auto sm:flex-1">
              Cuántas pruebas cuentan, cuántos puntos da cada puesto y cuánto multiplica
              cada circuito. El cálculo se enseña siempre abierto en el ranking.
            </p>
            <Button
              size="sm"
              className="ms-auto"
              onClick={() => setEditor({ tipo: 'ranking', fila: null })}
            >
              <Plus /> Añadir regla
            </Button>
          </div>

          {reglas.length === 0 ? (
            <Vacio
              titulo="Esta temporada no tiene reglas de ranking"
              explicacion="Sin una tabla de puesto a puntos no hay ranking que calcular, y las convocatorias se quedan sin el corte con el que justificarlas."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {reglas.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-3">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="flex min-w-40 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {r.weapon
                          ? (WEAPON_LABEL[r.weapon as keyof typeof WEAPON_LABEL] ?? r.weapon)
                          : 'Todas las armas'}
                        <span className="text-muted-foreground">·</span>
                        {r.category
                          ? (CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ??
                            r.category)
                          : 'Todas las categorías'}
                        {!r.active ? (
                          <Badge variant="outline" className="font-normal">
                            Desactivada
                          </Badge>
                        ) : null}
                      </span>
                      <Procedencia
                        documento={r.sourceDocument}
                        url={r.sourceUrl}
                        fecha={r.updatedAt}
                      />
                      {r.cutoffDate ? (
                        <span className="text-xs text-muted-foreground">
                          Corte para convocatorias: {formatDateEs(r.cutoffDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Sin fecha de corte para convocatorias
                        </span>
                      )}
                    </div>

                    <dl className="flex shrink-0 flex-wrap gap-x-5 gap-y-1">
                      {[
                        ['mejores pruebas', r.countingEvents],
                        ['plazas por ranking', r.rankingPlaces],
                        ['plazas técnicas', r.technicalPlaces],
                        ['puestos con puntos', Object.keys(r.pointsTable).length],
                        ['circuitos con coeficiente', Object.keys(r.coefficients).length],
                      ].map(([palabra, valor]) => (
                        <div key={palabra as string} className="flex flex-col">
                          <dd className="cifra text-lg">{valor as number}</dd>
                          <dt className="text-xs text-muted-foreground">
                            {palabra as string}
                          </dt>
                        </div>
                      ))}
                    </dl>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => setEditor({ tipo: 'ranking', fila: r })}
                      >
                        <Pencil /> Editar
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Borrar esta regla de ranking"
                        disabled={ocupado}
                        onClick={() => ejecutar(() => borrarReglaRanking(r.id))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  {Object.keys(r.coefficients).length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(r.coefficients)
                        .map(
                          ([circuito, valor]) =>
                            `${CIRCUIT_LABEL[circuito] ?? circuito} ×${valor}`,
                        )
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {normativa.cambiosRecientes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">Últimos cambios</h2>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
            {normativa.cambiosRecientes.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-3 px-3 py-2">
                <span className="flex-1">
                  {ACCION_LABEL[c.action] ?? c.action} en{' '}
                  {TABLA_LABEL[c.tableName] ?? c.tableName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {c.quien ?? 'cuenta borrada'} · {formatDateEs(c.changedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------------- formularios --- */}
      <SheetPlazo
        abierto={editor?.tipo === 'plazo'}
        fila={editor?.tipo === 'plazo' ? editor.fila : null}
        seasonId={temporadaId}
        ocupado={ocupado}
        onCerrar={() => setEditor(null)}
        onGuardar={(datos) => ejecutar(() => guardarPlazo(datos), () => setEditor(null))}
      />

      <SheetCategoria
        abierto={editor?.tipo === 'categoria'}
        fila={editor?.tipo === 'categoria' ? editor.fila : null}
        seasonId={temporadaId}
        ocupado={ocupado}
        onCerrar={() => setEditor(null)}
        onGuardar={(datos) =>
          ejecutar(() => guardarCategoria(datos), () => setEditor(null))
        }
      />

      <SheetRanking
        abierto={editor?.tipo === 'ranking'}
        fila={editor?.tipo === 'ranking' ? editor.fila : null}
        seasonId={temporadaId}
        ocupado={ocupado}
        onCerrar={() => setEditor(null)}
        onGuardar={(datos) =>
          ejecutar(() => guardarReglaRanking(datos), () => setEditor(null))
        }
      />

      <SheetTemporada
        abierto={editor?.tipo === 'temporada'}
        ocupado={ocupado}
        onCerrar={() => setEditor(null)}
        onGuardar={(datos) => ejecutar(() => crearTemporada(datos), () => setEditor(null))}
      />
    </div>
  );
}

const ACCION_LABEL: Record<string, string> = {
  crear: 'Alta',
  editar: 'Cambio',
  borrar: 'Baja',
};

const TABLA_LABEL: Record<string, string> = {
  deadline_rule: 'plazos',
  season_category: 'categorías',
  ranking_rule: 'ranking',
  season: 'temporadas',
  user_profile: 'equipo',
  profile_weapon: 'armas del equipo',
};

// ---------------------------------------------------------- formularios ---

function Marco({
  abierto,
  titulo,
  descripcion,
  ocupado,
  onCerrar,
  onEnviar,
  children,
}: {
  abierto: boolean;
  titulo: string;
  descripcion: string;
  ocupado: boolean;
  onCerrar: () => void;
  onEnviar: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{descripcion}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {children}
        </div>

        {/* En ancho cómodo los botones van en fila y a la derecha, como en
            los diálogos del resto del panel; apilados solo cabe uno bien. */}
        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button disabled={ocupado} onClick={onEnviar}>
            {ocupado ? <Loader2 className="animate-spin" /> : null}
            Guardar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SheetPlazo({
  abierto,
  fila,
  seasonId,
  ocupado,
  onCerrar,
  onGuardar,
}: {
  abierto: boolean;
  fila: PlazoFila | null;
  seasonId: string;
  ocupado: boolean;
  onCerrar: () => void;
  onGuardar: (datos: FormData) => void;
}) {
  const [estado, setEstado] = React.useState(() => desdePlazo(fila));

  React.useEffect(() => {
    if (abierto) setEstado(desdePlazo(fila));
  }, [abierto, fila]);

  function enviar() {
    const datos = new FormData();
    if (fila) datos.set('id', fila.id);
    datos.set('seasonId', seasonId);
    datos.set('scope', estado.scope);
    datos.set('circuit', estado.circuit === CUALQUIERA ? '' : estado.circuit);
    datos.set('category', estado.category === CUALQUIERA ? '' : estado.category);
    datos.set('type', estado.type);
    datos.set('label', estado.label);
    datos.set('daysBefore', estado.daysBefore);
    datos.set('surchargeEur', estado.surchargeEur);
    datos.set('blocking', String(estado.blocking));
    datos.set('active', String(estado.active));
    datos.set('sourceDocument', estado.sourceDocument);
    datos.set('sourceUrl', estado.sourceUrl);
    datos.set('effectiveFrom', estado.effectiveFrom);
    onGuardar(datos);
  }

  return (
    <Marco
      abierto={abierto}
      titulo={fila ? 'Editar el plazo' : 'Nuevo plazo'}
      descripcion="Se aplica a los eventos que encajen con el ámbito, el circuito y la categoría que marques. Deja «cualquiera» para no restringir."
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={enviar}
    >
      <Campo id="plazo-label" etiqueta="Etiqueta legible">
        <Input
          id="plazo-label"
          value={estado.label}
          onChange={(e) => setEstado({ ...estado, label: e.target.value })}
          placeholder="Segundo plazo"
        />
      </Campo>

      <CampoSelect
        id="plazo-tipo"
        etiqueta="Tipo"
        valor={estado.type}
        onChange={(v) => setEstado({ ...estado, type: v })}
        opciones={TIPOS_PLAZO.map((t) => ({ valor: t.valor, etiqueta: t.etiqueta }))}
      />

      <CampoSelect
        id="plazo-ambito"
        etiqueta="Ámbito"
        valor={estado.scope}
        onChange={(v) => setEstado({ ...estado, scope: v })}
        opciones={AMBITOS.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta }))}
      />

      <CampoSelect
        id="plazo-circuito"
        etiqueta="Circuito"
        valor={estado.circuit}
        onChange={(v) => setEstado({ ...estado, circuit: v })}
        opciones={[
          { valor: CUALQUIERA, etiqueta: 'Cualquier circuito' },
          ...CIRCUITOS,
        ]}
      />

      <CampoSelect
        id="plazo-categoria"
        etiqueta="Categoría"
        valor={estado.category}
        onChange={(v) => setEstado({ ...estado, category: v })}
        opciones={[
          { valor: CUALQUIERA, etiqueta: 'Cualquier categoría' },
          ...CATEGORIAS,
        ]}
      />

      <Campo
        id="plazo-dias"
        etiqueta="Cierra este número de días antes del evento"
        ayuda="Días naturales contados hacia atrás desde la fecha de inicio."
      >
        <Input
          id="plazo-dias"
          inputMode="numeric"
          value={estado.daysBefore}
          onChange={(e) => setEstado({ ...estado, daysBefore: e.target.value })}
          placeholder="28"
        />
      </Campo>

      <Campo
        id="plazo-recargo"
        etiqueta="Recargo en euros"
        ayuda="Déjalo en blanco si la circular no publica importe: se dirá «no publicado» en vez de inventar un 0 €."
      >
        <Input
          id="plazo-recargo"
          inputMode="decimal"
          value={estado.surchargeEur}
          disabled={estado.blocking}
          onChange={(e) => setEstado({ ...estado, surchargeEur: e.target.value })}
          placeholder="25"
        />
      </Campo>

      <Interruptor
        id="plazo-bloqueante"
        etiqueta="Es un cierre duro, no un recargo"
        ayuda="Pasada esta fecha no se puede inscribir en absoluto. Es el caso del D-7 de la FIE."
        valor={estado.blocking}
        onChange={(v) => setEstado({ ...estado, blocking: v })}
      />

      <Interruptor
        id="plazo-activo"
        etiqueta="Activo"
        ayuda="Desactivado se conserva con su historial pero deja de aplicarse."
        valor={estado.active}
        onChange={(v) => setEstado({ ...estado, active: v })}
      />

      <Campo
        id="plazo-doc"
        etiqueta="Documento del que sale"
        ayuda="Obligatorio. Un importe sin procedencia no se puede defender cuando alguien lo discuta."
      >
        <Input
          id="plazo-doc"
          value={estado.sourceDocument}
          onChange={(e) => setEstado({ ...estado, sourceDocument: e.target.value })}
          placeholder="Circular 12-26 de la RFEE"
        />
      </Campo>

      <Campo id="plazo-url" etiqueta="Enlace al documento">
        <Input
          id="plazo-url"
          inputMode="url"
          value={estado.sourceUrl}
          onChange={(e) => setEstado({ ...estado, sourceUrl: e.target.value })}
          placeholder="https://esgrima.es/…"
        />
      </Campo>

      <CampoFecha
        id="plazo-vigor"
        etiqueta="En vigor desde"
        valorIso={estado.effectiveFrom}
        onChange={(iso) => setEstado({ ...estado, effectiveFrom: iso })}
        ayuda="En blanco = desde hoy."
      />
    </Marco>
  );
}

/**
 * Estado del formulario de plazo.
 *
 * Todo en texto —también los números y los enums— porque es lo que viaja en
 * un `FormData` y lo que valida la acción de servidor. Convertirlo aquí
 * duplicaría esa validación y las dos acabarían discrepando.
 */
type EstadoPlazo = {
  scope: string;
  circuit: string;
  category: string;
  type: string;
  label: string;
  daysBefore: string;
  surchargeEur: string;
  blocking: boolean;
  active: boolean;
  sourceDocument: string;
  sourceUrl: string;
  effectiveFrom: string;
};

function desdePlazo(fila: PlazoFila | null): EstadoPlazo {
  return {
    scope: fila?.scope ?? 'NACIONAL',
    circuit: fila?.circuit ?? CUALQUIERA,
    category: fila?.category ?? CUALQUIERA,
    type: fila?.type ?? 'L1',
    label: fila?.label ?? '',
    daysBefore: fila ? String(fila.daysBefore) : '',
    surchargeEur: fila?.surchargeEur ?? '',
    blocking: fila?.blocking ?? false,
    active: fila?.active ?? true,
    sourceDocument: fila?.sourceDocument ?? '',
    sourceUrl: fila?.sourceUrl ?? '',
    effectiveFrom: fila ? toCampoFecha(fila.effectiveFrom) : '',
  };
}

function SheetCategoria({
  abierto,
  fila,
  seasonId,
  ocupado,
  onCerrar,
  onGuardar,
}: {
  abierto: boolean;
  fila: CategoriaFila | null;
  seasonId: string;
  ocupado: boolean;
  onCerrar: () => void;
  onGuardar: (datos: FormData) => void;
}) {
  const [estado, setEstado] = React.useState(() => desdeCategoria(fila));

  React.useEffect(() => {
    if (abierto) setEstado(desdeCategoria(fila));
  }, [abierto, fila]);

  function enviar() {
    const datos = new FormData();
    if (fila) datos.set('id', fila.id);
    datos.set('seasonId', seasonId);
    datos.set('code', estado.code);
    datos.set('birthYearMin', estado.birthYearMin);
    datos.set('birthYearMax', estado.birthYearMax);
    datos.set('rank', estado.rank);
    datos.set('laddered', String(estado.laddered));
    datos.set('sourceDocument', estado.sourceDocument);
    datos.set('sourceUrl', estado.sourceUrl);
    onGuardar(datos);
  }

  return (
    <Marco
      abierto={abierto}
      titulo={fila ? `Editar ${fila.code}` : 'Nueva categoría'}
      descripcion="Los años son inclusivos y salen de la circular de categorías. La categoría de cada tirador se deriva de aquí."
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={enviar}
    >
      <CampoSelect
        id="cat-codigo"
        etiqueta="Categoría"
        valor={estado.code}
        onChange={(v) => setEstado({ ...estado, code: v })}
        opciones={CATEGORIAS}
      />

      <div className="grid grid-cols-2 gap-3">
        <Campo id="cat-min" etiqueta="Año mínimo">
          <Input
            id="cat-min"
            inputMode="numeric"
            value={estado.birthYearMin}
            onChange={(e) => setEstado({ ...estado, birthYearMin: e.target.value })}
            placeholder="2010"
          />
        </Campo>
        <Campo id="cat-max" etiqueta="Año máximo">
          <Input
            id="cat-max"
            inputMode="numeric"
            value={estado.birthYearMax}
            onChange={(e) => setEstado({ ...estado, birthYearMax: e.target.value })}
            placeholder="2013"
          />
        </Campo>
      </div>

      <Campo
        id="cat-orden"
        etiqueta="Orden en la escalera"
        ayuda="1 es la más joven. Es lo que permite decir «puedes subir de categoría, pero no bajar»."
      >
        <Input
          id="cat-orden"
          inputMode="numeric"
          value={estado.rank}
          onChange={(e) => setEstado({ ...estado, rank: e.target.value })}
          placeholder="4"
        />
      </Campo>

      <Interruptor
        id="cat-escalera"
        etiqueta="Forma parte de la escalera"
        ayuda="Veteranos va fuera: se entra por edad y además se puede tirar absoluto."
        valor={estado.laddered}
        onChange={(v) => setEstado({ ...estado, laddered: v })}
      />

      <Campo
        id="cat-doc"
        etiqueta="Documento del que salen estos años"
        ayuda="Obligatorio."
      >
        <Input
          id="cat-doc"
          value={estado.sourceDocument}
          onChange={(e) => setEstado({ ...estado, sourceDocument: e.target.value })}
          placeholder="Circular de categorías 2026-2027"
        />
      </Campo>

      <Campo id="cat-url" etiqueta="Enlace al documento">
        <Input
          id="cat-url"
          inputMode="url"
          value={estado.sourceUrl}
          onChange={(e) => setEstado({ ...estado, sourceUrl: e.target.value })}
          placeholder="https://esgrima.es/…"
        />
      </Campo>
    </Marco>
  );
}

function desdeCategoria(fila: CategoriaFila | null) {
  return {
    code: fila?.code ?? 'M17',
    birthYearMin: fila?.birthYearMin === null || fila === null ? '' : String(fila.birthYearMin),
    birthYearMax: fila?.birthYearMax === null || fila === null ? '' : String(fila.birthYearMax),
    rank: fila ? String(fila.rank) : '',
    laddered: fila?.laddered ?? true,
    sourceDocument: fila?.sourceDocument ?? '',
    sourceUrl: fila?.sourceUrl ?? '',
  };
}

function SheetRanking({
  abierto,
  fila,
  seasonId,
  ocupado,
  onCerrar,
  onGuardar,
}: {
  abierto: boolean;
  fila: ReglaRankingFila | null;
  seasonId: string;
  ocupado: boolean;
  onCerrar: () => void;
  onGuardar: (datos: FormData) => void;
}) {
  const [estado, setEstado] = React.useState(() => desdeRanking(fila));
  const [coeficientes, setCoeficientes] = React.useState<Par[]>(() =>
    paresDesde(fila?.coefficients ?? {}),
  );
  const [puntos, setPuntos] = React.useState<Par[]>(() =>
    paresDesde(fila?.pointsTable ?? {}),
  );

  React.useEffect(() => {
    if (!abierto) return;
    setEstado(desdeRanking(fila));
    setCoeficientes(paresDesde(fila?.coefficients ?? {}));
    setPuntos(paresDesde(fila?.pointsTable ?? {}));
  }, [abierto, fila]);

  function enviar() {
    const datos = new FormData();
    if (fila) datos.set('id', fila.id);
    datos.set('seasonId', seasonId);
    datos.set('weapon', estado.weapon === CUALQUIERA ? '' : estado.weapon);
    datos.set('category', estado.category === CUALQUIERA ? '' : estado.category);
    datos.set('countingEvents', estado.countingEvents);
    datos.set('rankingPlaces', estado.rankingPlaces);
    datos.set('technicalPlaces', estado.technicalPlaces);
    datos.set('cutoffDate', estado.cutoffDate);
    datos.set('sourceDocument', estado.sourceDocument);
    datos.set('sourceUrl', estado.sourceUrl);
    datos.set('effectiveFrom', estado.effectiveFrom);
    datos.set('active', String(estado.active));
    datos.set('coefficients', paresAJson(coeficientes));
    datos.set('pointsTable', paresAJson(puntos));
    onGuardar(datos);
  }

  return (
    <Marco
      abierto={abierto}
      titulo={fila ? 'Editar la regla de ranking' : 'Nueva regla de ranking'}
      descripcion="Una regla por combinación de arma y categoría. Deja «todas» para que valga de comodín."
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={enviar}
    >
      <CampoSelect
        id="rk-arma"
        etiqueta="Arma"
        valor={estado.weapon}
        onChange={(v) => setEstado({ ...estado, weapon: v })}
        opciones={[{ valor: CUALQUIERA, etiqueta: 'Todas las armas' }, ...ARMAS]}
      />

      <CampoSelect
        id="rk-categoria"
        etiqueta="Categoría"
        valor={estado.category}
        onChange={(v) => setEstado({ ...estado, category: v })}
        opciones={[
          { valor: CUALQUIERA, etiqueta: 'Todas las categorías' },
          ...CATEGORIAS,
        ]}
      />

      <Campo
        id="rk-cuentan"
        etiqueta="Cuentan las mejores"
        ayuda="Número de pruebas que suman al total de la temporada."
      >
        <Input
          id="rk-cuentan"
          inputMode="numeric"
          value={estado.countingEvents}
          onChange={(e) => setEstado({ ...estado, countingEvents: e.target.value })}
          placeholder="5"
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo id="rk-plazas" etiqueta="Plazas por ranking">
          <Input
            id="rk-plazas"
            inputMode="numeric"
            value={estado.rankingPlaces}
            onChange={(e) => setEstado({ ...estado, rankingPlaces: e.target.value })}
            placeholder="3"
          />
        </Campo>
        <Campo id="rk-tecnicas" etiqueta="Plazas técnicas">
          <Input
            id="rk-tecnicas"
            inputMode="numeric"
            value={estado.technicalPlaces}
            onChange={(e) => setEstado({ ...estado, technicalPlaces: e.target.value })}
            placeholder="1"
          />
        </Campo>
      </div>

      <CampoFecha
        id="rk-corte"
        etiqueta="Fecha de corte para convocatorias"
        valorIso={estado.cutoffDate}
        onChange={(iso) => setEstado({ ...estado, cutoffDate: iso })}
        ayuda="En blanco si todavía no está decidida."
      />

      <EditorPares
        etiqueta="Puntos por puesto"
        ayuda="Puesto → puntos base. Sin esta tabla no hay ranking: es lo único obligatorio."
        pares={puntos}
        onChange={setPuntos}
        etiquetaClave="Puesto"
        etiquetaValor="Puntos"
        claveNumerica
      />

      <EditorPares
        etiqueta="Coeficiente por circuito"
        ayuda="Multiplica los puntos base según el nivel de la prueba. Un circuito sin coeficiente cuenta como 1."
        pares={coeficientes}
        onChange={setCoeficientes}
        clavesSugeridas={CIRCUITOS}
        etiquetaClave="Circuito"
        etiquetaValor="Coeficiente"
      />

      <Interruptor
        id="rk-activa"
        etiqueta="Activa"
        ayuda="Desactivada se conserva pero deja de aplicarse al cálculo."
        valor={estado.active}
        onChange={(v) => setEstado({ ...estado, active: v })}
      />

      <Campo
        id="rk-doc"
        etiqueta="Documento del que salen los coeficientes"
        ayuda="Obligatorio."
      >
        <Input
          id="rk-doc"
          value={estado.sourceDocument}
          onChange={(e) => setEstado({ ...estado, sourceDocument: e.target.value })}
          placeholder="Normativa de ranking nacional 2026-2027"
        />
      </Campo>

      <Campo id="rk-url" etiqueta="Enlace al documento">
        <Input
          id="rk-url"
          inputMode="url"
          value={estado.sourceUrl}
          onChange={(e) => setEstado({ ...estado, sourceUrl: e.target.value })}
          placeholder="https://esgrima.es/…"
        />
      </Campo>

      <CampoFecha
        id="rk-vigor"
        etiqueta="En vigor desde"
        valorIso={estado.effectiveFrom}
        onChange={(iso) => setEstado({ ...estado, effectiveFrom: iso })}
        ayuda="En blanco = desde hoy."
      />
    </Marco>
  );
}

function desdeRanking(fila: ReglaRankingFila | null) {
  return {
    weapon: fila?.weapon ?? CUALQUIERA,
    category: fila?.category ?? CUALQUIERA,
    countingEvents: fila ? String(fila.countingEvents) : '',
    rankingPlaces: fila ? String(fila.rankingPlaces) : '0',
    technicalPlaces: fila ? String(fila.technicalPlaces) : '0',
    cutoffDate: fila?.cutoffDate ? toCampoFecha(fila.cutoffDate) : '',
    active: fila?.active ?? true,
    sourceDocument: fila?.sourceDocument ?? '',
    sourceUrl: fila?.sourceUrl ?? '',
    effectiveFrom: fila ? toCampoFecha(fila.effectiveFrom) : '',
  };
}

function SheetTemporada({
  abierto,
  ocupado,
  onCerrar,
  onGuardar,
}: {
  abierto: boolean;
  ocupado: boolean;
  onCerrar: () => void;
  onGuardar: (datos: FormData) => void;
}) {
  const [label, setLabel] = React.useState('');
  const [inicio, setInicio] = React.useState('');
  const [fin, setFin] = React.useState('');
  const [actual, setActual] = React.useState(true);

  React.useEffect(() => {
    if (abierto) {
      setLabel('');
      setInicio('');
      setFin('');
      setActual(true);
    }
  }, [abierto]);

  function enviar() {
    const datos = new FormData();
    datos.set('label', label);
    datos.set('startDate', inicio);
    datos.set('endDate', fin);
    datos.set('current', String(actual));
    onGuardar(datos);
  }

  return (
    <Marco
      abierto={abierto}
      titulo="Nueva temporada"
      descripcion="Las categorías, los plazos y los coeficientes cuelgan de una temporada. Solo una puede estar marcada como actual."
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={enviar}
    >
      <Campo
        id="temp-label"
        etiqueta="Etiqueta"
        ayuda="Con la forma 2026-2027."
      >
        <Input
          id="temp-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="2026-2027"
        />
      </Campo>

      <CampoFecha
        id="temp-inicio"
        etiqueta="Empieza el"
        valorIso={inicio}
        onChange={setInicio}
      />
      <CampoFecha id="temp-fin" etiqueta="Termina el" valorIso={fin} onChange={setFin} />

      <Interruptor
        id="temp-actual"
        etiqueta="Es la temporada actual"
        ayuda="Al marcarla, la que lo estuviera deja de serlo."
        valor={actual}
        onChange={setActual}
      />
    </Marco>
  );
}

// ------------------------------------------------------------- campos ---

function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {ayuda ? <p className="medida text-xs text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}

function CampoSelect({
  id,
  etiqueta,
  valor,
  onChange,
  opciones,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  opciones: { valor: string; etiqueta: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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

function Interruptor({
  id,
  etiqueta,
  ayuda,
  valor,
  onChange,
}: {
  id: string;
  etiqueta: string;
  ayuda: string;
  valor: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{etiqueta}</Label>
        <p className="medida text-xs text-muted-foreground">{ayuda}</p>
      </div>
      <Switch id={id} checked={valor} onCheckedChange={onChange} className="mt-1" />
    </div>
  );
}
