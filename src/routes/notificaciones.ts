// routes/notificaciones.ts
import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { authenticateToken } from '../services/middleware/auth.js';
import {servicioAlertas} from '../services/servicioAlertas.js'
import { Alerta} from '../interfaces/comun.types.js';

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
    const notificaciones: Alerta[] = await servicioAlertas.obtenerAlertasUsuario(userId, {
      estado: "activo",
      leido: false,
      orderBy: "activado",
      orderDirection: "desc"
    });

    // Transformar las alertas al formato de notificación del frontend
    const notificacionesFormateadas = (notificaciones || []).map(alerta => ({
      id: alerta.id,
      tipo: 'alerta',
      titulo: `Alerta de ${alerta.criptomoneda}`,
      mensaje: `${alerta.criptomoneda} ha ${alerta.condicion} $${alerta.precio_objetivo}. Precio actual: $${alerta.precio_actual}`,
      fecha: alerta.activado,
      leida: alerta.leida,
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

    await servicioAlertas.actualizarAlerta(id, {
      leida: true
    });

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

    // Marcar las alertas como leídas
    const resultado = await servicioAlertas.marcarAlertasComoLeidas(userId);

    return res.json({ success: true, message: `${resultado.updatedCount} alertas marcadas como leídas`});
  } catch (error) {
    console.error('Error marcando todas las notificaciones como leídas:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;