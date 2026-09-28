import { Info } from 'lucide-react';
import { BandejaInscripciones } from '@/components/admin/bandeja-inscripciones';
import { SinAcceso, exigirRol } from '@/components/admin/guardia';
import { Cabecera } from '@/components/admin/piezas';
import { listarBandejaInscripciones } from '../consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inscripciones' };

/**
 * Inscripciones: PANTALLA SIN ENTRADA EN EL MENÚ, A PROPÓSITO.
 *
 * El usuario quitó la inscripción de la aplicación —«quita todo lo de clubes,
 * lo de códigos de licencia, lo de darse o no de alta en los torneos, eso está
 * oculto»— y esta pantalla era la bandeja donde el club mandaba solicitudes.
 *
 * No se borra, por dos motivos comprobados en la base:
 *
 *  1. `/estado` SIGUE ofreciendo «Solicitar inscripción»
 *     (`src/components/estado/sin-inscribir.tsx`), así que se pueden seguir
 *     creando filas en `entry`. Sin esta pantalla, lo que alguien pida no lo
 *     vería nadie nunca.
 *  2. Hay 14 inscripciones vivas de eventos futuros, y el CSV que exporta esta
 *     pantalla es lo que de verdad se manda a la organización de un torneo.
 *     Eso no depende de que exista un club.
 *
 * Así que: **fuera del menú** (`PANTALLAS_ADMIN`), viva por URL para la
 * dirección técnica, y con la nota de abajo diciendo qué es y qué no es. Si el
 * usuario decide retirarla del todo, se quita esta carpeta y `src/lib/entries/`
 * se queda: se oculta, no se destruye.
 */
export default async function Pagina() {
  const acceso = await exigirRol('admin');
  if (!acceso.ok) {
    return (
      <SinAcceso
        titulo="Inscripciones"
        motivo={acceso.motivo}
        autenticado={acceso.autenticado}
      />
    );
  }

  const filas = await listarBandejaInscripciones();

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Cabecera
        titulo="Inscripciones"
        contexto="Lo pedido para lo que aún no se ha celebrado, de lo más próximo a lo más lejano."
      />

      {/*
        Por qué esta pantalla no está en el menú, en DOS LÍNEAS.

        El primer intento explicaba las tres razones enteras y, medido en un
        iPhone, la nota ocupaba 440 px: se convertía en lo más grande de la
        pantalla y tapaba la lista que se viene a ver. El porqué completo está
        en el comentario de arriba, que es donde hace falta; aquí basta con lo
        que necesita quien entra por URL.
      */}
      <p className="medida flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Fuera del menú: la aplicación ya no sirve para inscribirse. Se mantiene
          por el CSV que se manda a la organización. Ningún club interviene ya.
        </span>
      </p>

      <BandejaInscripciones filas={filas} />
    </div>
  );
}
