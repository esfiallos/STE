export type TipoDeSonido = 'asignar' | 'copiar' | 'almuerzo' | 'notificacion';

interface Tono {
  frecuencia: number;
  volumen: number;
  duracion: number;
  onda: OscillatorType;
}

const TONOS: Record<TipoDeSonido, Tono> = {
  asignar: { frecuencia: 523.25, volumen: 0.12, duracion: 0.25, onda: 'sine' },
  copiar: { frecuencia: 880, volumen: 0.05, duracion: 0.1, onda: 'sine' },
  almuerzo: { frecuencia: 440, volumen: 0.15, duracion: 0.35, onda: 'triangle' },
  notificacion: { frecuencia: 659.25, volumen: 0.14, duracion: 0.4, onda: 'sine' }
};

let contexto: AudioContext | null = null;

export function reproducirSonido(tipo: TipoDeSonido): void {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') void contexto.resume();

    const { frecuencia, volumen, duracion, onda } = TONOS[tipo];
    const oscilador = contexto.createOscillator();
    const ganancia = contexto.createGain();
    const inicio = contexto.currentTime;

    oscilador.type = onda;
    oscilador.frequency.setValueAtTime(frecuencia, inicio);
    ganancia.gain.setValueAtTime(volumen, inicio);
    ganancia.gain.exponentialRampToValueAtTime(0.001, inicio + duracion);

    oscilador.connect(ganancia);
    ganancia.connect(contexto.destination);
    oscilador.start(inicio);
    oscilador.stop(inicio + duracion);
  } catch (error) {
    console.warn('No se pudo reproducir el sonido:', error);
  }
}
