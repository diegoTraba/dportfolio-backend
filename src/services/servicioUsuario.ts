// servicios/servicioUsuario.ts
import { getSupabaseClient } from "../lib/supabase";

interface Usuario {
  id: number;
  email: string;
  password:string;
  nombre: string;
  ultimoAcceso: string | null;
  // Agrega otros campos si es necesario, pero para la respuesta del login no queremos la contraseña
}

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
   * Obtiene el precio de una criptomoneda por símbolo
   * @param symbol - simbolo de la criptomoneda
   * @returns Objeto precioCriptomoneda con el precio de la criptomoneda consultada
   */
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

  /**
   * Obtiene los precios de todas las criptomonedas guardadas
   * @returns Lista de objetos precioCriptomoneda con el precio de la criptomoneda consultada
   */
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
  },

  /**
   * Obtiene un usuario a partir de su email
   * @returns Objeto usuario con sus propiedades
   */
  obtenerUsuarioEmail: async (email: string): Promise<Usuario> => {
    try {
      const supabase = getSupabaseClient();

      const { data: usuario, error } = await supabase
        .from("usuarios")
        .select("*")
        .eq("email", email)
        .single();

      if (error) {
        throw new Error(`Error al obtener usuario: ${error.message}`);
      }

      return usuario;
    } catch (error) {
      console.error("Error en obtenerTodosPreciosCriptomonedas:", error);
      throw error;
    }
  }
};
