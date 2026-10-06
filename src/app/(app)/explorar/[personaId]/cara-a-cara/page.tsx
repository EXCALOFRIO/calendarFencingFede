import { redirect } from 'next/navigation';
import {
  CabeceraCaraACara,
  CaraACaraCompleto,
  ChipsCaraACara,
  ElegirRival,
  EstadoCaraACara,
} from '@/components/explorar/cara-a-cara';
import { FiltrosCaraACara } from '@/components/explorar/filtros-cara-a-cara';
import { SeccionRendimientoCaraACara } from '@/components/explorar/graficos/seccion-rendimiento-cara-a-cara';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
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

  const vista = personaId
    ? await cargarCaraACaraPantalla(contextoReal(), personaId, criterios)
    : ({ tipo: 'entrada_invalida' } as const);
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {vista.tipo === 'elegir' ? (
        <h1 className="text-2xl break-words sm:text-3xl">Cara a cara de {nombre}</h1>
      ) : (
        <h1 className="text-2xl sm:text-3xl">Cara a cara</h1>
      )}

      {vista.tipo === 'elegir' && persona ? (
        <div className="flex flex-col gap-3">
          {filtros}
          <ChipsCaraACara personaId={persona.id} criterios={criterios} />
        </div>
      ) : null}

      {vista.tipo === 'elegir' ? (
        <ElegirRival persona={vista.persona} rivales={vista.rivales} otros={vista.otros} criterios={criterios} />
      ) : (
        <EstadoCaraACara vista={vista} personaId={personaId} criterios={criterios} />
      )}
    </div>
  );
}
