'use client';

import * as React from 'react';
import type {
  CortePropio,
  PruebaPropia,
  PuestoTemporada,
  PuntosDePrueba,
} from '@/app/(app)/estado/consultas';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MyStatus } from '@/lib/queries/my-status';
import type { PuestoOficial } from '@/lib/queries/ranking';
import { CATEGORY_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { Celebradas } from './celebradas';
import { ComoVoy } from './como-voy';
import { type Respuesta, Convocatorias } from './convocatoria';
import { CeldaMarcador, Marcador } from './piezas';
import { Pruebas } from './pruebas';

const TODOS = 'todos';

/**
 * ===========================================================================
 * «MI ESTADO»: TRES PREGUNTAS Y NADA MÁS
 * ===========================================================================
 *
 * Esta pantalla era el seguimiento de una solicitud: el progreso «Solicitada →
 * Validada por tu club → Aceptada por la RFEE → Enviada», los botones de pedir
 * y retirar, y la lista de lo que te faltaba (licencia, consentimiento). Ya no.
 * El usuario redefinió la aplicación:
 *
 *   «quita todo lo de clubes, lo de códigos de licencia, lo de darse o no de
 *    alta en los torneos, eso está oculto: solo ver calendario, si estoy o no»
 *
 * Así que contesta tres preguntas, en este orden y sin nada en medio:
 *
 *   1. **¿Estoy dentro?**    con la lista OFICIAL, no con nuestras solicitudes.
 *                            Vale incluso si te inscribió otro, que es el caso
 *                            que se pidió cubrir.
 *   2. **¿Cuánto me queda?** los plazos, con la barra de tramos de la ficha de
 *                            torneo (importada, no reimplementada).
 *   3. **¿Cómo voy?**        puesto, puntos y —esto faltaba— a cuánto del corte.
 *
 * ---------------------------------------------------------------------------
 * CINCO BANDAS, Y QUÉ SE JUNTÓ CON QUÉ
 * ---------------------------------------------------------------------------
 * Antes eran nueve bloques: marcador, «Hoy compites», «Selección», «Todavía no
 * te has inscrito», «Lo que ya has pedido», «Ya celebradas», «Qué te falta»,
 * «Tu temporada» y «Cálculo de la aplicación». Ahora son cinco:
 *
 *   marcador              tres cifras, una por pregunta, en UNA fila de móvil
 *   Selección             el oro, solo si hay convocatoria
 *   Tus competiciones     «Hoy compites» + «no te has inscrito» + «ya pedido»,
 *                         que hablaban del mismo objeto con tres nombres
 *   Cómo voy              «Tu temporada» + «Cálculo de la aplicación», este
 *                         plegado porque sirve para auditar, no para decidir
 *   Ya celebradas         igual, sin el estado del trámite
 *
 * Y «Qué te falta» desaparece: era la licencia y el consentimiento, o sea
 * justo lo que el usuario mandó esconder. El dato sigue trabajando por dentro
 * —es lo que empareja a cada tirador con el ranking oficial— y sigue
 * gestionándose en `/perfil`, pero aquí no se le enseña a nadie.
 *
 * En pantalla ancha no hay columna aparte: la de antes metía el ranking y los
 * trámites a la derecha, y al quitar los trámites lo que quedaba era una
 * columna de 20 rem con una sola cosa dentro. El contenido va a una columna con
 * ancho de lectura, que es lo que pide una pantalla que se mira en el móvil.
 */
export function PanelEstado({
  estado,
  pruebas,
  oficiales,
  cortes,
  internos,
  puntosPorPrueba,
  temporada,
  hoy,
  responderConvocatoria,
}: {
  estado: MyStatus;
  /** Lo que le importa de cada prueba: si está dentro y cuánto le queda. */
  pruebas: PruebaPropia[];
  /** Clasificación OFICIAL de la RFEE. */
  oficiales: PuestoOficial[];
  /** A cuánto del corte de convocatoria, con la regla de `/ranking`. */
  cortes: CortePropio[];
  /** Cálculo INTERNO de la aplicación (`ranking_snapshot`). */
  internos: PuestoTemporada[];
  /** `athleteId|eventCompetitionId` -> puntos de ranking de esa prueba. */
  puntosPorPrueba: Record<string, PuntosDePrueba>;
  temporada: string | null;
  /** Fecha de hoy en ISO, calculada en el servidor. */
  hoy: string;
  responderConvocatoria: Respuesta;
}) {
  const varios = estado.athletes.length > 1;
  const [quien, setQuien] = React.useState(() =>
    varios ? TODOS : (estado.athletes[0]?.id ?? TODOS),
  );

  const mio = <T extends { athleteId: string }>(filas: T[]) =>
    quien === TODOS ? filas : filas.filter((f) => f.athleteId === quien);

  const tiradores =
    quien === TODOS
      ? estado.athletes
      : estado.athletes.filter((a) => a.id === quien);

  const misPruebas = mio(pruebas);
  const convocatorias = mio(estado.callUps);
  const pasadas = mio(estado.pastEntries);
  const misOficiales = mio(oficiales);
  const misCortes = mio(cortes);
  const misInternos = mio(internos);

  const conNombre = quien === TODOS && varios;

  const dentro = misPruebas.filter((p) => p.oficial.estado === 'dentro').length;
  const sinResponder = convocatorias.filter(
    (c) => c.status === 'pendiente',
  ).length;

  /**
   * El plazo más apretado de todo lo que le afecta y en lo que todavía no
   * está. Es la cifra por la que se entra a esta pantalla desde la puerta de un
   * pabellón. Lo ya confirmado no cuenta: su plazo ya no cambia nada.
   */
  const plazos = misPruebas
    .filter((p) => p.oficial.estado !== 'dentro')
    .map((p) => p.estado.daysLeft)
    .filter((d): d is number => d !== null);
  const plazoMasCorto = plazos.length > 0 ? Math.min(...plazos) : null;

  const mejorPuesto = misOficiales.find((o) => o.position !== null) ?? null;
  const hayTiradorSinArma = tiradores.some(
    (a) => a.weapons.length === 0 || a.eligibleCategories.length === 0,
  );

  return (
    /*
      Ancho tope de 56 rem en escritorio.

      El layout da 1.320 px y la pantalla los usaba enteros: con tres celdas de
      marcador a 376 px, una cifra de 40 px se quedaba sola en medio de la celda,
      y las filas dejaban 300 px vacíos a la derecha. Medido en
      `capturas/nuevo-tutora-escritorio-estado.png`. Esto no es una tabla: es
      una ficha personal, y una ficha se lee en una columna.
    */
    <div className="flex min-w-0 max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl sm:text-3xl">Mi estado</h1>
          {temporada ? (
            <p className="text-sm text-muted-foreground">
              Temporada {temporada}
            </p>
          ) : null}
        </div>

        {/*
          Elegir de quién es el estado es «elegir uno de varios», y la sección
          9.1 de `REFERENCIAS.md` dice que eso va en `Select`, no en una fila de
          pastillas. Antes era un `ToggleGroup`, que es la convención de la
          selección MÚLTIPLE: la misma señal visual significaba dos cosas
          distintas según la pantalla. Y de paso ahorra una fila entera de
          móvil, que es donde se mira esto.
        */}
        {varios ? (
          <Select value={quien} onValueChange={(v) => v && setQuien(v)}>
            <SelectTrigger
              className="w-full sm:w-56"
              aria-label="De quién es el estado"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos mis tiradores</SelectItem>
              {estado.athletes.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {/* El marcador: una cifra por pregunta y ninguna frase. */}
      <Marcador>
        <CeldaMarcador
          valor={dentro}
          /* «Confirmadas», no «competiciones»: un cero ahí no significa que no
             estés en ninguna, significa que la aplicación no ha podido
             confirmarte en ninguna, que es otra cosa y hoy es lo normal. La
             diferencia se explica al pie de la sección de abajo. */
          palabra={
            dentro === 1
              ? 'confirmada en la lista oficial'
              : 'confirmadas en la lista oficial'
          }
          tono={dentro > 0 ? 'ok' : 'apagado'}
        />
        <CeldaMarcador
          valor={plazoMasCorto ?? '—'}
          palabra={
            plazoMasCorto === null
              ? 'plazos abiertos que te toquen'
              : plazoMasCorto === 1
                ? 'día para el plazo más corto'
                : 'días para el plazo más corto'
          }
          tono={
            plazoMasCorto === null
              ? 'apagado'
              : plazoMasCorto <= 3
                ? 'urgente'
                : plazoMasCorto <= 10
                  ? 'aviso'
                  : 'ok'
          }
        />
        <CeldaMarcador
          valor={
            mejorPuesto?.position ? (
              <>
                {mejorPuesto.position}
                <span className="text-xl">.º</span>
              </>
            ) : (
              '—'
            )
          }
          /* Corto a propósito: el `.º` ya dice que es un puesto y la banda de
             abajo dice de qué clasificación. «en el ranking oficial de florete
             absoluto» partía la celda en tres renglones y hacía la chapa el
             doble de alta que las otras dos. Medido en la captura. */
          palabra={
            mejorPuesto?.position
              ? `en ${etiquetaRanking(mejorPuesto)}`
              : 'sin puesto oficial'
          }
          tono={mejorPuesto?.position ? 'normal' : 'apagado'}
        />
        {sinResponder > 0 ? (
          <CeldaMarcador
            valor={sinResponder}
            palabra={
              sinResponder === 1
                ? 'convocatoria sin contestar'
                : 'convocatorias sin contestar'
            }
            tono="oro"
          />
        ) : null}
      </Marcador>

      <Convocatorias
        convocatorias={convocatorias}
        responder={responderConvocatoria}
        conNombre={conNombre}
      />

      <Pruebas
        pruebas={misPruebas}
        hoy={hoy}
        conNombre={conNombre}
        hayTiradorSinArma={hayTiradorSinArma}
      />

      <ComoVoy
        oficiales={misOficiales}
        cortes={misCortes}
        internos={misInternos}
        tiradores={tiradores.map((a) => ({ id: a.id, nombre: a.fullName }))}
        conNombre={conNombre}
      />

      <Celebradas
        entradas={pasadas}
        puntosPorPrueba={puntosPorPrueba}
        conNombre={conNombre}
      />
    </div>
  );
}

/**
 * «espada M20», «florete absoluto»: para las palabras del marcador, que van en
 * mitad de una frase y por tanto en minúscula.
 *
 * La categoría solo se pasa a minúscula si es una PALABRA. «M20» y «VET» son
 * códigos y en minúscula se leen como una errata: el marcador decía «puesto
 * oficial en florete m20».
 */
function etiquetaRanking(p: {
  weapon: keyof typeof WEAPON_LABEL;
  category: string;
}): string {
  const etiqueta =
    CATEGORY_LABEL[p.category as keyof typeof CATEGORY_LABEL] ?? p.category;
  // Si la etiqueta es igual al código («M20»), es un código; si es distinta
  // («ABS» -> «Absoluto»), es una palabra y va en minúscula.
  const categoria = etiqueta === p.category ? etiqueta : etiqueta.toLowerCase();
  return `${WEAPON_LABEL[p.weapon].toLowerCase()} ${categoria}`;
}
