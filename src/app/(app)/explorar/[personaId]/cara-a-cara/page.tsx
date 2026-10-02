import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CabeceraCaraACara,
  CaraACaraCompleto,
  ChipsCaraACara,
  ElegirRival,
  EstadoCaraACara,
} from '@/components/explorar/cara-a-cara';
import { FiltrosCaraACara } from '@/components/explorar/filtros-cara-a-cara';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarCaraACaraPantalla } from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { construirUrlCaraACara, leerCriteriosCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { personaDeRuta } from '@/lib/sport/explorar/ficha-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_EXPLORAR, opcionesTemporada, rutaFicha } from '@/lib/sport/explorar/url';
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
  const conFiltros = vista.tipo === 'ok' || vista.tipo === 'elegir';
  // Con rival, la persona canónica sale del DTO; sin rival, de la cabecera leída.
  const persona =
    vista.tipo === 'ok' ? vista.datos.personas.yo : vista.tipo === 'elegir' ? vista.persona : null;
  // Los cursores van ligados al identificador de la ruta: una ficha fusionada
  // se abre siempre por la persona que prevalece, desde la primera página.
  if (persona && personaId && persona.id !== personaId) {
    redirect(construirUrlCaraACara(persona.id, { ...criterios, cursor: '' }));
  }
  const atras = persona ? rutaFicha(persona.id) : RUTA_EXPLORAR;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Volver">
        <Link
          href={atras}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {persona ? `Volver a la ficha de ${titular(persona.nombre)}` : 'Volver a Explorar'}
        </Link>
      </nav>

      {vista.tipo === 'ok' && persona ? (
        <CabeceraCaraACara datos={vista.datos} criterios={criterios} />
      ) : vista.tipo === 'elegir' ? (
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl break-words sm:text-3xl">Cara a cara de {titular(vista.persona.nombre)}</h1>
          <p className="medida text-sm text-muted-foreground">
            Elige un rival para ver sus asaltos individuales, poule y eliminación directa, con el
            marcador desde la ficha de {titular(vista.persona.nombre)}.
          </p>
        </header>
      ) : (
        <h1 className="text-2xl sm:text-3xl">Cara a cara</h1>
      )}

      {conFiltros && persona ? (
        <div className="flex flex-col gap-3">
          <FiltrosCaraACara
            key={JSON.stringify(criterios)}
            personaId={persona.id}
            criterios={criterios}
            temporadas={opcionesTemporada(hoy)}
          />
          <ChipsCaraACara personaId={persona.id} criterios={criterios} />
        </div>
      ) : null}

      {vista.tipo === 'ok' ? (
        <CaraACaraCompleto datos={vista.datos} criterios={criterios} />
      ) : vista.tipo === 'elegir' ? (
        <ElegirRival persona={vista.persona} rivales={vista.rivales} otros={vista.otros} criterios={criterios} />
      ) : (
        <EstadoCaraACara vista={vista} personaId={personaId} criterios={criterios} />
      )}
    </div>
  );
}
