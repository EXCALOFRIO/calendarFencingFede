'use client';

import { ExternalLink, Info } from 'lucide-react';
import * as React from 'react';
import { Escudo, type Federacion, nombreFederacion } from '@/components/escudo';
import {
  CabeceraTirador,
  type DatoFicha,
  type FotoTirador,
  type Insignia,
} from '@/components/tirador/cabecera';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { cn } from '@/lib/utils';
import { TiraTemporadas, type TemporadaRanking } from './tira-temporadas';

/**
 * ===========================================================================
 * LA FICHA DE UN TIRADOR EN LA PANTALLA DE RANKING
 * ===========================================================================
 *
 * Junta las tres piezas que pidió el usuario, en el sitio donde las pidió:
 *
 *   «en lo del ranking no sale como ya fijado el suyo, que es lo interesante:
 *    que salga el de la FIE siempre, y por equipos también de España, y luego
 *    alguno para poder cambiar al ranking nacional»
 *
 *   «recupera la foto de perfil de la FIE para los tiradores… en la FIE hay
 *    más cosas, puedes poner algo de estadísticas ahí»
 *
 *   «no veo nada de la federación ni nada, ni logo de la fede ni de la FIE
 *    para cambiar entre rankings, eso estaría guay a mí visual»
 *
 * O sea: la cabecera con la foto y el puesto como insignia (referencia 3.1),
 * la tira de temporadas (3.2) y el conmutador con los escudos (sección 4),
 * todo encima de la tabla y sin salir de la pantalla.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SON DOS LADOS DE UN CONMUTADOR Y NO DOS BLOQUES
 * ---------------------------------------------------------------------------
 * El puesto nacional y el mundial son **dos números distintos** y confundirlos
 * sería grave: es la razón de que `PuestoOficial` y `PuestoMundialFie` sean
 * tipos separados en `src/lib/queries/ranking.ts`. Ponerlos uno al lado del
 * otro, con la misma pinta, invita justo a esa confusión.
 *
 * Con un conmutador solo hay un número en pantalla y el escudo dice de quién
 * es. Es la petición literal del usuario y además es lo correcto.
 *
 * ---------------------------------------------------------------------------
 * TRES ESTADOS Y NINGUNO INVENTADO
 * ---------------------------------------------------------------------------
 * 1. **Con cuál abre**: con el mundial cuando lo hay («que salga el de la FIE
 *    siempre»), y con el nacional cuando no. Hoy solo dos tiradores tienen
 *    ficha FIE confirmada, así que para casi todos abre en nacional; abrir
 *    siempre en mundial les dejaría la pantalla en «no publicado».
 * 2. **El lado sin datos no se esconde**: sale desactivado y con el motivo
 *    escrito. «No tiene ficha en la FIE» y «no existe el ranking mundial» no
 *    son lo mismo.
 * 3. **Las variantes**: un tirador puede estar en florete absoluto y en
 *    florete M23, o en dos armas. Se enseña una y las demás están a un clic en
 *    el `Select` —que es el «View by: Senior» de la referencia—, no
 *    escondidas. Al cambiar de lado se conserva la misma arma y categoría si
 *    el otro lado la tiene; si no, se cae a la primera que exista, igual que
 *    hace `elegir()` en `tabla-oficial.tsx`.
 */

/** Una clasificación concreta: un arma y una categoría de un lado. */
export type VarianteRanking = {
  /** `FLORETE|ABS`. Se comparte entre lados para poder conservar la elección. */
  clave: string;
  /** «Florete absoluto». Lo que se lee en el `Select`. */
  etiqueta: string;
  insignia: Insignia;
  pares: DatoFicha[];
  /** De la más reciente a la más vieja. Puede venir vacía. */
  temporadas: TemporadaRanking[];
  tituloTemporadas: string;
  /**
   * Qué alcance tiene la tira y de dónde sale. Cuando no hay histórico, esto
   * es lo que se pinta en su lugar: se dice por qué no lo hay.
   */
  contextoTemporadas: React.ReactNode;
  /** Una línea de procedencia al pie de la cabecera. */
  procedencia: React.ReactNode;
  urlFuente: string | null;
};

export type LadoRanking = {
  federacion: Federacion;
  /** Rótulo corto del conmutador: «Nacional», «Internacional». */
  etiqueta: string;
  /** Vacío = este lado no tiene nada, y entonces `motivoVacio` es obligatorio. */
  variantes: VarianteRanking[];
  motivoVacio?: string;
};

