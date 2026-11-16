import { guardarSnapshotDeHoy } from '../actions/snapshotActions';
import { byId } from '../dom';

export function iniciarSnapshot(): void {
  const boton = byId<HTMLButtonElement>('btnSnapshot');

  boton.addEventListener('click', async () => {
    boton.disabled = true;
    try {
      await guardarSnapshotDeHoy();
    } finally {
      boton.disabled = false;
    }
  });
}
