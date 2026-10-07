import { construirUrlFicha, type CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import {
  aListaPerfil,
  ambitosConResultados,
  cuantosVer,
  type AmbitoResultados,
} from '@/lib/sport/explorar/resultados-perfil';
import type { ResultadosPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { Bloque, type Nivel } from '../piezas';
import { HistorialPerfil } from './historial-perfil';

/**
 * Pestaña Resultados del perfil. Prepara en el servidor la lista ya lista
 * para pintar (nombres, temporadas, enlaces) y deja el filtrado al cliente.
 * Todo sale de `perfil.resultados`, una fila por prueba individual.
 */
export function ResultadosPerfilVista({
  personaId,
  resultados,
  base,
  criterios,
  nivel,
}: {
  personaId: string;
  resultados: ResultadosPerfil;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
}) {
  const ambitos = ambitosConResultados(resultados);
  // Con un solo ámbito el selector sobra, y un `ambito` vacío en la URL no deja la pestaña en blanco.
  const ambito: AmbitoResultados = ambitos.length > 1 && criterios.ambito ? criterios.ambito : 'todo';
  const enlace = (a: AmbitoResultados) => construirUrlFicha(
    base,
    { ranking: criterios.ranking, formato: criterios.formato, volver: criterios.volver, ...(a === 'todo' ? {} : { ambito: a }) },
    'historial',
  );

  return (
    <Bloque id="historial" titulo="Resultados" nivel={nivel} tituloOculto>
      {resultados.items.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          Sin puestos finales importados.
        </p>
      ) : (
        <HistorialPerfil
          lista={aListaPerfil(resultados, personaId)}
          ambitoInicial={ambito}
          verInicial={cuantosVer(criterios.ver ?? 0, resultados.items.length)}
          enlacesAmbito={ambitos.length > 1
            ? { todo: enlace('todo'), internacional: enlace('internacional'), nacional: enlace('nacional') }
            : null}
          encabezado={nivel === 'pagina' ? 'h3' : 'h4'}
        />
      )}
    </Bloque>
  );
}