export function FichaRanking({
  apellidos,
  nombre,
  foto,
  pais,
  lados,
  acciones,
  className,
  elegida: elegidaControlada,
  onElegir,
}: {
  apellidos: string;
  nombre: string;
  foto?: FotoTirador | null;
  /** Código de país de la fuente («ESP»). La pastilla la pinta `BanderaPais`. */
  pais?: string | null;
  lados: LadoRanking[];
  acciones?: React.ReactNode;
  className?: string;
  /**
   * Federación elegida, cuando la manda alguien de fuera.
   *
   * Existe porque en la pantalla de ranking había **dos conmutadores
   * Nacional/Mundial**: este, dentro de la ficha del tirador, y otro debajo
   * para la tabla. Dos controles que dicen lo mismo en la misma pantalla es
   * una pregunta —«¿cuál manda?»— y el usuario lo pidió claro: *«pon solo un
   * selector de nacional o mundial, el de arriba»*.
   *
   * Así que ahora el de arriba manda sobre la tabla también, y el estado vive
   * en el padre (`PanelRanking`). Si no se pasa, la ficha sigue funcionando
   * sola, que es como la usa el panel del tirador.
   */
  elegida?: Federacion;
  onElegir?: (f: Federacion) => void;
}) {
  const conDatos = lados.filter((l) => l.variantes.length > 0);
  const arranque =
    conDatos.find((l) => l.federacion === 'FIE') ?? conDatos[0] ?? lados[0];

  const [elegidaPropia, setElegidaPropia] = React.useState<Federacion>(
    arranque.federacion,
  );
  const elegida = elegidaControlada ?? elegidaPropia;
  const setElegida = (f: Federacion) => {
    setElegidaPropia(f);
    onElegir?.(f);
  };
  const [clave, setClave] = React.useState<string>(
    arranque.variantes[0]?.clave ?? '',
  );

  const lado = lados.find((l) => l.federacion === elegida) ?? arranque;
  const variante =
    lado.variantes.find((v) => v.clave === clave) ?? lado.variantes[0] ?? null;

  /** Al cambiar de lado se conserva el arma y la categoría si existen allí. */
  function cambiarLado(siguiente: Federacion) {
    const destino = lados.find((l) => l.federacion === siguiente);
    setElegida(siguiente);
    if (destino && !destino.variantes.some((v) => v.clave === clave)) {
      setClave(destino.variantes[0]?.clave ?? '');
    }
  }

  return (
    <article
      className={cn(
        // Una banda con filete de luz arriba, como el canto de una chapa.
        'flex min-w-0 flex-col gap-5 rounded-xl border-t border-filete bg-card px-4 py-5 sm:px-5',
        className,
      )}
    >
      <CabeceraTirador
        apellidos={apellidos}
        nombre={nombre}
        foto={foto}
        pais={pais}
        insignia={variante?.insignia ?? null}
        datos={variante?.pares ?? []}
        selector={
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row-reverse sm:items-center">
            <ConmutadorRanking
              lados={lados}
              elegida={elegida}
              onElegir={cambiarLado}
            />
            {lado.variantes.length > 1 ? (
              <Select value={variante?.clave ?? ''} onValueChange={setClave}>
                <SelectTrigger
                  className="w-full sm:w-52"
                  aria-label="Arma y categoría"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lado.variantes.map((v) => (
                    <SelectItem key={v.clave} value={v.clave}>
                      {v.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        }
        acciones={acciones}
        pie={
          variante ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Escudo federacion={lado.federacion} tamano="nota" decorativo />
              <span className="medida">
                {variante.procedencia}
                {variante.urlFuente ? (
                  <>
                    {' '}
                    <a
                      href={variante.urlFuente}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary-text underline underline-offset-4"
                    >
                      Ver la fuente
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  </>
                ) : null}
              </span>
            </p>
          ) : null
        }
      />

      {variante === null ? (
        /*
          Un lado vacío dice qué pasaría ahí y por qué no hay nada, en la voz
          de la aplicación. Nunca «No hay datos».
        */
        <EstadoVacio
          titulo={`Sin puesto en el ranking de ${nombreFederacion(lado.federacion)}`}
          descripcion={lado.motivoVacio}
        />
      ) : variante.temporadas.length > 1 ? (
        <div className="border-t border-filete pt-5">
          <TiraTemporadas
            temporadas={variante.temporadas}
            titulo={variante.tituloTemporadas}
            contexto={variante.contextoTemporadas}
          />
        </div>
      ) : (
        /*
          Con UNA sola temporada no se pinta la tira, solo el motivo.
          Se probó pintándola y la tarjeta repetía el puesto y los puntos que
          ya están dos dedos más arriba en la insignia y en los pares: el mismo
          «#3» dos veces en la misma pantalla, y media pantalla vacía a la
          derecha para no decir nada nuevo. Una tira de un elemento no es una
          tira.
        */
        <div className="border-t border-filete pt-5">
          <Aviso>{variante.contextoTemporadas}</Aviso>
        </div>
      )}
    </article>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Info className="mt-1 size-4 shrink-0" aria-hidden />
      <span className="medida">{children}</span>
    </p>
  );
}

/**
 * El conmutador: el escudo de la RFEE y el de la FIE como los dos lados de un
 * mismo control, con el segmentado del sistema (el mismo «Qué ranking se
 * enseña» que el de la tabla). El escudo va decorativo porque al lado está el
 * rótulo.
 */
export function ConmutadorRanking({
  lados,
  elegida,
  onElegir,
}: {
  lados: LadoRanking[];
  elegida: Federacion;
  onElegir: (f: Federacion) => void;
}) {
  if (lados.length < 2) return null;
  return (
    <SelectorSegmentado
      etiqueta="Qué ranking se enseña"
      valor={elegida}
      onCambio={(v) => onElegir(v as Federacion)}
      anchoMinimo={8}
      className="w-full sm:w-72"
      opciones={lados.map((lado) => ({
        valor: lado.federacion,
        deshabilitada: lado.variantes.length === 0,
        etiqueta: (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Escudo federacion={lado.federacion} tamano="nota" decorativo />
            {lado.etiqueta}
          </span>
        ),
      }))}
    />
  );
}