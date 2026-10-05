import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type {
  AsaltoDePrueba,
  PouleDePrueba,
  RondaCuadro,
  TiradorAsalto,
} from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { Nota } from './piezas';

const ENLACE_NOMBRE =
  'rounded-sm underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

function Nombre({ t, volver, className }: { t: { personaId: string | null; nombre: string }; volver: string; className?: string }) {
  const texto = nombreVisible(t.nombre);
  if (!t.personaId) return <span className={cn('break-words', className)}>{texto}</span>;
  return (
    <Link href={rutaFichaConRetorno(t.personaId, volver)} prefetch={false} className={cn(ENLACE_NOMBRE, 'break-words', className)}>
      {texto}
    </Link>
  );
}

/* --------------------------------------------------------------------- poules */

function Poule({ poule, volver }: { poule: PouleDePrueba; volver: string }) {
  const id = `poule-${poule.ronda}`;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h3 id={id} className="text-lg leading-tight">{poule.etiqueta}</h3>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">
            {poule.etiqueta}: tantos de cada fila contra cada columna. V indica victoria.
          </caption>
          <thead>
            <tr className="border-b bg-secondary text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-2 text-right font-medium">#</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Tirador</th>
              {poule.filas.map((_, i) => (
                <th key={i} scope="col" className="w-9 px-1 py-2 text-center font-medium">
                  <span className="sr-only">Contra el </span>{i + 1}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-medium"><abbr title="Victorias">V</abbr></th>
              <th scope="col" className="px-2 py-2 text-center font-medium"><abbr title="Tocados dados">TD</abbr></th>
              <th scope="col" className="px-2 py-2 text-center font-medium"><abbr title="Tocados recibidos">TR</abbr></th>
              <th scope="col" className="px-2 py-2 text-center font-medium"><abbr title="Índice (TD − TR)">Ind</abbr></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {poule.filas.map((f, i) => {
              const indice = f.tocados - f.recibidos;
              return (
                <tr key={f.clave}>
                  <td className="cifra px-2 py-2 text-right text-muted-foreground">{i + 1}</td>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex min-w-0 items-center gap-2">
                      {f.pais ? <BanderaPais pais={f.pais} /> : null}
                      <Nombre t={f} volver={volver} className="font-medium" />
                    </span>
                  </th>
                  {f.celdas.map((c, j) => (
                    <td
                      key={j}
                      className={cn(
                        'cifra border-l px-1 py-2 text-center',
                        i === j && 'bg-muted',
                        c?.victoria && 'font-semibold text-ok',
                      )}
                    >
                      {i === j ? <span className="sr-only">—</span> : c ? `${c.victoria ? 'V' : ''}${c.tantos}` : <span className="text-muted-foreground">·</span>}
                    </td>
                  ))}
                  <td className="cifra border-l px-2 py-2 text-center font-semibold">{f.victorias}</td>
                  <td className="cifra px-2 py-2 text-center">{f.tocados}</td>
                  <td className="cifra px-2 py-2 text-center">{f.recibidos}</td>
                  <td className="cifra px-2 py-2 text-center">{indice > 0 ? `+${indice}` : indice}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PoulesDePrueba({ poules, volver }: { poules: PouleDePrueba[]; volver: string }) {
  if (poules.length === 0) {
    return <Nota>No hay asaltos de poule importados para esta prueba. No significa que no se hayan disputado.</Nota>;
  }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {poules.map((p) => (
        <Poule key={p.ronda} poule={p} volver={volver} />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- cuadro */

function Lado({ t, gana, volver }: { t: TiradorAsalto; gana: boolean; volver: string }) {
  return (
    <div className={cn('flex min-h-9 items-center gap-2 px-3 py-1.5', gana ? 'font-semibold' : 'text-muted-foreground')}>
      {t.pais ? <BanderaPais pais={t.pais} /> : <span className="w-7" aria-hidden />}
      <Nombre t={t} volver={volver} className={cn('min-w-0 flex-1 text-sm', gana && 'text-foreground')} />
      <span className={cn('cifra text-base tabular-nums', gana && 'text-foreground')}>
        {gana ? <span className="sr-only">ganó con </span> : null}
        {t.tantos}
      </span>
    </div>
  );
}

function Asalto({ a, volver }: { a: AsaltoDePrueba; volver: string }) {
  const ganaA = a.a.tantos > a.b.tantos;
  const ganaB = a.b.tantos > a.a.tantos;
  return (
    <li className="divide-y overflow-hidden rounded-md border bg-card">
      <Lado t={a.a} gana={ganaA} volver={volver} />
      <Lado t={a.b} gana={ganaB} volver={volver} />
    </li>
  );
}

export function CuadroDePrueba({ cuadro, volver }: { cuadro: RondaCuadro[]; volver: string }) {
  if (cuadro.length === 0) {
    return <Nota>No hay asaltos de eliminación directa importados para esta prueba.</Nota>;
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <ol className="flex flex-col gap-6 md:flex-row md:gap-4" aria-label="Cuadro de eliminación directa">
        {cuadro.map((r) => (
          <li key={r.ronda} className="flex min-w-0 flex-col gap-2 md:w-64 md:shrink-0">
            <h3 className="flex items-baseline justify-between gap-2 border-b pb-1.5 text-base">
              <span>{r.etiqueta}</span>
              <span className="text-xs text-muted-foreground">
                {r.asaltos.length === 1 ? '1 asalto' : `${r.asaltos.length} asaltos`}
              </span>
            </h3>
            <ul className="flex flex-col gap-2 md:h-full md:justify-around">
              {r.asaltos.map((a) => (
                <Asalto key={a.id} a={a} volver={volver} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
