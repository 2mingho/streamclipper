// Contrato de versiones entre el servidor y los clientes nativos (si alguien escribe uno).
// · NIVEL: sube cuando un cambio del servidor rompe lo que espera un cliente (rutas, formatos de datos). El cliente manda el
//   suyo en cada petición (cabecera X-App-Nivel); si es menor que NIVEL_MINIMO, el servidor responde 426 y el cliente pide
//   actualizarse. El navegador no manda la cabecera y nunca se bloquea.
export const NIVEL = 2;          // nivel de la API que ofrece este servidor
export const NIVEL_MINIMO = 2;   // un cliente nativo necesita al menos este nivel para funcionar bien

export function version() {
  return { nivel: NIVEL, nivelMinimo: NIVEL_MINIMO };
}

// ¿La petición viene de un cliente demasiado antiguo? (sin cabecera: navegador o cliente sin control de versión)
export function appAntigua(req) {
  const n = Number(req.headers['x-app-nivel']);
  return Number.isFinite(n) && n > 0 && n < NIVEL_MINIMO;
}
