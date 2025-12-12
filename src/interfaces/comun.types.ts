export interface Alerta {
    id: number;
    user_id?: string;
    criptomoneda: string;
    condicion: "por encima de" | "por debajo de";
    precio_objetivo: number;
    precio_actual?: number;
    estado?: "pendiente" | "activo";
    creado?: string;
    leido?: boolean;
    activado?: string;
  }

  export interface Notificacion {
    id: number;
    tipo: string;
    titulo: string;
    mensaje: string;
    fecha: string;
    leida: boolean;
    datos_adicionales?: {
      criptomoneda: string;
      precio_objetivo: number;
      precio_actual: number;
      condicion: string;
    };
  }

  export interface DatosActualizacionAlerta {
    criptomoneda?: string;
    condicion?: string;
    precio_objetivo?: number;
    precio_actual?: number;
    leida?: boolean;
  }