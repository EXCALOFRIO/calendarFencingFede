import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { listaPersonas, nombrePrueba, puestoTexto, recortar, type DescripcionPrueba } from './textos';
import type { Preferencias, TipoAviso, TipoNotificacion } from './tipos';

/**
 * De «quién tiene qué puesto en qué prueba» a avisos: UNO por perfil y
 * competición, nunca uno por tirador. Puro: lo prueban los tests de
 * agrupación y preferencias sin base.
 */

/** Lo que se inserta en la bandeja. `clave` deduplica dentro del perfil. */
export type AvisoNuevo = {
  profileId: string;
  tipo: TipoNotificacion;
  clave: string;
  grupo: string;
  titulo: string;
  cuerpo: string;
  url: string;
  datos: DatosAviso | null;
};

export type LineaAviso = { nombre: string; puesto: number | null; motivo: TipoAviso };

export type DatosAviso = {
  /** Torneo (o persona) del aviso; la bandeja lo pone en lugar del cuerpo cuando lista personas. */
  contexto?: string;
  lineas?: LineaAviso[];
  /** Avisos de perfil y de calendario: una frase por cambio o por prueba. */
  detalles?: string[];
};

export type MotivoResultado = Extract<TipoAviso, 'perfil' | 'inscripciones' | 'seguidos'>;

/** El motivo más personal manda el tipo del aviso cuando hay varios. */
const PRIORIDAD: readonly MotivoResultado[] = ['perfil', 'inscripciones', 'seguidos'];

export type PruebaResultados = DescripcionPrueba & {
  competitionId: string;
  editionId: string;
  nombreEdicion: string;
};

/**
 * Una persona con resultado que le interesa a un perfil, y por qué.
 * `clavePersona` identifica a la persona (canónica o ficha local) para fundir
 * las líneas de la misma persona que llegan por dos motivos.
 */
export type LineaResultado = {
  profileId: string;
  motivo: MotivoResultado;
  clavePersona: string;
  /** Persona deportiva, para resaltarla al abrir la clasificación. */
  personaId: string | null;
  nombre: string;
  puesto: number | null;
};

const MAX_LINEAS = 30;

export function claveResultados(competitionId: string): string {
  return `resultados:${competitionId}`;
}

export function construirAvisosResultados(
  prueba: PruebaResultados,
  lineas: readonly LineaResultado[],
  preferencias: ReadonlyMap<string, Preferencias>,
  porDefecto: Preferencias,
): AvisoNuevo[] {
  const porPerfil = new Map<string, Map<string, LineaResultado & { motivos: Set<MotivoResultado> }>>();
  for (const linea of lineas) {
    const prefs = preferencias.get(linea.profileId) ?? porDefecto;
    if (!prefs[`tipo:${linea.motivo}`]) continue;
    const personas = porPerfil.get(linea.profileId) ?? new Map();
    porPerfil.set(linea.profileId, personas);
    const previa = personas.get(linea.clavePersona);
    if (!previa) {
      personas.set(linea.clavePersona, { ...linea, motivos: new Set([linea.motivo]) });
      continue;
    }
    previa.motivos.add(linea.motivo);
    if (previa.puesto === null && linea.puesto !== null) previa.puesto = linea.puesto;
    if (!previa.personaId && linea.personaId) previa.personaId = linea.personaId;
  }

  const nombre = nombrePrueba(prueba);
  const avisos: AvisoNuevo[] = [];
  for (const [profileId, personas] of porPerfil) {
    const filas = [...personas.values()]
      .map((p) => ({ ...p, motivo: PRIORIDAD.find((m) => p.motivos.has(m))! }))
      .sort((a, b) =>
        PRIORIDAD.indexOf(a.motivo) - PRIORIDAD.indexOf(b.motivo)
        || (a.puesto ?? Number.MAX_SAFE_INTEGER) - (b.puesto ?? Number.MAX_SAFE_INTEGER)
        || a.nombre.localeCompare(b.nombre, 'es'));
    if (filas.length === 0) continue;
    const tipo = filas[0].motivo;
    const unica = filas.length === 1 ? filas[0] : null;
    const titulo = unica
      ? `${unica.nombre}: ${puestoTexto(unica.puesto)} en ${nombre}`
      : `Resultados de ${nombre}`;
    avisos.push({
      profileId,
      tipo,
      clave: claveResultados(prueba.competitionId),
      grupo: `competicion:${prueba.competitionId}`,
      titulo: recortar(titulo, 200),
      cuerpo: recortar(unica ? prueba.nombreEdicion : `${prueba.nombreEdicion}. ${listaPersonas(filas)}`, 1000),
      url: construirUrlEdicion(prueba.editionId, {
        prueba: prueba.competitionId,
        ...(unica?.personaId ? { persona: unica.personaId } : {}),
      }),
      datos: {
        contexto: recortar(prueba.nombreEdicion, 200),
        lineas: filas.slice(0, MAX_LINEAS).map((f) => ({ nombre: f.nombre, puesto: f.puesto, motivo: f.motivo })),
      },
    });
  }
  return avisos;
}

/** Firma del contenido: si no cambia, volver a generar el aviso no lo toca. */
export function firmaAviso(a: Pick<AvisoNuevo, 'titulo' | 'cuerpo' | 'url' | 'datos'>): string {
  return JSON.stringify([a.titulo, a.cuerpo, a.url, a.datos]);
}

export function lineasDe(a: Pick<AvisoNuevo, 'datos'>): number {
  return a.datos?.lineas?.length ?? 0;
}
