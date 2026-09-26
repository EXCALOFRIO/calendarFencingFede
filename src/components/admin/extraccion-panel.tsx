'use client';

import {
  CalendarCheck,
  CalendarOff,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Undo2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import {
  aprobarCircular,
  aprobarPropuesta,
  confirmarEventoDeExtraccion,
  descartarEventoDeExtraccion,
  procesarSiguientes,
  rechazarPropuesta,
  reabrirPropuesta,
} from '@/app/(app)/admin/extraccion/actions';
import type {
  ExtraccionRevision,
  PropuestaRevision,
  ResumenExtraccion,
} from '@/app/(app)/admin/extraccion/consultas';
import { Cifra, TiraCifras, Vacio } from '@/components/admin/piezas';
import { Rotulos } from '@/components/estado/piezas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatDateEs, formatDateTimeEs, formatEur, titular } from '@/lib/utils';

/**
 * Revisión de la extracción asistida.
 *
 * La pantalla entera está montada alrededor de una sola pregunta: ¿la frase
 * que hay debajo del valor dice de verdad eso? Por eso la cita va SIEMPRE
 * visible y en las palabras del documento, no escondida detrás de un icono de
 * información; y por eso el enlace al PDF está en cada banda.
 *
 * ASPECTO: la pista, no las tarjetas. Cada circular es una banda horizontal
 * con su filete de un píxel debajo del titular y sus campos separados por
 * líneas; no un recuadro flotando, porque un recuadro por circular sugiere
 * que todas pesan lo mismo y aquí lo que pesa es el campo sin revisar. El
 * valor propuesto va en `.cifra` grande con el nombre del campo diminuto al
 * lado: ese contraste ES la jerarquía.
 *
 * Lo que no se ha revisado se enseña con la etiqueta «extraído
 * automáticamente, sin verificar». Un dato de esta pantalla no se parece
 * nunca a un dato oficial hasta que alguien lo firma.
 */

type Pestana = 'pendientes' | 'revisadas' | 'sin_datos';

/**
 * Nombre legible de cada campo. La clave interna ("deadline.L2") es estable y
 * sirve para cruzar con el esquema; la persona que revisa no tiene por qué
 * conocerla.
 */
const ETIQUETA_CAMPO: Record<string, string> = {
  'deadline.L1': 'Cierre ordinario de inscripción',
  'deadline.L2': 'Segundo plazo (con recargo)',
  'deadline.L3': 'Tercer plazo (con recargo)',
  'deadline.FIE_D7': 'Cierre duro de la FIE',
  fee_eur: 'Cuota de inscripción',
  fee_concept: 'Concepto de la cuota',
  venue: 'Pabellón',
  venue_address: 'Dirección de la sede',
  venue_city: 'Localidad de la sede',
  installation_open: 'Apertura de la instalación',
  call_time: 'Hora de llamada',
  scratch_time: 'Hora del scratch',
  start_time: 'Inicio de la competición',
};

/** Los importes que NO son la cuota del tirador, con su nombre entero. */
const ETIQUETA_IMPORTE: Record<string, string> = {
  equipos: 'Cuota por equipo',
  extranjeros: 'Cuota de tiradores extranjeros',
  acompanante: 'Cuota de acompañante',
  arbitro: 'Cuota de árbitro',
  alojamiento: 'Precio de alojamiento',
  otro: 'Otro importe',
};

/** Para qué sirve el enlace. */
const ETIQUETA_ENLACE: Record<string, string> = {
  inscripcion: 'Enlace de inscripción',
  reglamento: 'Enlace al reglamento',
  normativa: 'Enlace a la normativa',
  alojamiento: 'Enlace de alojamiento',
  resultados: 'Enlace a resultados',
  sorteo: 'Enlace al sorteo',
  web: 'Web del torneo',
  otro: 'Enlace',
};

function etiquetaDeCampo(campo: string): string {
  if (ETIQUETA_CAMPO[campo]) return ETIQUETA_CAMPO[campo];
  if (campo.endsWith('.surcharge_eur')) {
    const base = campo.replace('.surcharge_eur', '');
    return `Recargo de ${ETIQUETA_CAMPO[base] ?? base}`;
  }
  if (campo.endsWith('.time')) {
    const base = campo.replace('.time', '');
    return `Hora del ${(ETIQUETA_CAMPO[base] ?? base).toLowerCase()}`;
  }
  if (campo.startsWith('category_allowed.')) {
    return `Categoría admitida ${campo.slice('category_allowed.'.length)}`;
  }
  if (campo.startsWith('fee_eur.')) {
    const tipo = campo.slice('fee_eur.'.length);
    return ETIQUETA_IMPORTE[tipo] ?? `Importe de ${tipo}`;
  }
  if (campo.startsWith('fee_concept.')) {
    const tipo = campo.slice('fee_concept.'.length);
    return `Concepto de ${(ETIQUETA_IMPORTE[tipo] ?? tipo).toLowerCase()}`;
  }
  if (campo.startsWith('link.')) {
    const [tipo] = campo.slice('link.'.length).split('.');
    return ETIQUETA_ENLACE[tipo] ?? 'Enlace';
  }
  // Un horario por día y por prueba llega como
  // "start_time.2026-10-04.florete-masculino".
  const [raiz, ...resto] = campo.split('.');
  if (ETIQUETA_CAMPO[raiz] && resto.length > 0) {
    return `${ETIQUETA_CAMPO[raiz]}, ${resto.join(' · ').replace(/-/g, ' ')}`;
  }
  return campo;
}

/**
 * Cómo se enseña el valor propuesto.
 *
 * Dos decisiones, las dos aprendidas mirando la pantalla con datos reales:
 *
 *  - El valor se FORMATEA como se formatea en el resto de la aplicación:
 *    `25.00` se lee «25 €» y `2025-05-23` se lee «23 may 2025». El valor
 *    crudo es lo que se guardará, pero lo que hay que comparar con el PDF es
 *    lo que el PDF dice, y el PDF dice «25 euros», no «25.00».
 *  - Solo los valores CORTOS van en `.cifra` de marcador. «Autorización de
 *    acceso a pista» a 30 px en condensada parecía un titular y tapaba la
 *    cita, que es lo que de verdad hay que leer aquí.
 */
function valorLegible(campo: string, valor: string): { texto: string; cifra: boolean } {
  if (campo.startsWith('fee_eur') || campo.endsWith('.surcharge_eur')) {
    return { texto: formatEur(valor), cifra: true };
  }
  if (campo.startsWith('deadline.') && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return { texto: formatDateEs(valor), cifra: true };
  }
  // Una URL nunca en `.cifra`: a 30 px en condensada tapa la cita y además se
  // parte por donde no debe.
  if (campo.startsWith('link.')) return { texto: valor, cifra: false };
  return { texto: valor, cifra: valor.length <= 14 };
}

const MOTIVO_SIN_DATOS: Record<string, string> = {
  sin_texto:
    'El PDF está escaneado: no tiene texto que leer, y sin texto no se puede comprobar ninguna cita.',
  bloqueado_datos_personales:
    'Parece llevar datos personales, así que no se ha mandado a ningún modelo. Hay que leerlo a mano.',
  sin_modelo: 'No había ningún modelo configurado cuando se intentó.',
  error: 'Falló al procesarlo. Se volverá a intentar en la próxima pasada.',
  ok: 'Se leyó entero y no había ningún dato que encajara en el esquema.',
};

export function ExtraccionPanel({
  resumen,
  pendientes,
  revisadas,
  sinDatos,
  modelo,
}: {
  resumen: ResumenExtraccion;
  pendientes: ExtraccionRevision[];
  revisadas: ExtraccionRevision[];
  sinDatos: ExtraccionRevision[];
  modelo: string | null;
}) {
  const router = useRouter();
  const [pestana, setPestana] = React.useState<Pestana>('pendientes');
  const [ocupado, setOcupado] = React.useState(false);

  const visibles =
    pestana === 'pendientes' ? pendientes : pestana === 'revisadas' ? revisadas : sinDatos;

  async function ejecutar(
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) {
    setOcupado(true);
    try {
      const resultado = await accion();
      if (resultado.ok) {
        toast.success(resultado.message ?? 'Hecho.');
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

  /**
   * Leer circulares es la acción de la máquina; la de la persona es aprobar.
   * Por eso va en voz baja: un botón relleno aquí competiría con los de
   * aprobar, que son a lo que se viene.
   */
  const botonLeer = (
    <Button
      size="sm"
      variant="outline"
      disabled={ocupado}
      onClick={() => ejecutar(procesarSiguientes)}
    >
      {ocupado ? <Loader2 className="animate-spin" /> : null}
      Leer las siguientes circulares
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TiraCifras>
        <Cifra
          valor={resumen.pendientes}
          palabra="campos por revisar"
          tono={resumen.pendientes > 0 ? 'aviso' : 'normal'}
        />
        <Cifra valor={resumen.aprobadas} palabra="aprobados" tono="ok" />
        <Cifra
          valor={resumen.sinLeer}
          palabra="circulares sin leer"
          detalle="con el prompt y el esquema de hoy"
        />
        <Cifra
          valor={resumen.descartadasPorCitaFalsa}
          palabra="citas que no estaban en el PDF"
          tono={resumen.descartadasPorCitaFalsa > 0 ? 'urgente' : 'normal'}
          detalle="campos tumbados por la verificación"
        />
      </TiraCifras>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={pestana}
            onValueChange={(v) => v && setPestana(v as Pestana)}
            variant="outline"
            size="sm"
            spacing={1}
            className="max-w-full flex-wrap"
          >
            <ToggleGroupItem value="pendientes" className="gap-1.5">
              Por revisar
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
            <ToggleGroupItem value="sin_datos" className="gap-1.5">
              Sin datos
              <span className="cifra text-xs text-muted-foreground">
                {sinDatos.length}
              </span>
            </ToggleGroupItem>
          </ToggleGroup>

          {botonLeer}

          {modelo ? (
            <span className="text-xs text-muted-foreground">
              Lee el modelo {modelo}
            </span>
          ) : (
            <span className="text-xs text-warn">
              Extracción apagada: lo que se ve aquí es de pasadas anteriores.
            </span>
          )}
        </div>

        {visibles.length === 0 ? (
          <VacioDe pestana={pestana} sinLeer={resumen.sinLeer} accion={botonLeer} />
        ) : (
          <ul className="flex flex-col gap-6">
            {visibles.map((extraccion) => (
              <BandaCircular
                key={extraccion.id}
                extraccion={extraccion}
                pestana={pestana}
                ocupado={ocupado}
                ejecutar={ejecutar}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Qué aparecerá aquí y qué hacer ahora. Nunca «No hay datos». */
function VacioDe({
  pestana,
  sinLeer,
  accion,
}: {
  pestana: Pestana;
  sinLeer: number;
  accion: React.ReactNode;
}) {
  if (pestana === 'revisadas') {
    return (
      <Vacio
        titulo="Todavía no has aprobado ni rechazado nada"
        explicacion="Lo que decidas en «Por revisar» se queda aquí con tu nombre y la fecha, para poder volver sobre ello cuando alguien discuta un importe."
      />
    );
  }

  if (pestana === 'sin_datos') {
    return (
      <Vacio
        titulo="Ninguna circular se ha quedado en blanco"
        explicacion="Aquí caen las que se leyeron y no dieron ningún campo: escaneadas sin texto, bloqueadas por llevar datos personales o simplemente sin plazos publicados."
      />
    );
  }

  return (
    <Vacio
      titulo="Nada pendiente de revisar"
      explicacion={
        sinLeer > 0
          ? `Quedan ${sinLeer} circulares por leer. Cuando el modelo saque un plazo, una cuota o un horario, el dato aparecerá aquí con la frase del PDF de la que sale.`
          : 'Todas las circulares están leídas. Cuando entre una nueva, sus plazos y cuotas aparecerán aquí para que les des el visto bueno.'
      }
      accion={sinLeer > 0 ? accion : undefined}
    />
  );
}

/**
 * Una circular: banda de titular con filete, y debajo sus campos en filas.
 *
 * Los datos de la circular (cuándo se leyó, cuántas páginas, qué modelo) van
 * con su rótulo y no encadenados con puntos medios: «Modelo» delante hace que
 * `@cf/google/gemma-4-26b-a4b-it` se lea como un modelo y no como ruido.
 */
function BandaCircular({
  extraccion,
  pestana,
  ocupado,
  ejecutar,
}: {
  extraccion: ExtraccionRevision;
  pestana: Pestana;
  ocupado: boolean;
  ejecutar: (
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) => Promise<void>;
}) {
  const pendientesAqui = extraccion.propuestas.filter((p) => p.estado === 'pendiente');

  return (
    <li className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2 border-b pb-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2 className="min-w-0 text-lg break-words sm:text-xl">
            {extraccion.titulo ? titular(extraccion.titulo) : 'Circular sin título'}
          </h2>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={extraccion.url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Abrir el PDF
              </a>
            </Button>
            {pestana === 'pendientes' && pendientesAqui.length > 1 ? (
              <Button
                size="sm"
                disabled={ocupado}
                onClick={() => ejecutar(() => aprobarCircular(extraccion.id))}
              >
                <Check />
                Aprobar los {pendientesAqui.length}
              </Button>
            ) : null}
          </div>
        </div>

        <Rotulos
          disposicion="linea"
          datos={[
            ['Leída', formatDateTimeEs(extraccion.creadoEn)],
            ['Páginas', extraccion.paginas ?? 'no publicado'],
            ['Modelo', extraccion.modelo ?? 'ninguno'],
          ]}
        />
      </div>

      <BandaEvento extraccion={extraccion} ocupado={ocupado} ejecutar={ejecutar} />

      {extraccion.propuestas.length === 0 ? (
        <p className="medida text-sm text-muted-foreground">
          {extraccion.motivo ?? MOTIVO_SIN_DATOS[extraccion.estado] ?? 'Sin datos.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {extraccion.propuestas.map((propuesta) => (
            <FilaPropuesta
              key={propuesta.id}
              propuesta={propuesta}
              ocupado={ocupado}
              ejecutar={ejecutar}
            />
          ))}
        </ul>
      )}

      {extraccion.descartadas.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="group/desc w-full justify-start px-0 text-xs text-muted-foreground hover:bg-transparent"
            >
              <ChevronDown className="transition-transform group-data-[state=open]/desc:rotate-180" />
              {extraccion.descartadas.length} campos descartados: el modelo citó algo
              que no está en el PDF
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-2 border-t pt-2">
              {extraccion.descartadas.map((campo, i) => (
                <li key={`${extraccion.id}-${campo.campo}-${i}`} className="min-w-0">
                  <Rotulos
                    disposicion="linea"
                    datos={[
                      [
                        etiquetaDeCampo(campo.campo),
                        campo.valor
                          ? valorLegible(campo.campo, campo.valor).texto
                          : 'sin valor',
                      ],
                    ]}
                  />
                  <p className="medida text-xs break-words text-danger">{campo.motivo}</p>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </li>
  );
}

/**
 * A qué torneo van estos datos.
 *
 * Es la mitad de la revisión que no existía y sin la que nada llega a una
 * ficha. Va arriba, antes de los campos, a propósito: si no se sabe de qué
 * torneo habla la circular, da igual lo bien citado que esté un horario,
 * porque no tiene sitio donde ponerse.
 *
 * Tres estados y tres mensajes distintos, ninguno ambiguo:
 *  · 'seguro' → dice a qué ficha va, y ya está.
 *  · 'dudoso' → enseña el candidato con el motivo y pide una confirmación. El
 *    dato NO está en ninguna ficha todavía.
 *  · 'desconocido' → dice que no se sabe y por qué. No hay botón que valga:
 *    inventarse el torneo es el error que esto evita.
 */
function BandaEvento({
  extraccion,
  ocupado,
  ejecutar,
}: {
  extraccion: ExtraccionRevision;
  ocupado: boolean;
  ejecutar: (
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) => Promise<void>;
}) {
  const { evento } = extraccion;

  if (evento.certeza === 'seguro' && evento.nombre) {
    return (
      <p className="medida text-sm text-muted-foreground">
        <CalendarCheck className="mr-1 inline size-4 text-ok" aria-hidden />
        Los campos aprobados van a la ficha de{' '}
        <strong className="font-medium text-foreground">{titular(evento.nombre)}</strong>
        {evento.ciudad ? ` · ${evento.ciudad}` : ''}
        {evento.inicio ? ` · ${formatDateEs(evento.inicio)}` : ''}.
      </p>
    );
  }

  if (evento.certeza === 'dudoso' && evento.nombre) {
    return (
      <div className="flex min-w-0 flex-col gap-2 border-l-2 border-warn pl-3">
        <p className="medida text-sm">
          <strong className="font-medium">¿Es «{titular(evento.nombre)}»?</strong>{' '}
          {evento.ciudad ? `${evento.ciudad} · ` : ''}
          {evento.inicio ? formatDateEs(evento.inicio) : ''}
        </p>
        {evento.motivo ? (
          <p className="medida text-xs text-muted-foreground">{evento.motivo}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() => ejecutar(() => confirmarEventoDeExtraccion(extraccion.id))}
          >
            <Check className="text-ok" />
            Sí, es ese torneo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            onClick={() => ejecutar(() => descartarEventoDeExtraccion(extraccion.id))}
          >
            <X />
            No es ese
          </Button>
        </div>
      </div>
    );
  }

  return (
    <p className="medida text-sm text-muted-foreground">
      <CalendarOff className="mr-1 inline size-4" aria-hidden />
      No se sabe a qué torneo se refiere, así que estos datos no aparecen en
      ninguna ficha.{' '}
      {evento.motivo ?? 'El documento no nombra ninguna competición con fecha.'}
    </p>
  );
}

function FilaPropuesta({
  propuesta,
  ocupado,
  ejecutar,
}: {
  propuesta: PropuestaRevision;
  ocupado: boolean;
  ejecutar: (
    accion: () => Promise<{ ok: boolean; message?: string; error?: string }>,
  ) => Promise<void>;
}) {
  const pendiente = propuesta.estado === 'pendiente';
  const valor = valorLegible(propuesta.campo, propuesta.valorPropuesto);

  return (
    <li className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        {/*
          El valor en grande y el nombre del campo diminuto al lado: es el
          marcador. Puesto al revés —rótulo grande, valor pequeño— la lista se
          leía plana y había que buscar el dato en cada fila.
        */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={valor.cifra ? 'cifra shrink-0 text-3xl' : 'font-medium'}>
            {valor.texto}
          </span>
          <span className="text-xs text-muted-foreground">
            {etiquetaDeCampo(propuesta.campo)}
          </span>
          {/*
            La prueba tal como la nombra el PDF. Va aquí y no en el nombre del
            campo porque es lo que decide a qué fila de la ficha acaba yendo el
            horario: sin ella, «09:00» es una hora que no se sabe de qué.
          */}
          {propuesta.prueba ? (
            <Badge variant="outline" className="font-normal">
              {propuesta.prueba}
            </Badge>
          ) : null}
          <EstadoPastilla propuesta={propuesta} />
        </div>

        {/*
          La cita, siempre visible. Es el único motivo por el que esta pantalla
          existe: sin la frase delante, aprobar es fiarse.
        */}
        <blockquote className="medida border-l pl-2 text-sm break-words">
          «{propuesta.cita}»
        </blockquote>

        {propuesta.contexto ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="group/ctx h-auto justify-start px-0 py-1 text-xs text-muted-foreground hover:bg-transparent"
              >
                <ChevronDown className="transition-transform group-data-[state=open]/ctx:rotate-180" />
                Ver el trozo del PDF
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="medida rounded-md bg-muted px-2 py-1.5 text-xs break-words text-muted-foreground">
                {propuesta.contexto}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {!pendiente && propuesta.revisadoEn ? (
          <Rotulos
            disposicion="linea"
            datos={[
              [
                propuesta.estado === 'aprobada' ? 'Aprobado' : 'Rechazado',
                formatDateTimeEs(propuesta.revisadoEn),
              ],
              ...(propuesta.revisadoPor
                ? ([['Por', propuesta.revisadoPor]] as [string, React.ReactNode][])
                : []),
            ]}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {pendiente ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={ocupado}
              onClick={() => ejecutar(() => aprobarPropuesta(propuesta.id))}
            >
              <Check className="text-ok" />
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={ocupado}
              onClick={() => ejecutar(() => rechazarPropuesta(propuesta.id))}
            >
              <X />
              Rechazar
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            onClick={() => ejecutar(() => reabrirPropuesta(propuesta.id))}
          >
            <Undo2 />
            Volver a pendiente
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * El estado, con palabra además de color.
 *
 * «Sin verificar» es la regla del proyecto: mientras nadie lo haya mirado,
 * esto es una propuesta de una máquina y tiene que parecerlo.
 */
function EstadoPastilla({ propuesta }: { propuesta: PropuestaRevision }) {
  if (propuesta.estado === 'aprobada') {
    return (
      <Badge variant="outline" className="font-normal text-ok">
        Aprobado por una persona
      </Badge>
    );
  }
  if (propuesta.estado === 'rechazada') {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Rechazado
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      Extraído automáticamente, sin verificar
    </Badge>
  );
}
