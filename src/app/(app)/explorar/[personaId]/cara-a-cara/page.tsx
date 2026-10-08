import { redirect } from 'next/navigation';
import { cache } from 'react';
import { RelevosCaraACaraVista } from '@/components/explorar/relevos';
import {
  CabeceraCaraACara,
  CaraACaraCompleto,
  ElegirRival,
  EstadoCaraACara,
} from '@/components/explorar/cara-a-cara';
import { FiltrosCaraACara } from '@/components/explorar/filtros-cara-a-cara';
import { SeccionRendimientoCaraACara } from '@/components/explorar/graficos/seccion-rendimiento-cara-a-cara';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarCaraACaraCompartida } from '@/lib/sport/explorar/cache-real';
import { construirUrlCaraACara, leerCriteriosCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { personaDeRuta } from '@/lib/sport/explorar/ficha-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { opcionesTemporada } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { titular } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Consulta = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ personaId: string }>;
  searchParams: Promise<Consulta>;
}): Promise<{ title: string }> {
  if (!(await getSessionProfile())) return { title: 'Cara a cara' };
  const [{ personaId: segmento }, consulta] = await Promise.all([params, searchParams]);
  const { vista } = await leerPantalla(segmento, JSON.stringify(consulta));
  const nombre = (p: { nombre: string }) => nombreVisible(p.nombre) || titular(p.nombre);
  if (vista.tipo === 'ok') {
    const { yo, rival } = vista.datos.personas;
    return { title: `${nombre(yo)} y ${nombre(rival)} · Cara a cara` };
  }
  if (vista.tipo === 'elegir') return { title: `${nombre(vista.persona)} · Cara a cara` };
  return { title: 'Cara a cara' };
}

/**
 * Sólo se llama tras la guarda de sesión. Una lectura por petición para la
 * página y su título: `cache` necesita argumentos primitivos, así que la
 * consulta va serializada.
 */
const leerPantalla = cache(async (segmento: string, consultaJson: string) => {
  const personaId = personaDeRuta(segmento);
  const criterios = leerCriteriosCaraACara(JSON.parse(consultaJson) as Consulta);
  const { vista, relevos } = personaId
    ? await cargarCaraACaraCompartida(contextoReal(), personaId, criterios)
    : ({ vista: { tipo: 'entrada_invalida' }, relevos: null } as const);
  return { personaId, criterios, vista, relevos };
});

/**
 * Cara a cara individual de una persona con un rival, abierto siempre por
 * identificadores: dos homónimos nunca se mezclan. Es una ruta común a todas
 * las cuentas con sesión (propia o ajena, seleccionador o tirador) y sólo
 * lee hechos deportivos publicados: ningún ranking interno ni dato de cuenta.
 *
 * La guarda de sesión va aquí además de en el layout, porque la ruta se puede
 * abrir escribiendo la dirección. Persona, rival y filtros viven en la URL;
 * el cursor sólo vale para la consulta que lo emitió. Nada aquí llama a una
 * fuente externa.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ personaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [{ personaId: segmento }, consulta] = await Promise.all([params, searchParams]);
  // Duelo y relevos llegan juntos de la caché compartida: la página se pinta entera de una vez.
  const { personaId, criterios, vista, relevos } = await leerPantalla(segmento, JSON.stringify(consulta));
  if (vista.tipo === 'sin_sesion') redirect('/entrar');

  const hoy = new Date().toISOString().slice(0, 10);
  // Con rival, la persona canónica sale del DTO; sin rival, de la cabecera leída.
  const persona =
    vista.tipo === 'ok' ? vista.datos.personas.yo : vista.tipo === 'elegir' ? vista.persona : null;
  // Los cursores van ligados al identificador de la ruta: una ficha fusionada
  // se abre siempre por la persona que prevalece, desde la primera página.
  if (persona && personaId && persona.id !== personaId) {
    redirect(construirUrlCaraACara(persona.id, { ...criterios, cursor: '' }));
  }
  const nombre = persona ? nombreVisible(persona.nombre) || titular(persona.nombre) : '';
  const filtros = persona ? (
    <FiltrosCaraACara
      key={JSON.stringify(criterios)}
      personaId={persona.id}
      criterios={criterios}
      temporadas={opcionesTemporada(hoy)}
    />
  ) : null;

  if (vista.tipo === 'ok') {
    const { yo, rival } = vista.datos.personas;
    return (
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4">
        <CabeceraCaraACara datos={vista.datos} criterios={criterios} />
        {filtros}
        <CaraACaraCompleto
          datos={vista.datos}
          criterios={criterios}
          rendimiento={
            vista.rendimiento ? (
              <SeccionRendimientoCaraACara
                datos={vista.rendimiento}
                yo={vista.datos.personas.yo}
                rival={vista.datos.personas.rival}
                titulo="Evolución"
                sinResumen
              />
            ) : null
          }
        />
        {/* Aparte del balance: los relevos no suman a los asaltos individuales. */}
        <RelevosCaraACaraVista datos={relevos} yo={yo} rival={rival} />
      </div>
    );
  }

  // Sin rival: la página de elegir, para enlaces directos y sin JavaScript. Desde el perfil se elige en una hoja.
  // «Cara a cara», en la cabecera compacta, es un rótulo: el `<h1>` es el nombre.
  return (
    <div className="flex flex-col gap-6">
      {vista.tipo === 'elegir' ? (
        <h1 className="font-sans text-base leading-5 font-semibold tracking-normal break-words [text-wrap:wrap]">{nombre}</h1>
      ) : null}

      {vista.tipo === 'elegir' ? filtros : null}

      {vista.tipo === 'elegir' ? (
        <ElegirRival persona={vista.persona} rivales={vista.rivales} otros={vista.otros} criterios={criterios} />
      ) : (
        <EstadoCaraACara vista={vista} personaId={personaId} criterios={criterios} />
      )}
    </div>
  );
}
