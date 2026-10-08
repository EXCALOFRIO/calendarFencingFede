import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { DueloPaisesVista } from '@/components/explorar/pais/duelo-paises';
import { EstadoPais } from '@/components/explorar/pais/piezas-pais';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarDueloPaisesCompartido } from '@/lib/sport/explorar/pais-cache-real';
import { codigoPaisDeRuta, nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { frasesDuelo } from '@/lib/sport/explorar/pais-frases';
import { leerCursorDuelo, leerFiltrosDuelo, rutaPais, urlDuelo } from '@/lib/sport/explorar/pais-url';
import { contextoReal } from '@/lib/sport/explorar/real';

export const dynamic = 'force-dynamic';

type Consulta = Record<string, string | string[] | undefined>;

/**
 * Balance y primera página (de la caché compartida) y, con `desde=`, la página
 * pedida, que va directa a D1. Una lectura por petición para la página y su título.
 */
const leerPantalla = cache(async (segmentoA: string, segmentoB: string, consultaJson: string) => {
  const consulta = JSON.parse(consultaJson) as Consulta;
  const codigo = codigoPaisDeRuta(segmentoA);
  const rival = codigoPaisDeRuta(segmentoB);
  const filtros = leerFiltrosDuelo(consulta);
  const desde = leerCursorDuelo(consulta);
  if (!codigo || !rival) return { codigo, rival, filtros, desde, vista: { tipo: 'no_existe' } as const, pagina: null };
  const ctx = contextoReal();
  const [vista, pagina] = await Promise.all([
    cargarDueloPaisesCompartido(ctx, codigo, rival, filtros, ''),
    desde ? cargarDueloPaisesCompartido(ctx, codigo, rival, filtros, desde) : Promise.resolve(null),
  ]);
  return { codigo, rival, filtros, desde, vista, pagina };
});

export async function generateMetadata({ params }: { params: Promise<{ codigo: string; otro: string }> }): Promise<{ title: string }> {
  const p = await params;
  const codigo = codigoPaisDeRuta(p.codigo);
  const rival = codigoPaisDeRuta(p.otro);
  return { title: codigo && rival ? `${nombrePaisFie(codigo)} y ${nombrePaisFie(rival)}` : 'Cara a cara' };
}

/**
 * Cara a cara de dos selecciones: asaltos individuales entre tiradores de los
 * dos países y encuentros por equipos, con filtros de arma, género, categoría,
 * temporada y modalidad en la query. Cada tirador enlaza a su ficha y a su
 * cara a cara personal; cada encuentro por equipos, a su alineación y sus
 * relevos cuando la fuente los publica.
 */
export default async function Pagina({
  params,
  searchParams,
}: {
  params: Promise<{ codigo: string; otro: string }>;
  searchParams: Promise<Consulta>;
}) {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  const [p, consulta] = await Promise.all([params, searchParams]);
  const { codigo, rival, filtros, desde, vista, pagina } = await leerPantalla(p.codigo, p.otro, JSON.stringify(consulta));
  if (codigo && rival && (p.codigo !== codigo || p.otro !== rival)) redirect(urlDuelo(codigo, rival, filtros, desde || undefined));
  if (vista.tipo === 'sin_sesion' || pagina?.tipo === 'sin_sesion') redirect('/entrar');
  if (vista.tipo === 'no_existe' || !codigo || !rival) notFound();

  if (vista.tipo === 'ok') {
    const datos = vista.datos;
    // Si la página pedida falla se dice en la lista; antes se enseñaba la primera como si fuera ella.
    const fallida = Boolean(desde) && pagina?.tipo !== 'ok';
    const paginaVista = pagina?.tipo === 'ok' ? pagina.datos : datos;
    return (
      <DueloPaisesVista
        duelo={datos}
        pagina={paginaVista}
        filtros={filtros}
        categorias={datos.categorias}
        frases={frasesDuelo(nombrePaisFie(codigo), nombrePaisFie(rival), datos, filtros)}
        desde={desde}
        paginaFallida={fallida}
      />
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl">
      {vista.tipo === 'sin_datos' ? (
        <EstadoPais titulo="Aún sin datos" linea="Las cifras por país se están preparando." volver={{ href: rutaPais(codigo), texto: nombrePaisFie(codigo) }} />
      ) : (
        <EstadoPais titulo="No se pudo cargar" linea="Vuelve a intentarlo en un momento." volver={{ href: urlDuelo(codigo, rival, filtros), texto: 'Reintentar' }} />
      )}
    </div>
  );
}
