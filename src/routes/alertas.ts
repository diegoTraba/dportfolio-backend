import express, { Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { monitorService } from "../services/servicioMonitoreo.js";
import { servicioUsuario } from '../services/servicioUsuario';

const alertasRouter = express.Router();

// Obtener alertas del usuario
alertasRouter.get("/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "Se requiere el ID del usuario" });
    }

     // Usar el servicio para obtener las alertas del usuario
    const alertas = await servicioUsuario.obtenerAlertasUsuario(userId);

    return res.status(200).json(alertas);
  } catch (error) {
    console.error("Error obteniendo alertas:", error);
    return res.status(500).json({ error: "Error al obtener alertas" });
  }
});

// Obtener detalle de una alerta específica
alertasRouter.get("/detalle/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Convertir id a número (ya que en la base de datos es numérico)
    const alertaId = parseInt(id);

    if (isNaN(alertaId)) {
      return res.status(400).json({ error: "ID de alerta no válido" });
    }

    // Usar el servicio para obtener la alerta
    const alerta = await servicioUsuario.obtenerAlerta(alertaId);

    return res.json(alerta);
  } catch (error) {
    console.error("Error obteniendo alerta:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Crear nueva alerta
alertasRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { userId, criptomoneda, condicion, estado, precio_objetivo, precio_actual, creado } = req.body;

    if (!userId || !criptomoneda || !condicion || !precio_objetivo || !precio_actual || !creado) {
      console.log("alerta: "+ criptomoneda +"; condicion: "+ condicion +"; user_id: "+userId +"; estado: "+estado+"; precio_actual: "+precio_actual+"; precio_objetivo: "+ precio_objetivo+"; creado: "+creado);
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }

      // Usar el servicio para crear la alerta
      const alerta = await servicioUsuario.crearAlerta({
        userId,
        criptomoneda,
        condicion,
        precio_objetivo,
        precio_actual,
        creado
      });
  
      return res.status(201).json(alerta);
  } catch (error) {
    console.error("Error creando alerta:", error);
    return res.status(500).json({ error: "Error al crear alerta" });
  }
});

// Reactivar una alerta
alertasRouter.put("/:id/reactivar", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Convertir id a número
    const alertaId = parseInt(id);
    
    if (isNaN(alertaId)) {
      return res.status(400).json({ error: "ID de alerta no válido" });
    }

    // Usar el servicio para reactivar la alerta
    const alerta = await servicioUsuario.reactivarAlerta(alertaId);

    return res.json(alerta);
  } catch (error) {
    console.error("Error reactivando alerta:", error);
    
    // Personalizar respuesta según el tipo de error
    if (error instanceof Error) {
      return res.status(500).json({ error: error.message });
    }
    
    return res.status(500).json({ error: "Error al reactivar alerta" });
  }
});

// Actualizar una alerta existente
alertasRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { criptomoneda, condicion, precio_objetivo, precio_actual } = req.body;

    if (!criptomoneda || !condicion || !precio_objetivo || !precio_actual) {
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }

     // Convertir id a número
     const alertaId = parseInt(id);
    
     if (isNaN(alertaId)) {
       return res.status(400).json({ error: "ID de alerta no válido" });
     }
 
     // Usar el servicio para actualizar la alerta
     const alerta = await servicioUsuario.actualizarAlerta(alertaId, {
       criptomoneda,
       condicion,
       precio_objetivo,
       precio_actual
     });
 
     return res.json(alerta);
  } catch (error) {
    console.error("Error actualizando alerta:", error);
    
    // Personalizar respuesta según el tipo de error
    if (error instanceof Error) {
      return res.status(500).json({ error: error.message });
    }
    
    return res.status(500).json({ error: "Error al actualizar alerta" });
  }
});

// Eliminar una alerta
alertasRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Convertir id a número
    const alertaId = parseInt(id);
    
    if (isNaN(alertaId)) {
      return res.status(400).json({ error: "ID de alerta no válido" });
    }

    // Usar el servicio para eliminar la alerta
    await servicioUsuario.eliminarAlerta(alertaId);

    return res.status(200).json({ message: "Alerta eliminada correctamente" });
  } catch (error) {
    console.error("Error eliminando alerta:", error);
    
    // Personalizar respuesta según el tipo de error
    if (error instanceof Error) {
      return res.status(500).json({ error: error.message });
    }
    
    return res.status(500).json({ error: "Error al eliminar alerta" });
  }
});

// Obtener precio actual de una cripto
alertasRouter.get("/price/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const priceData = await monitorService.obtenerPrecioSimbolo(symbol);
    return res.json(priceData);
  } catch (error) {
    console.error("Error obteniendo precio:", error);
    return res.status(500).json({ error: "Error al obtener precio" });
  }
});

export default alertasRouter;