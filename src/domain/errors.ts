/**
 * Error de negocio con mensaje apto para mostrar al usuario (en español).
 * Los servicios lanzan DomainError; las acciones lo convierten en un estado de formulario.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** Errores de validación por campo (para marcar cada input del formulario). */
export class FieldErrors extends DomainError {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = "Revisá los datos marcados.") {
    super("VALIDACION", message);
    this.name = "FieldErrors";
    this.fields = fields;
  }
}
