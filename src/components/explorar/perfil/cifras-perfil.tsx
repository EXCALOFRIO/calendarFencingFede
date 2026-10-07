import { porcentajeVictorias } from '@/lib/sport/explorar/perfil-modelo';
import type { PerfilDeportivo } from '@/lib/sport/explorar/tipos-perfil';
import { cn } from '@/lib/utils';

function Celda({ etiqueta, children, detalle }: { etiqueta: string; children: React.ReactNode; detalle?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-3 py-3 sm:px-4 sm:py-4">
      <dt className="truncate text-xs leading-none text-muted-foreground">{etiqueta}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {children}
        {detalle ? <span className="truncate text-[12px] leading-none text-muted-foreground">{detalle}</span> : null}
      </dd>
    </div>
  );
}

function Cifra({ children, apagada = false }: { children: React.ReactNode; apagada?: boolean }) {
  return (
    <span className={cn('cifra truncate text-3xl leading-none whitespace-nowrap sm:text-4xl', apagada && 'text-muted-foreground')}>
      {children}
    </span>
  );
}

const raya = <Cifra apagada>—</Cifra>;

/**
 * El marcador de la ficha en seis cifras cortas. Lo que no está importado sale
 * como raya, nunca como un cero que no existe. Pruebas, finales y mejor puesto
 * salen de la lectura por prueba (la misma de la lista) si está.
 */
export function CifrasPerfil({ perfil }: { perfil: PerfilDeportivo }) {
  const t = perfil.ambito?.total;
  const pruebas = t ? t.competiciones : perfil.resumen.pruebas;
  const finales = t ? t.finales : perfil.resumen.finales;
  const mejor = t ? t.mejorPuesto : perfil.resumen.mejorPuesto;
  const a = perfil.asaltos;
  const conAsaltos = a !== null && a.total.asaltos > 0;
  const pctPoule = porcentajeVictorias(a?.poule);
  const pctDirecta = porcentajeVictorias(a?.eliminacion);
  return (
    <section aria-labelledby="ficha-cifras" className="min-w-0">
      <h2 id="ficha-cifras" className="sr-only">En cifras</h2>
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-6">
        <Celda etiqueta="Pruebas">{pruebas > 0 ? <Cifra>{pruebas}</Cifra> : raya}</Celda>
        <Celda etiqueta="Top 8">{pruebas > 0 ? <Cifra>{finales}</Cifra> : raya}</Celda>
        <Celda etiqueta="Mejor puesto">{mejor !== null ? <Cifra>{mejor}º</Cifra> : raya}</Celda>
        <Celda
          etiqueta="Asaltos"
          detalle={conAsaltos ? `${a.total.victorias} V · ${a.total.derrotas} D` : undefined}
        >
          {conAsaltos ? <Cifra>{a.total.asaltos}</Cifra> : raya}
        </Celda>
        <Celda etiqueta="Poule" detalle={pctPoule !== null ? 'ganados' : undefined}>
          {pctPoule !== null ? <Cifra>{pctPoule}<span className="text-xl">%</span></Cifra> : raya}
        </Celda>
        <Celda
          etiqueta="Directa"
          detalle={pctDirecta !== null ? 'ganados' : undefined}
        >
          {pctDirecta !== null ? <Cifra>{pctDirecta}<span className="text-xl">%</span></Cifra> : raya}
        </Celda>
      </dl>
    </section>
  );
}
