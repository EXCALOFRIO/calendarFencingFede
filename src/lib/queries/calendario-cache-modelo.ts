import type { Cacheado, DefinicionCache } from '@/lib/cache/cache';
import type { ParteClave } from '@/lib/cache/claves';
import type { FilaUnida } from '@/lib/entries/union';
import type { EstadoLista } from '@/lib/entries/lectura';
import type { EventView } from './calendar';
import type { TramoPasado } from './calendario-pasado-modelo';
import type { VistaPodiosEvento } from './evento-resultados';

/**
 * El calendario servido desde la caché compartida: la temporada que pinta la
 * rejilla, los tramos ya celebrados y lo común de la ficha de un torneo
 * (detalle, lista oficial de inscritos y podios). Nada de esto depende de
 * quién mira: las inscripciones solicitadas, los tiradores de la cuenta y la
 * marca «es mío» se leen y se aplican aparte, en la petición.
 *
 * Las claves llevan el día cuando el valor depende de él (los plazos se
 * calculan contra hoy; un tramo reciente se corta en ayer).
 */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

type Definidor = {
  definir<P extends readonly ParteClave[], T>(def: DefinicionCache<P, T>): Cacheado<P, T>;
};

/** Lo público de la lista unida: sin evidencias ni procedencia, que la ficha no necesita. */
export type ListaPublica = {
  filas: Pick<FilaUnida, 'competitionId' | 'nombre' | 'equipo' | 'club' | 'athleteIds' | 'retiradoEn'>[];
  estados: Record<string, EstadoLista>;
};

export type LectoresCalendario = {
  /** La temporada de hoy en adelante (`listEvents` de la pantalla principal). */
  eventos: () => Promise<EventView[]>;
  tramo: (t: { desde: string; hasta: string; hoy: string }) => Promise<TramoPasado>;
  /** `getEvent`: con plazos y lo extraído de los PDFs. */
  detalle: (eventId: string) => Promise<EventView | null>;
  /** Lista oficial unida, ya con la sesión comprobada por quien llama. */
  inscritos: (eventId: string) => Promise<{ filas: FilaUnida[]; estados: Record<string, EstadoLista> }>;
  podios: (eventId: string) => Promise<VistaPodiosEvento>;
  /** Día en Madrid (`hoyMadrid`). */
  hoy: () => string;
};

/** Un tramo cuyo final está más lejos que esto ya no depende del día en que se mira. */
const DIAS_TRAMO_RECIENTE = 15;

const ID_EVENTO = /^[\w-]{1,80}$/;

export function idDeEventoValido(id: unknown): id is string {
  return typeof id === 'string' && ID_EVENTO.test(id);
}

/**
 * Lo que la rejilla del calendario no lee y viajaba igualmente en cada carga
 * (medido: ~20 % del JSON de la temporada). Se vacían, no se quitan, para no
 * cambiar el tipo:
 *
 * - `linkedEvents`, `imageSource`, `circuitFie`, `regionalFederation` y
 *   `notes`: ningún componente del cliente los usa (el tramo pasado ya cruzó
 *   `linkedEvents` en el servidor; el iCal lee de `listEvents`, no de aquí).
 * - `status.label` y `status.next`: la rejilla sólo usa `state`, `closed` y
 *   `daysLeft`; la frase sólo la pinta la barra de plazos, que no aparece
 *   hasta que llega el detalle, y el detalle trae su propio `status`.
 *
 * Lo que sólo pinta la ficha (documentos, horarios, cuota, enlaces) se queda:
 * la ficha se abre con esto y no puede enseñar «no publicado» mientras llega
 * el detalle.
 */
export function recortarParaRejilla(eventos: readonly EventView[]): EventView[] {
  return eventos.map((e) => ({
    ...e,
    linkedEvents: [],
    imageSource: null,
    circuitFie: null,
    regionalFederation: null,
    notes: null,
    competitions: e.competitions.map((c) => ({ ...c, status: { ...c.status, label: '', next: null } })),
  }));
}

