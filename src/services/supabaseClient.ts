import { createClient } from '@supabase/supabase-js';
import { validarEntorno } from './environment';

validarEntorno(import.meta.env.PUBLIC_APP_ENV, import.meta.env.PROD);

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const clave = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const faltantes = [!url && 'PUBLIC_SUPABASE_URL', !clave && 'PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);

if (faltantes.length > 0) {
  throw new Error(`Falta en el entorno: ${faltantes.join(', ')}. Revisa los nombres y reinicia el servidor.`);
}

export const supabase = createClient(url, clave);
