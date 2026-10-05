import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CATEGORY_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { etiquetaTipoEstadistico } from '@/lib/sport/explorar/estadisticas-tipo';
import { agruparDesglose, type EjeDesglose, type GrupoDesglose } from '@/lib/sport/explorar/estadisticas';
import type { EstadisticasDeportista } from '@/lib/sport/explorar/tipos';
import { fechaLegible, Nota } from './piezas';

const EJES: ReadonlyArray<{ eje: EjeDesglose; etiqueta: string }> = [
  { eje: 'tipo', etiqueta: 'Tipo de torneo' },
  { eje: 'categoria', etiqueta: 'Categoría' },
  { eje: 'arma', etiqueta: 'Arma' },
];

function etiquetaGrupo(g: GrupoDesglose): string {
  if (g.arma) return WEAPON_LABEL[g.arma];
  if (g.categoria) {
    const nombre = CATEGORY_LABEL[g.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? g.categoria.codigo;
    return g.categoria.raw && g.categoria.raw !== nombre ? `${nombre} («${g.categoria.raw}»)` : nombre;
  }
  return etiquetaTipoEstadistico(g.tipo);
}

function Valor({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[0.6875rem] leading-tight text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function FilaGrupo({ g, total, maximo }: { g: GrupoDesglose; total: number; maximo: number }) {
  return (
    <li className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-medium break-words">{etiquetaGrupo(g)}</p>
        <div aria-hidden="true" className="h-1 bg-muted">
          <div className="h-full bg-primary" style={{ width: `${(g.pruebas / maximo) * 100}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{g.pruebas} de {total} pruebas importadas</p>
      </div>
      <dl className="grid grid-cols-4 gap-x-3">
        <Valor etiqueta="Con puesto"><span className="cifra text-2xl leading-none sm:text-3xl">{g.conPuesto}</span></Valor>
        <Valor etiqueta="Mejor puesto">
          {g.mejorPuesto === null
            ? <span className="text-xs text-muted-foreground">No publicado</span>
            : <span className="cifra text-2xl leading-none sm:text-3xl">{g.mejorPuesto}º</span>}
        </Valor>
        <Valor etiqueta="Podios"><span className="cifra text-2xl leading-none sm:text-3xl">{g.podios}</span></Valor>
        <Valor etiqueta="Oros"><span className="cifra text-2xl leading-none sm:text-3xl">{g.victorias}</span></Valor>
      </dl>
    </li>
  );
}

/**
 * Desglose del historial individual importado por tipo de torneo, categoría
 * publicada y arma, en pestañas. Todas las pestañas salen en el HTML del
 * servidor (`forceMount`): sin JavaScript se leen igual, sólo las inactivas
 * quedan ocultas.
 */
export function EstadisticasDeportistaVista({ detalle }: { detalle: EstadisticasDeportista }) {
  const r = detalle.resumen;
  if (r.pruebas === 0) {
    return (
      <p role="status" className="medida text-sm text-muted-foreground">
        No hay clasificaciones individuales importadas. Puede que falte importar esa información;
        no equivale a cero participaciones ni a derrotas.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Tabs defaultValue="tipo" className="min-w-0 gap-3">
        <TabsList aria-label="Desglosar por" className="h-auto w-full sm:w-fit">
          {EJES.map((e) => (
            <TabsTrigger key={e.eje} value={e.eje} className="min-h-11 px-3 sm:px-4">
              {e.etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>
        {EJES.map((e) => {
          const grupos = agruparDesglose(detalle, e.eje);
          const maximo = Math.max(1, ...grupos.map((g) => g.pruebas));
          return (
            <TabsContent key={e.eje} value={e.eje} forceMount className="min-w-0 data-[state=inactive]:hidden">
              <ul className="divide-y border-y bg-card" aria-label={`Estadísticas por ${e.etiqueta.toLowerCase()}`}>
                {grupos.map((g) => <FilaGrupo key={g.clave} g={g} total={r.pruebas} maximo={maximo} />)}
              </ul>
            </TabsContent>
          );
        })}
      </Tabs>
      <div className="flex flex-col gap-2">
        {r.conflictos > 0 ? (
          <p className="medida text-sm">
            {r.conflictos} {r.conflictos === 1 ? 'prueba con resultados en conflicto. Cuenta' : 'pruebas con resultados en conflicto. Cuentan'} en el conjunto, pero no en los
            puestos numéricos, podios ni oros.
          </p>
        ) : null}
        {detalle.categoriasRecortadas ? <Nota>Desglose limitado a 120 grupos. Los totales incluyen todos los grupos importados.</Nota> : null}
        <Nota>
          Historia parcial: sólo clasificaciones individuales importadas, no una carrera completa. Los
          equipos quedan fuera. Fechas de competición publicadas: {r.desde && r.hasta
            ? `${fechaLegible(r.desde)} a ${fechaLegible(r.hasta)}`
            : 'no publicadas'}; {r.sinFecha} {r.sinFecha === 1 ? 'prueba' : 'pruebas'} sin fecha verificable.
        </Nota>
        <Nota>
          Una inscripción sin final no cuenta como participación. Sólo se unen resultados idénticos
          de la misma prueba o de pruebas con equivalencia explícita. Un resultado discrepante no se
          convierte en puesto cero. El tipo nunca se deduce del título: «Tipo no publicado» significa
          que el historial importado no conserva evidencia verificable del tipo.
        </Nota>
      </div>
    </div>
  );
}
