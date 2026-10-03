import { respuestaMantenimiento } from '../src/lib/cron/mantenimiento';

/**
 * Temporary cutover entry point. It never loads OpenNext, Neon, D1 or a cron
 * runner. Unlike the application wrapper, no environment flag can reopen it.
 */
export default {
  fetch(request: Request) { return respuestaMantenimiento(request); },
  async scheduled() { /* No source reads, jobs or database writes during cutover. */ },
};
