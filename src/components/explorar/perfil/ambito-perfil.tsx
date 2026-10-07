import { Globe2, MapPin } from 'lucide-react';
import type {
  EstadisticasPorAmbito,
  ResumenCompeticiones,
  TipoCompeticion,
  TonoTipo,
} from '@/lib/sport/explorar/tipos-social';
import { EtiquetaTipoCompeticion } from '../etiqueta-competicion';
import { Bloque, Nota, type Nivel } from '../piezas';
import { Medallero } from './medallas';

const pct = (p: number | null) => (p === null ? null : Math.round(p * 100));

function TarjetaAmbito({ clave, rotulo, r }: { clave: 'internacional' | 'nacional'; rotulo: string; r: ResumenCompeticiones }) {
  const Icono = clave === 'internacional' ? Globe2 : MapPin;
  const p = pct(r.porcentajeVictorias);
  return (
    <div data-ambito={clave} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Icono className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
          <span className="truncate">{rotulo}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          <span className="cifra text-lg text-foreground">{r.competiciones}</span>
        </span>
      </div>
      {r.competiciones === 0 ? (
        <p className="text-xs text-muted-foreground">Sin pruebas</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[12px] leading-none text-muted-foreground">Mejor</dt>
              <dd className="cifra text-3xl leading-none">{r.mejorPuesto !== null ? `${r.mejorPuesto}º` : '—'}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[12px] leading-none text-muted-foreground">Ganados</dt>
              <dd className="cifra text-3xl leading-none">{p !== null ? `${p}%` : '—'}</dd>
            </div>
          </dl>
          <Medallero oros={r.oros} platas={r.platas} bronces={r.bronces} />
        </>
      )}
    </div>
  );
}

function FilaTipo({ t }: { t: ResumenCompeticiones & { tono: TonoTipo } }) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 bg-card px-3 py-2.5 sm:px-4">
      <span className="flex min-w-0">
        <EtiquetaTipoCompeticion
          larga
          clasificacion={{ tipo: t.clave as TipoCompeticion, etiqueta: t.etiqueta, corta: t.etiqueta, tono: t.tono }}
        />
      </span>
      <span className="flex min-w-0 justify-end">
        <Medallero oros={t.oros} platas={t.platas} bronces={t.bronces} ocultarCeros className="justify-end" />
      </span>
      <span className="flex flex-col items-end leading-none">
        <span className="cifra text-xl">{t.competiciones}</span>
        <span className="text-[12px] text-muted-foreground">{t.mejorPuesto !== null ? `mejor ${t.mejorPuesto}º` : 'pruebas'}</span>
      </span>
    </li>
  );
}

/**
 * Internacional frente a nacional en dos tarjetas, y el reparto por tipo de
 * competición. El tipo es una lectura del nombre y del calendario, no un dato
 * oficial.
 */
export function AmbitoPerfil({ ambito, nivel }: { ambito: EstadisticasPorAmbito; nivel: Nivel }) {
  if (ambito.total.competiciones === 0) return null;
  return (
    <Bloque id="ficha-ambito" titulo="Por tipo de competición" nivel={nivel}>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <TarjetaAmbito clave="internacional" rotulo="Internacional" r={ambito.internacional} />
        <TarjetaAmbito clave="nacional" rotulo="Nacional" r={ambito.nacional} />
      </div>
      {ambito.porTipo.length > 0 ? (
        <ul className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border" aria-label="Por tipo de competición">
          {ambito.porTipo.map((t) => <FilaTipo key={t.clave} t={t} />)}
        </ul>
      ) : null}
      {ambito.truncado ? <Nota>Tiene más pruebas de las que se leen de una vez: estas cifras son parciales.</Nota> : null}
    </Bloque>
  );
}
