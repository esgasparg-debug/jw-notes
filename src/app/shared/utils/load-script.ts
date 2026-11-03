const pending = new Map<string, Promise<void>>();

/** Injects a <script> once and resolves when it has loaded. */
export function loadScript(src: string): Promise<void> {
  let p = pending.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        pending.delete(src);
        reject(new Error(`Falha ao carregar ${src}. Verifique sua conexão.`));
      };
      document.head.appendChild(s);
    });
    pending.set(src, p);
  }
  return p;
}
