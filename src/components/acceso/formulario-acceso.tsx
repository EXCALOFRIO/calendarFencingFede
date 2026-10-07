'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import styles from './formulario-acceso.module.css';

export type EstadoAcceso = { error?: string; aviso?: string };
export type AccionAcceso = (estado: EstadoAcceso, datos: FormData) => Promise<EstadoAcceso>;

/** Sigue siendo texto: nunca convertir a número ni perder los ceros iniciales. */
export function limpiarCodigo(valor: string) {
  return valor.replace(/\s/g, '').replace(/[^0-9]/g, '').slice(0, 6);
}

function BotonEnviar({ codigo, ocupado }: { codigo: boolean; ocupado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={styles.principal} type="submit" disabled={pending || ocupado}>
      {pending ? (codigo ? 'Comprobando…' : 'Enviando…') : (codigo ? 'Continuar' : 'Enviar código')}
    </button>
  );
}

export function FormularioAcceso({
  pasoCodigo,
  accion,
  reenviar,
  errorInicial,
}: {
  pasoCodigo: boolean;
  accion: AccionAcceso;
  reenviar: AccionAcceso;
  errorInicial?: string | null;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, { error: errorInicial ?? undefined });
  const [reenvio, repetir, reenviando] = useActionState(reenviar, {});
  const [correo, setCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [posicion, setPosicion] = useState(0);
  const [ultimoEnvio, setUltimoEnvio] = useState<'codigo' | 'reenvio'>('codigo');
  const ocupado = pendiente || reenviando;
  const error = ultimoEnvio === 'reenvio' ? reenvio.error : estado.error;
  const id = pasoCodigo ? 'otp' : 'email';

  return (
    <div className={styles.formularios}>
      <form action={enviar} aria-busy={pendiente} className={styles.formulario}
        onSubmit={(event) => {
          if (ocupado) event.preventDefault();
          else setUltimoEnvio('codigo');
        }}>
        <label htmlFor={id} className={styles.etiqueta}>
          {pasoCodigo ? 'Código de verificación' : 'Correo electrónico'}
        </label>
        {pasoCodigo ? (
          <div className={styles.codigo}>
            <div className={styles.posiciones} aria-hidden="true">
              {Array.from({ length: 6 }, (_, indice) => (
                <span
                  key={indice}
                  className={styles.posicion}
                  data-activa={indice === Math.min(posicion, 5)}
                  data-rellena={indice < codigo.length}
                />
              ))}
            </div>
            <input
              id={id}
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="go"
              pattern="[0-9]{6}"
              minLength={6}
              required
              spellCheck={false}
              aria-describedby="acceso-ayuda acceso-mensaje"
              aria-invalid={Boolean(error)}
              readOnly={ocupado}
              value={codigo}
              onChange={(event) => {
                const input = event.currentTarget;
                const inicio = limpiarCodigo(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
                const limpio = limpiarCodigo(input.value);
                setCodigo(limpio);
                setPosicion(inicio);
                // Normaliza también paste/autofill sin truncar antes sus espacios.
                // Conserva el cursor al corregir una cifra intermedia.
                input.value = limpio;
                input.setSelectionRange(inicio, inicio);
              }}
              onSelect={(event) => setPosicion(event.currentTarget.selectionStart ?? 0)}
              className={styles.entradaCodigo}
            />
          </div>
        ) : (
          <input
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="tu@correo.es"
            required
            aria-describedby="acceso-ayuda acceso-mensaje"
            aria-invalid={Boolean(error)}
            readOnly={ocupado}
            value={correo}
            onChange={(event) => setCorreo(event.currentTarget.value)}
            className={styles.entradaCorreo}
          />
        )}
        <p id="acceso-ayuda" className={styles.ayuda}>
          {pasoCodigo ? '6 cifras · Caduca en 5 minutos' : 'Sin contraseña. Solo tu correo.'}
        </p>
        <div id="acceso-mensaje" className={styles.mensaje} aria-live="polite" aria-atomic="true">
          {ocupado ? (
            <p>{reenviando ? 'Solicitando otro código…' : pasoCodigo ? 'Comprobando el código…' : 'Solicitando el código…'}</p>
          ) : error ? (
            <p className={styles.error}>{error}</p>
          ) : ultimoEnvio === 'reenvio' && reenvio.aviso ? <p>{reenvio.aviso}</p> : null}
        </div>
        <BotonEnviar codigo={pasoCodigo} ocupado={ocupado} />
      </form>
      {pasoCodigo ? (
        <div className={styles.alternativas}>
          <form action={repetir} onSubmit={(event) => {
            if (ocupado) event.preventDefault();
            else setUltimoEnvio('reenvio');
          }}>
            <button className={styles.secundario} type="submit" disabled={ocupado}>
              {reenviando ? 'Reenviando…' : 'Reenviar código'}
            </button>
          </form>
          <a className={styles.secundario} href="/entrar" aria-disabled={ocupado || undefined}
            onClick={(event) => { if (ocupado) event.preventDefault(); }}>
            Cambiar correo
          </a>
        </div>
      ) : null}
    </div>
  );
}
