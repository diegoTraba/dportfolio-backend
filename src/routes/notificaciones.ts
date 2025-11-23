// routes/notificaciones.ts
import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { authenticateToken } from '../services/middleware/auth.js';

const router = Router();

// Aplicar autenticación a todas las rutas de notificaciones
router.use(authenticateToken);

/**
 * Obtener notificaciones no leídas del usuario
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    // Verificar que el usuario esté autenticado
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const supabase = getSupabaseClient();

    const { data: notificaciones, error } = await supabase
      .from('alertas')
      .select('*')
      .eq('user_id', userId)
      .eq('estado', 'activo')
      .order('activado', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Transformar las alertas al formato de notificación del frontend
    const notificacionesFormateadas = (notificaciones || []).map(alerta => ({
      id: alerta.id,
      tipo: 'alerta',
      titulo: `Alerta de ${alerta.criptomoneda}`,
      mensaje: `${alerta.criptomoneda} ha ${alerta.condicion} $${alerta.precio_objetivo}. Precio actual: $${alerta.precio_actual}`,
      fecha: alerta.activado,
      leida: alerta.leido,
      datos_adicionales: {
        criptomoneda: alerta.criptomoneda,
        precio_objetivo: alerta.precio_objetivo,
        precio_actual: alerta.precio_actual,
        condicion: alerta.condicion
      }
    }));

    return res.json(notificacionesFormateadas);
  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Marcar notificación como leída
 */
router.patch('/:id/leida', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Verificar que el ID sea un número válido
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'ID de notificación inválido' });
    }

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('alertas')
      .update({ leido: true })
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error marcando notificación como leída:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Marcar todas las notificaciones como leídas
 */
router.patch('/leer-todas', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    // Verificar que el usuario esté autenticado
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('alertas')
      .update({ leido: true })
      .eq('usuario_id', userId)
      .eq('estado', 'activo')
      .eq('leido', false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error marcando todas las notificaciones como leídas:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;