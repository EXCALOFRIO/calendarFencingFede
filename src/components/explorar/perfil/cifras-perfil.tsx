import { fuenteRanking } from '@/lib/sport/explorar/etiquetas';
import { porcentajeVictorias } from '@/lib/sport/explorar/perfil-modelo';
import type { PerfilDeportivo, PuestoRanking } from '@/lib/sport/explorar/tipos-perfil';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import { CATEGORY_LABEL, WEAPON_LABEL } from '@/lib/utils';
import { Cifra, Metrica, SinDato } from './piezas-perfil';

function lista(r: PuestoRanking): string {
  const categoria = CATEGORY_LABEL[r.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? r.categoria.codigo;
  return `${fuenteRanking(r.fuente)}, ${WEAPON_LABEL[r.arma].toLowerCase()} ${categoria.toLowerCase()}, ${etiquetaTemporada(r.temporada)}`;
}

function conSigno(valor: number): string {
  return valor > 0 ? `+${valor}` : valor < 0 ? `−${Math.abs(valor)}` : '0';
}

/**
 * La fila del marcador: lo que se mira primero. Cada cifra lleva su rótulo, y
 * lo que no está importado se dice; nunca se pinta un cero que no existe.
 */
export function CifrasPerfil({ perfil }: { perfil: PerfilDeportivo }) {
  const r = perfil.resumen;
  const medallas = r.oros + r.platas + r.bronces;
  const a = perfil.asaltos;
  const pct = porcentajeVictorias(a?.total);
  const pctPoule = porcentajeVictorias(a?.poule);
  const pctEliminacion = porcentajeVictorias(a?.eliminacion);
  const sinPruebas = r.pruebas === 0;
  const sinAsaltos = a !== null && a.total.asaltos === 0;
  const asaltoNoLeido = <SinDato>No se han podido leer los asaltos</SinDato>;
  const sinAsaltosTexto = <SinDato>Sin asaltos importados</SinDato>;

  return (
    <section aria-labelledby="ficha-cifras" className="min-w-0">
      <h2 id="ficha-cifras" className="sr-only">En cifras</h2>
      <dl className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4">
        <Metrica
          etiqueta="Pruebas individuales"
          detalle={sinPruebas ? undefined : `${r.conPuesto} con puesto publicado`}
        >
          {sinPruebas ? <SinDato /> : <Cifra>{r.pruebas}</Cifra>}
        </Metrica>

        <Metrica etiqueta="Medallas">
          {sinPruebas ? <SinDato /> : (
            <>
              <Cifra>{medallas}</Cifra>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Oro <strong className="cifra text-base text-foreground">{r.oros}</strong></span>
                <span>Plata <strong className="cifra text-base text-foreground">{r.platas}</strong></span>
                <span>Bronce <strong className="cifra text-base text-foreground">{r.bronces}</strong></span>
              </span>
            </>
          )}
        </Metrica>

        <Metrica
          etiqueta="Finales (entre los 8 primeros)"
          detalle={sinPruebas ? undefined : `de ${r.conPuesto} con puesto`}
        >
          {sinPruebas ? <SinDato /> : <Cifra>{r.finales}</Cifra>}
        </Metrica>

        <Metrica etiqueta="Mejor puesto">
          {r.mejorPuesto !== null ? <Cifra>{r.mejorPuesto}º</Cifra> : <SinDato>Sin dato</SinDato>}
        </Metrica>

        <Metrica
          etiqueta="Asaltos ganados y perdidos"
          detalle={a && !sinAsaltos
            ? `${a.total.asaltos} asaltos${a.total.empates ? `, ${a.total.empates} sin decidir` : ''}`
            : undefined}
        >
          {a === null ? asaltoNoLeido : sinAsaltos ? sinAsaltosTexto : (
            <Cifra className={`${a.total.victorias}${a.total.derrotas}`.length > 4 ? 'text-4xl' : undefined}>
              {a.total.victorias}–{a.total.derrotas}
            </Cifra>
          )}
        </Metrica>

        <Metrica etiqueta="Asaltos ganados">
          {a === null ? asaltoNoLeido : pct === null ? (sinAsaltos ? sinAsaltosTexto : <SinDato>Sin dato</SinDato>) : (
            <>
              <Cifra>{pct}<span className="text-2xl">%</span></Cifra>
              <span className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
                <span>Poule</span>
                <strong className="cifra text-base text-foreground">{pctPoule === null ? 'sin dato' : `${pctPoule}%`}</strong>
                <span>Eliminación directa</span>
                <strong className="cifra text-base text-foreground">{pctEliminacion === null ? 'sin dato' : `${pctEliminacion}%`}</strong>
              </span>
            </>
          )}
        </Metrica>

        <Metrica
          etiqueta="Índice de tocados"
          detalle={a && !sinAsaltos ? `${a.total.tocadosDados} dados, ${a.total.tocadosRecibidos} recibidos` : undefined}
        >
          {a === null ? asaltoNoLeido : sinAsaltos ? sinAsaltosTexto : (
            <Cifra>{conSigno(a.total.tocadosDados - a.total.tocadosRecibidos)}</Cifra>
          )}
        </Metrica>

        <Metrica
          etiqueta="Ranking oficial"
          detalle={perfil.ranking.mejor && (!perfil.ranking.actual || perfil.ranking.mejor.puesto < perfil.ranking.actual.puesto)
            ? `Mejor: ${perfil.ranking.mejor.puesto}º, ${lista(perfil.ranking.mejor)}`
            : undefined}
        >
          {perfil.ranking.actual ? (
            <>
              <span className="flex items-baseline gap-1.5">
                <Cifra>{perfil.ranking.actual.puesto}º</Cifra>
                {perfil.ranking.actual.totalPublicado !== null ? (
                  <span className="text-xs text-muted-foreground">de {perfil.ranking.actual.totalPublicado}</span>
                ) : null}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground break-words">{lista(perfil.ranking.actual)}</span>
            </>
          ) : perfil.ranking.mejor ? (
            <>
              <Cifra>{perfil.ranking.mejor.puesto}º</Cifra>
              <span className="text-xs leading-relaxed text-muted-foreground break-words">
                Mejor puesto, {lista(perfil.ranking.mejor)}
              </span>
            </>
          ) : <SinDato>Sin listas importadas</SinDato>}
        </Metrica>
      </dl>
    </section>
  );
}
