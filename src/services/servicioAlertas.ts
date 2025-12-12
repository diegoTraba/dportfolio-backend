import { getSupabaseClient } from "../lib/supabase";
import {DatosActualizacionAlerta} from "../interfaces/comun.types";

export const servicioAlertas = {
  /**
   * Crea una nueva alerta para un usuario
   * @param datosAlerta - Datos de la alerta a crear
   * @returns La alerta creada
   */
  async crearAlerta(datosAlerta: {
    userId: string;
    criptomoneda: string;
    condicion: string;
    precio_objetivo: number;
    precio_actual: number;
    creado: string;
  }): Promise<any> {
    const supabase = getSupabaseClient();

    const { data: alerta, error } = await supabase
      .from("alertas")
      .insert([
        {
          user_id: datosAlerta.userId,
          criptomoneda: datosAlerta.criptomoneda,
          condicion: datosAlerta.condicion,
          precio_objetivo: datosAlerta.precio_objetivo,
          precio_actual: datosAlerta.precio_actual,
          estado: "pendiente",
          creado: datosAlerta.creado,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error(`Error al crear alerta: ${error.message}`);
    }

    return alerta;
  },

  /**
   * Obtiene todas las alertas de un usuario
   * @param userId - ID del usuario
   * @returns Lista de alertas del usuario
   */
  async obtenerAlertasUsuario(
    userId: string,
    filtros?: {
      estado?: string;
      leido?: boolean;
      orderBy?: string;
      orderDirection?: "asc" | "desc";
    }
  ): Promise<any[]> {
    const supabase = getSupabaseClient();

    // Construir la consulta base
    let query = supabase.from("alertas").select("*").eq("user_id", userId);

    // Aplicar filtro por estado si se proporciona
    if (filtros?.estado) {
      query = query.eq("estado", filtros.estado);
    }

    // Aplicar filtro por leido si se proporciona (incluso si es false)
    if (filtros?.leido !== undefined) {
      query = query.eq("leido", filtros.leido);
    }

    // Aplicar orden
    const campoOrden = filtros?.orderBy || "creado";
    const direccionOrden = filtros?.orderDirection || "desc";

    query = query.order(campoOrden, { ascending: direccionOrden === "asc" });

    // Ejecutar la consulta
    const { data: alertas, error } = await query;

    if (error) {
      throw new Error(`Error al obtener alertas del usuario: ${error.message}`);
    }

    return alertas || [];
  },

  /**
   * Obtiene una alerta específica por su ID
   * @param id - ID de la alerta
   * @returns La alerta encontrada
   */
  async obtenerAlerta(id: number): Promise<any> {
    const supabase = getSupabaseClient();

    const { data: alerta, error } = await supabase
      .from("alertas")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      throw new Error(`Error al obtener la alerta: ${error.message}`);
    }

    if (!alerta) {
      throw new Error("Alerta no encontrada");
    }

    return alerta;
  },
  /**
   * Reactivar una alerta cambiando su estado a 'pendiente' y eliminando la fecha de activado
   * @param id - ID de la alerta
   * @returns La alerta reactivada
   */
  async reactivarAlerta(id: number): Promise<any> {
    const supabase = getSupabaseClient();

    const { data: alerta, error } = await supabase
      .from("alertas")
      .update({
        estado: "pendiente",
        activado: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error al reactivar la alerta: ${error.message}`);
    }

    return alerta;
  },

  /**
   * Actualizar una alerta existente
   * @param id - ID de la alerta
   * @param datos - Datos a actualizar (criptomoneda, condicion, precio_objetivo, precio_actual)
   * @returns La alerta actualizada
   */
  async actualizarAlerta(
    id: number,
    datos: DatosActualizacionAlerta
  ): Promise<any> {
    const supabase = getSupabaseClient();
  
    // Validar que el ID sea positivo
    if (id <= 0) {
      throw new Error('ID de alerta inválido');
    }
  
    // Preparar objeto de actualización para Supabase
    const datosParaSupabase: Record<string, any> = {};
  
    // Campos directos (sin mapeo)
    const camposDirectos: (keyof DatosActualizacionAlerta)[] = [
      'criptomoneda', 'condicion', 'precio_objetivo', 'precio_actual'
    ];
  
    camposDirectos.forEach(campo => {
      if (datos[campo] !== undefined) {
        datosParaSupabase[campo] = datos[campo];
      }
    });
  
    // Campo con mapeo de nombre (leida -> leido)
    if (datos.leida !== undefined) {
      datosParaSupabase.leido = datos.leida;
    }
  
    // Validar que haya al menos un campo para actualizar
    if (Object.keys(datosParaSupabase).length === 0) {
      throw new Error('No se proporcionaron datos para actualizar la alerta');
    }
  
    // Ejecutar la actualización
    const { data: alerta, error } = await supabase
      .from("alertas")
      .update(datosParaSupabase)
      .eq("id", id)
      .select()
      .single();
  
    if (error) {
      throw new Error(`Error al actualizar la alerta: ${error.message}`);
    }
  
    return alerta;
  },
  async marcarAlertasComoLeidas(
    userId: string
  ): Promise<{ updatedCount: number }> {
    const supabase = getSupabaseClient();

      // Crear la consulta base
      let query = supabase
      .from("alertas")
      .update({ leido: true })
      .eq("leido", false)
      .eq("user_id",userId);
      const { data, error, count } = await query.select();
    
      if (error) {
        throw new Error(`Error al marcar alertas como leídas: ${error.message}`);
      }
      return { updatedCount: count || 0 };
  
  },
  /**
   * Eliminar una alerta
   * @param id - ID de la alerta
   */
  async eliminarAlerta(id: number): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase.from("alertas").delete().eq("id", id);

    if (error) {
      throw new Error(`Error al eliminar la alerta: ${error.message}`);
    }
  },
};
