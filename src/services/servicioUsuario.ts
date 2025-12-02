// servicios/servicioUsuario.ts
import { getSupabaseClient } from '../lib/supabase';

export const servicioUsuario = {
  /**
   * Actualiza la fecha de último acceso del usuario
   * @param userId - ID del usuario a actualizar
   */
  async actualizarUltimoAcceso(userId: string): Promise<void> {
    const supabase = getSupabaseClient();
    
    const { error } = await supabase
      .from('usuarios')
      .update({ 
        ultimoAcceso: new Date().toISOString() 
      })
      .eq('id', userId);

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
      .from('exchanges')
      .select('exchange, api_key, api_secret, id') // Añadimos api_key, api_secret y id
      .eq('user_id', userId);
      
    if (error) {
      throw new Error(`Error al obtener exchanges del usuario: ${error.message}`);
    }
  
    return exchanges || [];
  }
};