import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { FichaPaisVista } from '@/components/explorar/pais/ficha-pais';
import { EstadoPais } from '@/components/explorar/pais/piezas-pais';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarFichaPaisCompartida } from '@/lib/sport/explorar/pais-cache-real';
import { codigoPaisDeRuta, nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { frasesPais } from '@/lib/sport/explorar/pais-frases';
import { leerFiltrosPais, urlPais } from '@/lib/sport/explorar/pais-url';
import { contextoReal } from '@/lib/sport/explorar/real';
import { RUTA_BUSCAR } from '@/lib/sport/explorar/url';

export const dynamic = 'force-dynamic';

type Consulta = Record<string, string | string[] | undefined>;

/** Una lectura por petición para la página y su título (`cache` quiere argumentos primitivos). */
const leerPantalla = cache(async (segmento: string, consultaJson: string) => {
  const codigo = codigoPaisDeRuta(segmento);
  const filtros = leerFiltrosPais(JSON.parse(consultaJson) as Consulta);
  const vista = codigo
    ? await cargarFichaPaisCompartida(contextoReal(), codigo, filtros)
    : ({ tipo: 'no_existe' } as const);
  return { codigo, filtros, vista };
});

export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }): Promise<{ title: string }> {
  const codigo = codigoPaisDeRuta((await params).codigo);
  return { title: codigo ? nombrePaisFie(codigo) : 'País' };
}

/**
 * Ficha de un país: su rendimiento internacional con filtros de arma, género,
 * categoría y modalidad, y el selector de rival para el cara a cara de
 * selecciones. Común a todas las cuentas con sesión y sólo con hechos
 * deportivos publicados. El código va en mayúsculas (`/explorar/pais/ESP`):
 * uno en minúsculas redirige a su forma canónica.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ codigo: string }>;
  searchParams: Promise<Consulta>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [{ codigo: segmento }, consulta] = await Promise.all([params, searchParams]);
  const { codigo, filtros, vista } = await leerPantalla(segmento, JSON.stringify(consulta));
  if (codigo && segmento !== codigo) redirect(urlPais(codigo, filtros));
  if (vista.tipo === 'sin_sesion') redirect('/entrar');
  if (vista.tipo === 'no_existe' || !codigo) notFound();

  if (vista.tipo === 'ok') {
    return <FichaPaisVista ficha={vista.datos} filtros={filtros} frases={frasesPais(nombrePaisFie(codigo), vista.datos, filtros)} />;
  }
  return (
    <div className="mx-auto w-full max-w-3xl">
      {vista.tipo === 'sin_datos' ? (
        <EstadoPais titulo="Aún sin datos" linea="Las cifras por país se están preparando." volver={{ href: RUTA_BUSCAR, texto: 'Buscar' }} />
      ) : (
        <EstadoPais titulo="No se pudo cargar" linea="Vuelve a intentarlo en un momento." volver={{ href: urlPais(codigo, filtros), texto: 'Reintentar' }} />
      )}
    </div>
  );
}
