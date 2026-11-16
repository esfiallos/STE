type Escucha = () => void;

/** Store mínimo: estado inmutable + suscriptores que se avisan en cada cambio. */
export function createStore<T extends object>(estadoInicial: T) {
  let estado = estadoInicial;
  const escuchas = new Set<Escucha>();

  return {
    get: (): T => estado,

    set(cambios: Partial<T>): void {
      estado = { ...estado, ...cambios };
      escuchas.forEach((escucha) => escucha());
    },

    subscribe(escucha: Escucha): () => void {
      escuchas.add(escucha);
      return () => escuchas.delete(escucha);
    }
  };
}
