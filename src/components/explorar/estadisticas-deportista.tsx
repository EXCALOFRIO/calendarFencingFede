import { agruparDesglose } from '@/lib/sport/explorar/estadisticas';
import type { EstadisticasDeportista } from '@/lib/sport/explorar/tipos';
import type { Nivel } from './piezas';
import { CategoriasPerfil } from './perfil/categorias-perfil';

/**
 * Desglose por categoría del historial individual importado, para cuando el
 * perfil no trae la lectura por prueba. Agrupa por el código normalizado de
 * la categoría, nunca por el literal de cada fuente. Esta lectura no separa
 * platas y bronces: enseña oros y podios.
 */
export function EstadisticasDeportistaVista({ detalle, nivel = 'pagina' }: { detalle: EstadisticasDeportista; nivel?: Nivel }) {
  if (detalle.resumen.pruebas === 0) {
    return (
      <p role="status" className="medida text-sm text-muted-foreground">
        No hay clasificaciones individuales importadas.
      </p>
    );
  }
  const categorias = agruparDesglose(detalle, 'categoria').map((g) => ({
    clave: g.categoria?.codigo ?? '',
    competiciones: g.pruebas,
    mejorPuesto: g.mejorPuesto,
    oros: g.victorias,
    platas: null,
    bronces: null,
    podios: g.podios,
  }));
  return <CategoriasPerfil categorias={categorias} nivel={nivel} />;
}
