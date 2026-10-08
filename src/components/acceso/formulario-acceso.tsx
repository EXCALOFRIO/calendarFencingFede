'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CIFRAS_CODIGO, limpiarCodigo } from './codigo';
import styles from './formulario-acceso.module.css';

export type EstadoAcceso = { error?: string; aviso?: string };
export type AccionAcceso = (estado: EstadoAcceso, datos: FormData) => Promise<EstadoAcceso>;

/** Escribe el código ya limpio en el campo, sin desplazar las cifras fuera de sus casillas. */
function escribir(input: HTMLInputElement, limpio: string, cursor: number) {
  if (input.value !== limpio) input.value = limpio;
  input.setSelectionRange(cursor, cursor);
  input.scrollLeft = 0;
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
  cambiarCorreo,
  errorInicial,
}: {
  pasoCodigo: boolean;
  accion: AccionAcceso;
  reenviar: AccionAcceso;
  /** Borra el correo en curso (cookie httpOnly) y vuelve al primer paso. */
  cambiarCorreo: () => Promise<void>;
  errorInicial?: string | null;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, { error: errorInicial ?? undefined });
  const [reenvio, repetir, reenviando] = useActionState(reenviar, {});
  const [correo, setCorreo] = useState('');
  // Texto del campo. Solo difiere del código limpio mientras un IME compone:
  // reescribirlo entonces hace que el teclado vuelva a insertar lo compuesto.
  const [valor, setValor] = useState('');
  const codigo = limpiarCodigo(valor);
  const [posicion, setPosicion] = useState(0);
  const [ultimoEnvio, setUltimoEnvio] = useState<'codigo' | 'reenvio'>('codigo');
  const campoCodigo = useRef<HTMLInputElement>(null);
  const ocupado = pendiente || reenviando;
  const error = ultimoEnvio === 'reenvio' ? reenvio.error : estado.error;
  const id = pasoCodigo ? 'otp' : 'email';

  const fijar = (input: HTMLInputElement, limpio: string, cursor: number) => {
    escribir(input, limpio, cursor);
    setValor(limpio);
    setPosicion(cursor);
  };
  const normalizar = (input: HTMLInputElement) => {
    // Conserva el cursor al corregir una cifra intermedia.
    const cursor = limpiarCodigo(input.value.slice(0, input.selectionStart ?? input.value.length)).length;
    fijar(input, limpiarCodigo(input.value), cursor);
  };
  /** Pegar o soltar: se limpia ANTES de `maxLength`, que si no truncaría «123 456» en «123 45». */
  const insertar = (input: HTMLInputElement, texto: string) => {
    const nuevo = limpiarCodigo(texto);
    if (nuevo.length === CIFRAS_CODIGO) return fijar(input, nuevo, CIFRAS_CODIGO);
    const antes = limpiarCodigo(input.value.slice(0, input.selectionStart ?? input.value.length));
    const despues = limpiarCodigo(input.value.slice(input.selectionEnd ?? input.value.length));
    const limpio = limpiarCodigo(antes + nuevo + despues);
    fijar(input, limpio, Math.min(antes.length + nuevo.length, limpio.length));
  };

  useEffect(() => {
    const input = campoCodigo.current;
    if (!input) return;
    // El correo ya está escrito: en este paso solo queda teclear el código.
    input.focus();
    /**
     * Con el código completo, una cifra más sobrescribe la del cursor en vez
     * de desplazar las demás (o perderse contra `maxLength`). Va en el
     * `beforeinput` nativo porque el de React no trae `inputType`.
     */
    const sobrescribir = (event: InputEvent) => {
      if (event.isComposing || event.inputType !== 'insertText' || !event.data) return;
      const actual = limpiarCodigo(input.value);
      const inicio = input.selectionStart ?? actual.length;
      if (input.selectionEnd !== inicio || actual.length < CIFRAS_CODIGO) return;
      event.preventDefault();
      const cifra = limpiarCodigo(event.data).charAt(0);
      if (!cifra || inicio >= CIFRAS_CODIGO) return;
      const nuevo = actual.slice(0, inicio) + cifra + actual.slice(inicio + 1);
      escribir(input, nuevo, inicio + 1);
      setValor(nuevo);
      setPosicion(inicio + 1);
    };
    input.addEventListener('beforeinput', sobrescribir);
    return () => input.removeEventListener('beforeinput', sobrescribir);
  }, []);

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
              {Array.from({ length: CIFRAS_CODIGO }, (_, indice) => (
                <span
                  key={indice}
                  className={styles.posicion}
                  data-activa={indice === Math.min(posicion, CIFRAS_CODIGO - 1)}
                  data-rellena={indice < codigo.length}
                />
              ))}
            </div>
            <input
              ref={campoCodigo}
              id={id}
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="go"
              pattern="[0-9]{6}"
              minLength={CIFRAS_CODIGO}
              maxLength={CIFRAS_CODIGO}
              required
              spellCheck={false}
              aria-describedby="acceso-ayuda acceso-mensaje"
              aria-invalid={Boolean(error)}
              readOnly={ocupado}
              value={valor}
              onChange={(event) => {
                const input = event.currentTarget;
                if ((event.nativeEvent as InputEvent).isComposing) {
                  // Solo las casillas; el campo se limpia en `compositionend`.
                  setValor(input.value);
                  setPosicion(Math.min(limpiarCodigo(input.value.slice(0, input.selectionStart ?? 0)).length, CIFRAS_CODIGO));
                  return;
                }
                normalizar(input);
              }}
              onCompositionEnd={(event) => normalizar(event.currentTarget)}
              onPaste={(event) => {
                event.preventDefault();
                if (!event.currentTarget.readOnly) insertar(event.currentTarget, event.clipboardData.getData('text'));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!event.currentTarget.readOnly) insertar(event.currentTarget, event.dataTransfer.getData('text'));
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
          <form action={cambiarCorreo} onSubmit={(event) => { if (ocupado) event.preventDefault(); }}>
            <button className={styles.secundario} type="submit" disabled={ocupado}>
              Cambiar correo
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
