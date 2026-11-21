/** Copia texto al portapapeles. Usa un método alternativo si la página no está en HTTPS. */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se intenta el método alternativo.
  }

  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();

  try {
    return document.execCommand('copy');
  } finally {
    area.remove();
  }
}

/**
 * Copia HTML enriquecido (para pegar en Outlook) junto con su versión en texto plano.
 * El HTML ya viene armado y escapado por domain/handoverReport; aquí nunca se inserta en la página:
 * el método alternativo escribe ambos formatos en el evento "copy".
 */
export async function copiarHtmlAlPortapapeles(html: string, textoPlano: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext && 'ClipboardItem' in window) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([textoPlano], { type: 'text/plain' })
        })
      ]);
      return true;
    }
  } catch {
    // Se intenta el método alternativo.
  }

  const alCopiar = (evento: ClipboardEvent) => {
    evento.preventDefault();
    evento.clipboardData?.setData('text/html', html);
    evento.clipboardData?.setData('text/plain', textoPlano);
  };
  document.addEventListener('copy', alCopiar);
  try {
    return document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', alCopiar);
  }
}
