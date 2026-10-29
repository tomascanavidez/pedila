/** Estado que devuelven todas las acciones de formulario (Server Actions). */
export interface ActionState {
  ok?: boolean;
  message?: string;
  fields?: Record<string, string>;
  /** Datos extra que devuelve la acción (por ejemplo, el resultado de una importación). */
  data?: Record<string, unknown>;
}

export const initialActionState: ActionState = {};
