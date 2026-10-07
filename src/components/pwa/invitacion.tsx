'use client';

import * as React from 'react';
import {
  cooldownInstalacion, escucharInstalacion, ESPERA_INVITACION,
  estaInstalada, plataformaIOS, solicitarInstalacion,
  type EventoInstalacion, type PlataformaInstalacion,
} from './instalacion';
import styles from './invitacion.module.css';

export function InvitacionInstalacion() {
  const [plataforma, setPlataforma] = React.useState<PlataformaInstalacion | null>(null);
  const [instrucciones, setInstrucciones] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState(false);
  const eventoPendiente = React.useRef<EventoInstalacion | null>(null);
  const cerrada = React.useRef(false);
  const id = React.useId();

  React.useEffect(() => {
    let lista = false;
    let ofrecida = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const consulta = window.matchMedia('(display-mode: standalone)');
    const instalada = () => estaInstalada(
      navigator as Navigator & { standalone?: boolean },
      (valor) => window.matchMedia(valor).matches,
    );
    const mostrar = () => {
      if (!lista || ofrecida || cerrada.current || instalada() || cooldownInstalacion.activo()) return;
      const ios = plataformaIOS(navigator.userAgent, navigator.maxTouchPoints);
      const modo = ios ?? (eventoPendiente.current ? 'nativa' : null);
      if (!modo) return;
      ofrecida = true;
      // También limitamos las impresiones ignoradas: no vuelve en cada ruta/visita.
      cooldownInstalacion.guardar(7);
      setPlataforma(modo);
    };
    const ocultarInstalada = () => {
      if (!instalada()) return;
      cerrada.current = true;
      eventoPendiente.current = null;
      setPlataforma(null);
    };
    const dejarDeOfrecer = () => {
      cooldownInstalacion.guardar(180);
      cerrada.current = true;
      eventoPendiente.current = null;
      setPlataforma(null);
    };
    const dejarDeEscuchar = escucharInstalacion(window, (evento) => {
      eventoPendiente.current = evento;
      mostrar();
    }, dejarDeOfrecer);
    const trasCarga = () => {
      temporizador = setTimeout(() => { lista = true; mostrar(); }, ESPERA_INVITACION);
    };
    if (document.readyState === 'complete') trasCarga();
    else window.addEventListener('load', trasCarga, { once: true });
    consulta.addEventListener('change', ocultarInstalada);
    return () => {
      clearTimeout(temporizador);
      dejarDeEscuchar();
      window.removeEventListener('load', trasCarga);
      consulta.removeEventListener('change', ocultarInstalada);
    };
  }, []);

  function descartar(dias = 30) {
    cooldownInstalacion.guardar(dias);
    cerrada.current = true;
    eventoPendiente.current = null;
    setPlataforma(null);
  }

  async function instalar() {
    if (ocupado) return;
    if (plataforma !== 'nativa') {
      setInstrucciones(true);
      return;
    }
    const evento = eventoPendiente.current;
    if (!evento) return;
    // Un beforeinstallprompt solo se puede utilizar una vez.
    eventoPendiente.current = null;
    setOcupado(true);
    const resultado = await solicitarInstalacion(evento);
    setOcupado(false);
    if (cerrada.current) return;
    if (resultado === 'error') {
      cooldownInstalacion.guardar(30);
      setError(true);
    } else {
      descartar(resultado === 'accepted' ? 180 : 30);
    }
  }

  if (!plataforma) return null;

  return (
    <aside className={styles.contenedor} aria-label="Instalar CalendarFencing">
      <div className={styles.tarjeta}>
        <div className={styles.texto}>
          <h2>Tu calendario, a mano</h2>
          <p>Añádelo a tu pantalla de inicio. Se abre como una app; necesita conexión.</p>
        </div>
        <div className={styles.acciones}>
          {!error && (
            <button type="button" className={styles.principal} onClick={instalar}
              disabled={ocupado}
              aria-expanded={plataforma !== 'nativa' ? instrucciones : undefined}
              aria-controls={plataforma !== 'nativa' ? id : undefined}>
              {ocupado ? 'Abriendo…' : plataforma === 'nativa' ? 'Instalar app' : 'Cómo añadir'}
            </button>
          )}
          <button type="button" onClick={() => descartar()}>Ahora no</button>
        </div>
        {instrucciones && (
          <p id={id} className={styles.instrucciones}>
            {plataforma === 'ios-otro' ? 'Abre esta web en Safari. Después, ' : 'En Safari, '}
            pulsa <strong>Compartir → Añadir a pantalla de inicio → Añadir</strong>.
            {' '}Si aparece «Abrir como app web», déjalo activado.
          </p>
        )}
        {error && (
          <p className={styles.instrucciones} role="status">
            No se pudo abrir la instalación. Puedes buscar «Instalar aplicación» en el menú del navegador.
          </p>
        )}
      </div>
    </aside>
  );
}
