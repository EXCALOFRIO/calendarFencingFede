import { redirect } from 'next/navigation';
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
export const metadata = { title: 'Cara a cara' };

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
  const personaId = personaDeRuta(segmento);
  const criterios = leerCriteriosCaraACara(consulta);

  // Duelo y relevos llegan juntos de la caché compartida: la página se pinta entera de una vez.
  const { vista, relevos } = personaId
    ? await cargarCaraACaraCompartida(contextoReal(), personaId, criterios)
    : ({ vista: { tipo: 'entrada_invalida' }, relevos: null } as const);
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

  // El título («Cara a cara») lo pone la cabecera compacta de la aplicación (`cabeceraDeRuta`).
  return (
    <div className="flex flex-col gap-6">
      {vista.tipo === 'elegir' ? (
        <p className="text-[16px] leading-[20px] font-semibold break-words">{nombre}</p>
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