export function aListaPublica(lista: { filas: FilaUnida[]; estados: Record<string, EstadoLista> }): ListaPublica {
  return {
    filas: lista.filas.map((f) => ({
      competitionId: f.competitionId,
      nombre: f.nombre,
      equipo: f.equipo,
      club: f.club,
      athleteIds: f.athleteIds,
      retiradoEn: f.retiradoEn,
    })),
    estados: lista.estados,
  };
}

function restarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - dias * DIA).toISOString().slice(0, 10);
}

export function crearCachesCalendario({ cache, leer }: { cache: Definidor; leer: LectoresCalendario }) {
  const eventos = cache.definir({
    espacio: 'calendario-eventos',
    depende: ['calendario'],
    frescoMs: 5 * MINUTO,
    caducaMs: DIA,
    // `dia` sólo es clave: `listEvents` corta por su propio «hoy» y calcula los plazos contra él.
    cargar: async (_dia: string) => recortarParaRejilla(await leer.eventos()),
    guardarSi: (v: EventView[]) => v.length > 0,
  });

  const definicionTramo = (espacio: string, frescoMs: number, caducaMs: number) =>
    cache.definir({
      espacio,
      depende: ['calendario', 'deporte'],
      frescoMs,
      caducaMs,
      cargar: async (desde: string, hasta: string, _dia: string | null) => {
        const tramo = await leer.tramo({ desde, hasta, hoy: leer.hoy() });
        return { ...tramo, eventos: recortarParaRejilla(tramo.eventos) };
      },
    });
  const tramoReciente = definicionTramo('calendario-tramo-reciente', 5 * MINUTO, DIA);
  const tramoAntiguo = definicionTramo('calendario-tramo', DIA, 30 * DIA);

  const detalle = cache.definir({
    espacio: 'calendario-detalle',
    depende: ['calendario'],
    frescoMs: 5 * MINUTO,
    caducaMs: DIA,
    cargar: (eventId: string, _dia: string) => leer.detalle(eventId),
  });

  const lista = cache.definir({
    espacio: 'calendario-inscritos',
    depende: ['calendario'],
    frescoMs: 2 * MINUTO,
    caducaMs: DIA,
    cargar: async (eventId: string) => aListaPublica(await leer.inscritos(eventId)),
    // Un id que no es de ningún torneo no tiene pruebas: no se guarda.
    guardarSi: (v: ListaPublica) => v.filas.length > 0 || Object.keys(v.estados).length > 0,
  });

  const podios = cache.definir({
    espacio: 'calendario-podios',
    depende: ['calendario', 'deporte'],
    frescoMs: 6 * HORA,
    caducaMs: 7 * DIA,
    cargar: (eventId: string) => leer.podios(eventId),
    guardarSi: (v: VistaPodiosEvento) => v.tipo === 'ok',
  });

  const diaUtc = () => new Date().toISOString().slice(0, 10);

  // Sin `catch` de vuelta a D1: la caché ya lee de D1 si fallan la versión o el
  // almacén, y un error del cargador repetido aquí sería otra consulta que falla.
  return {
    /** La temporada de la rejilla, recortada. */
    eventosDelCalendario(): Promise<EventView[]> {
      return eventos(diaUtc());
    },
    /** Lo ya celebrado de un tramo (ya acotado a ayer por quien llama). */
    tramoPasado(t: { desde: string; hasta: string; hoy: string }): Promise<TramoPasado> {
      const reciente = t.hasta >= restarDias(t.hoy, DIAS_TRAMO_RECIENTE);
      return reciente ? tramoReciente(t.desde, t.hasta, t.hoy) : tramoAntiguo(t.desde, t.hasta, null);
    },
    detalle(eventId: string): Promise<EventView | null> {
      return detalle(eventId, diaUtc());
    },
    listaPublica(eventId: string): Promise<ListaPublica> {
      return lista(eventId);
    },
    podios(eventId: string): Promise<VistaPodiosEvento> {
      return podios(eventId);
    },
  };
}
