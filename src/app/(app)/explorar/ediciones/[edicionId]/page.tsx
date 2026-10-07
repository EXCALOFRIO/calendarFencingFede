import { redirect } from 'next/navigation';
import { cache } from 'react';
import { EdicionCompleta, EstadoEdicion } from '@/components/explorar/ediciones';
import { getSessionProfile } from '@/lib/auth/session';
import { edicionDeRuta, leerCriteriosEdicion } from '@/lib/sport/explorar/edicion-url';
import { cargarEdicionCompartida } from '@/lib/sport/explorar/cache-real';
import { urlEventoCalendario } from '@/lib/sport/explorar/enlaces-calendario';
import { eventoDeEdicionCompartido } from '@/lib/sport/explorar/enlaces-calendario-real';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { contextoReal } from '@/lib/sport/explorar/real';

export const dynamic = 'force-dynamic';

type Consulta = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ edicionId: string }>;
  searchParams: Promise<Consulta>;
}): Promise<{ title: string }> {
  if (!(await getSessionProfile())) return { title: 'Edición' };
  const [{ edicionId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const { vista } = await leerPantalla(segmento, JSON.stringify(consulta));
  if (vista.tipo !== 'ok') return { title: 'Edición' };
  return { title: nombrePrueba({ nombre: vista.edicion.nombre, fuente: vista.edicion.fuente }) };
}

/**
 * Sólo se llama tras la guarda de sesión. Una lectura por petición para la
 * página y su título (`cache` quiere argumentos primitivos).
 */
const leerPantalla = cache(async (segmento: string, consultaJson: string) => {
  const edicionId = edicionDeRuta(segmento);
  const criterios = leerCriteriosEdicion(JSON.parse(consultaJson) as Consulta);
  const vista = edicionId
    ? await cargarEdicionCompartida(contextoReal(), edicionId, criterios)
    : ({ tipo: 'entrada_invalida' } as const);
  return { criterios, vista };
});

/**
 * Una edición con un selector de sus pruebas y la clasificación, las poules y
 * las directas de la elegida (`prueba=`; sin ella, la primera con puestos).
 * `vista=` abre poules o directas y `persona=` resalta a esa persona en las
 * tres vistas. Cada nombre vinculado abre la ficha deportiva de esa persona
 * (nunca una cuenta) y la ficha vuelve aquí con la misma prueba, vista y
 * persona resaltada. La fecha de la cabecera abre el torneo en el calendario
 * (su ficha, con información y documentos) cuando la edición es uno de sus
 * torneos (`enlaces-calendario.ts`).
 *
 * La guarda de sesión va aquí además de en el layout porque la ruta se puede
 * abrir escribiendo la dirección; nada se consulta antes de ella.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ edicionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [{ edicionId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const edicionId = edicionDeRuta(segmento);
  // El torneo del calendario va en paralelo y aparte: si falla, sólo falta su enlace.
  const [{ criterios, vista }, evento] = await Promise.all([
    leerPantalla(segmento, JSON.stringify(consulta)),
    edicionId ? eventoDeEdicionCompartido(contextoReal(), edicionId) : Promise.resolve(null),
  ]);
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  return vista.tipo === 'ok' ? (
    <EdicionCompleta
      edicion={vista.edicion}
      criterios={criterios}
      conjunta={vista.conjunta ?? null}
      calendario={evento ? urlEventoCalendario(evento, criterios.origen) : null}
    />
  ) : (
    <EstadoEdicion vista={vista} />
  );
}
