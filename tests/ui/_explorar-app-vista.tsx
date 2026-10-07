/**
 * El contenido de cada pestaña de Explorar tal y como lo pintan sus páginas,
 * pero síncrono y con los datos ya leídos: el servidor de capturas lo pinta con
 * `renderToString` y el navegador lo hidrata con el mismo árbol.
 */
import { BuscadorPaises } from '@/components/explorar/buscador-paises';
import { PropuestasBuscador } from '@/components/explorar/buscador-social-fila';
import { CabeceraExplorar } from '@/components/explorar/cabecera-explorar';
import { PantallaEdiciones } from '@/components/explorar/catalogo-ediciones';
import type { VistaCatalogo } from '@/lib/sport/explorar/catalogo';
import type { CriteriosCatalogo } from '@/lib/sport/explorar/catalogo-url';
import type { VistaSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { PantallaListaSiguiendo } from '@/components/explorar/pantalla-siguiendo';
import { CabeceraInicio, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { VistaBuscar } from '@/components/explorar/vista-buscar';
import { construirUrlInicio } from '@/lib/sport/explorar/inicio-url';
import type { VistaInicio, VistaListaSiguiendo } from '@/lib/sport/explorar/inicio-pantalla';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import type { PersonaParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import type { CriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import type { CriteriosExplorar, OpcionTemporada } from '@/lib/sport/explorar/url';

export type DatosExplorarApp = { cuenta: string } & (
  | { vista: 'inicio'; criterios: CriteriosSiguiendo; inicio: Exclude<VistaInicio['vista'], { tipo: 'sin_sesion' }>; siguiendo: number | null; limite: number }
  | {
      vista: 'buscar';
      criterios: CriteriosExplorar;
      cursor?: string;
      explorar: Exclude<VistaExplorar, { tipo: 'sin_sesion' }>;
      temporadas: OpcionTemporada[];
      propuestas: PersonaParaSeguir[] | null;
    }
  | { vista: 'siguiendo'; lista: Exclude<VistaListaSiguiendo, { tipo: 'sin_sesion' }> }
  | { vista: 'ediciones'; catalogo: VistaCatalogo; criterios: CriteriosCatalogo; cursor?: string; series: VistaSeries; anioActual: number }
  | { vista: 'paises'; q: string }
);

export function contenidoExplorar(d: DatosExplorarApp) {
  if (d.vista === 'inicio') {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1 lg:mx-auto lg:max-w-2xl">
        <CabeceraInicio criterios={d.criterios} />
        {d.inicio.tipo === 'ok' && !d.inicio.sinResultados ? (
          <FeedSiguiendo key={construirUrlInicio(d.criterios)} items={d.inicio.items} siguiente={d.inicio.siguiente} criterios={d.criterios} limite={d.limite} />
        ) : (
          <EstadoSiguiendo vista={d.inicio} criterios={d.criterios} siguiendo={d.siguiendo} />
        )}
      </div>
    );
  }
  if (d.vista === 'buscar') {
    return (
      <VistaBuscar
        criterios={d.criterios}
        cursor={d.cursor}
        vista={d.explorar}
        temporadas={d.temporadas}
        atajoEspana
        profileId={d.cuenta}
        sugerencias={d.propuestas?.length === 0 ? null : <PropuestasBuscador propuestas={d.propuestas} className="lg:max-w-2xl" />}
      />
    );
  }
  if (d.vista === 'ediciones') {
    return <PantallaEdiciones catalogo={d.catalogo} criterios={d.criterios} cursor={d.cursor} series={d.series} anioActual={d.anioActual} />;
  }
  if (d.vista === 'paises') {
    // Lo mismo que `PantallaPaises` de `pantalla-buscar.tsx`.
    return (
      <div className="flex w-full min-w-0 flex-col gap-3 lg:mx-auto lg:max-w-2xl">
        <CabeceraExplorar activa="paises" />
        <BuscadorPaises qInicial={d.q} />
      </div>
    );
  }
  return <PantallaListaSiguiendo vista={d.lista} />;
}
