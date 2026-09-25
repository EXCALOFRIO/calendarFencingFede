import 'dotenv/config';
import { limpiarDatosDePrueba } from '../tests/e2e/sesion';

/** Borra los perfiles que dejan las pruebas de extremo a extremo. */
await limpiarDatosDePrueba();
process.exit(0);
