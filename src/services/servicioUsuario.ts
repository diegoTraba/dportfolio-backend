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
      .from('users')
      .update({ 
        ultimoAcceso: new Date().toISOString() 
      })
      .eq('id', userId);

    if (error) {
      throw new Error(`Error al actualizar último acceso: ${error.message}`);
    }
  },
};