// servicios/servicioUsuario.ts
import { getSupabaseClient } from "../lib/supabase";

export const servicioUsuario = {
  /**
   * Actualiza la fecha de último acceso del usuario
   * @param userId - ID del usuario a actualizar
   */
  async actualizarUltimoAcceso(userId: string): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("usuarios")
      .update({
        ultimoAcceso: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) {
      throw new Error(`Error al actualizar último acceso: ${error.message}`);
    }
  },

  /**
   * Obtiene los exchanges de un usuario específico
   * @param userId - ID del usuario
   * @returns Lista de exchanges del usuario
   */
  async obtenerExchangesUsuario(userId: string): Promise<any[]> {
    const supabase = getSupabaseClient();

    const { data: exchanges, error } = await supabase
      .from("exchanges")
      .select("exchange, api_key, api_secret, id") // Añadimos api_key, api_secret y id
      .eq("user_id", userId);

    if (error) {
      throw new Error(
        `Error al obtener exchanges del usuario: ${error.message}`
      );
    }

    return exchanges || [];
  },
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
  async obtenerAlertasUsuario(userId: string): Promise<any[]> {
    const supabase = getSupabaseClient();

    const { data: alertas, error } = await supabase
      .from("alertas")
      .select("*")
      .eq("user_id", userId)
      .order("creado", { ascending: false });

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
    datos: {
      criptomoneda: string;
      condicion: string;
      precio_objetivo: number;
      precio_actual: number;
    }
  ): Promise<any> {
    const supabase = getSupabaseClient();

    const { data: alerta, error } = await supabase
      .from("alertas")
      .update({
        criptomoneda: datos.criptomoneda,
        condicion: datos.condicion,
        precio_objetivo: datos.precio_objetivo,
        precio_actual: datos.precio_actual,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error al actualizar la alerta: ${error.message}`);
    }

    return alerta;
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
  // Método para obtener el precio de una criptomoneda por símbolo
  obtenerPrecioCriptomoneda: async (symbol: string): Promise<any> => {
    try {
      const supabase = getSupabaseClient();

      const { data, error } = await supabase
        .from("precioCriptomoneda")
        .select("*")
        .eq("simbolo", symbol)
        .single(); // Usamos .single() para obtener un solo registro

      if (error) {
        if (error.code === 'PGRST116') { // Código de error cuando no se encuentra registro
          throw new Error(`No se encontró precio para el símbolo ${symbol}`);
        }
        throw new Error(`Error al obtener precio: ${error.message}`);
      }

      if (!data) {
        throw new Error(`No se encontró precio para el símbolo ${symbol}`);
      }

      return data;
    } catch (error) {
      console.error("Error en obtenerPrecioCriptomoneda:", error);
      throw error;
    }
  },

  // Opcional: Método para obtener todos los precios si necesitas
  obtenerTodosPreciosCriptomonedas: async (): Promise<any[]> => {
    try {
      const supabase = getSupabaseClient();

      const { data, error } = await supabase
        .from("precioCriptomoneda")
        .select("*");

      if (error) {
        throw new Error(`Error al obtener precios: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error("Error en obtenerTodosPreciosCriptomonedas:", error);
      throw error;
    }
  }
};
