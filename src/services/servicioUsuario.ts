// servicios/servicioUsuario.ts
import { getSupabaseClient } from "../lib/supabase";

interface Usuario {
  id: number;
  email: string;
  password: string;
  nombre: string;
  ultimoAcceso: string | null;
  // Agrega otros campos si es necesario, pero para la respuesta del login no queremos la contraseña
}
interface Exchange {
  id: number;
  exchange: string;
  api_key: string;
  api_secret: string;
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
  async obtenerExchangesUsuario(
    userId: string,
    options?: {
      exchange?: string;
      is_active?: boolean;
    }
  ): Promise<Exchange[]> {
    const supabase = getSupabaseClient();

    let consulta = supabase
      .from("exchanges")
      .select("id,exchange, api_key, api_secret") // Añadimos api_key, api_secret y id
      .eq("user_id", userId);
    // Aplicar filtros opcionales si existen
    if (options?.exchange) {
      consulta = consulta.eq("exchange", options.exchange.toUpperCase());
    }

    if (options?.is_active !== undefined) {
      consulta = consulta.eq("is_active", options.is_active);
    }
    // Ejecutar la consulta
    const { data: exchanges, error } = await consulta;

    if (error) {
      throw new Error(
        `Error al obtener exchanges del usuario: ${error.message}`
      );
    }

    return exchanges || [];
  },

  /**
   * Cuenta el número total de exchanges de un usuario
   * @param userId - ID del usuario
   * @returns Número total de exchanges del usuario
   */
  async contarExchangesUsuario(userId: string): Promise<number> {
    const supabase = getSupabaseClient();

    const { count, error } = await supabase
      .from("exchanges")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      throw new Error(
        `Error al contar exchanges del usuario: ${error.message}`
      );
    }

    return count || 0;
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
        if (error.code === "PGRST116") {
          // Código de error cuando no se encuentra registro
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
  },
  obtenerVentasUsuario: async (
    userId: string,
    bots: boolean = false,
    fechaDesde?: string // Nuevo parámetro opcional
  ): Promise<any[]> => {
    try {
      console.log(`📊 Obteniendo ventas para usuario ID: ${userId}`);

      const supabase = getSupabaseClient();

      // Consulta a la tabla ventas filtrando por idUsuario
      let query = supabase
        .from("ventas")
        .select(
          `
          *,
          compras:compras(*)
        `
        )
        .eq("idUsuario", userId);

      // Si bots es true, filtrar por el campo bots = true
      if (bots) {
        query = query.eq("botS", true);
      }

      // Si se proporciona fechaDesde, filtrar ventas posteriores o iguales
      if (fechaDesde) {
        query = query.gte("fechaVenta", fechaDesde);
      }

      // Ejecutar consulta con orden
      const { data: ventas, error } = await query.order("fechaVenta", {
        ascending: false,
      });

      if (error) {
        throw new Error(`Error al obtener ventas: ${error.message}`);
      }

      console.log(
        `✅ Encontradas ${
          ventas?.length || 0
        } ventas para usuario ID: ${userId}`
      );

      return ventas || [];
    } catch (error) {
      console.error(
        `💥 Error al obtener ventas para usuario ${userId}:`,
        error
      );
      throw error;
    }
  },

  obtenerComprasUsuario: async (
    userId: string,
    bots: boolean = false,
    fechaDesde?: string
  ): Promise<any[]> => {
    try {
      console.log(`📊 Obteniendo compras para usuario ID: ${userId}`);
  
      const supabase = getSupabaseClient();
  
      let query = supabase
        .from("compras")
        .select("*")
        .eq("idUsuario", userId);
  
      if (bots) {
        query = query.eq("botS", true);
      }
  
      if (fechaDesde) {
        query = query.gte("fechaCompra", fechaDesde);
      }
  
      const { data: compras, error } = await query.order("fechaCompra", {
        ascending: false,
      });
  
      if (error) {
        throw new Error(`Error al obtener compras: ${error.message}`);
      }
  
      return compras || [];
    } catch (error) {
      console.error(`💥 Error al obtener compras para usuario ${userId}:`, error);
      throw error;
    }
  },

  desactivarBotEnCompras: async (userId: string): Promise<{ success: boolean; count: number; error?: string }> => {
    try {
      const supabase = getSupabaseClient();
  
      const { data, error } = await supabase
        .from('compras')
        .update({ botS: false })
        .eq('idUsuario', userId)
        .eq('botS', true)
        .select(); // opcional: para obtener las filas actualizadas
  
      if (error) {
        console.error('Error al desactivar botS en compras:', error);
        return { success: false, count: 0, error: error.message };
      }
  
      const count = data?.length || 0;
      console.log(`✅ Desactivado botS en ${count} compras para usuario ${userId}`);
      return { success: true, count };
    } catch (error) {
      console.error('Error inesperado en desactivarBotEnCompras:', error);
      return { success: false, count: 0, error: String(error) };
    }
  },

  obtenerTotalInvertidoBot: async (userId: string): Promise<number> => {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('compras')
        .select('total') // o 'precio, cantidad' y luego multiplicar
        .eq('idUsuario', userId)
        .eq('botS', true)
        .eq('vendida', false);
  
      if (error) {
        console.error('Error al obtener total invertido:', error);
        return 0;
      }
  
      // Sumar los totales (asumiendo que 'total' es el monto en USDC)
      const total = data.reduce((acc, compra) => acc + (compra.total || 0), 0);
      return total;
    } catch (error) {
      console.error('Error inesperado en obtenerTotalInvertidoBot:', error);
      return 0;
    }
  }
};
