import express, { Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { monitorService } from "../services/servicioMonitoreo.js";

const alertasRouter = express.Router();

// Obtener alertas del usuario
alertasRouter.get("/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const supabase = getSupabaseClient();
    const { data: alertas, error } = await supabase
      .from("alertas")
      .select("*")
      .eq("user_id", userId)
      .order("creado", { ascending: false });

    if (error) {
      console.error("Error obteniendo alertas:", error);
      return res.status(500).json({ error: "Error al obtener alertas" });
    }

    return res.json(alertas || []);
  } catch (error) {
    console.error("Error obteniendo alertas:", error);
    return res.status(500).json({ error: "Error al obtener alertas" });
  }
});

// Obtener detalle de una alerta específica
alertasRouter.get("/detalle/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const supabase = getSupabaseClient();
    const { data: alerta, error } = await supabase
      .from("alertas")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error obteniendo alerta:", error);
      return res.status(500).json({ error: "Error al obtener la alerta" });
    }

    if (!alerta) {
      return res.status(404).json({ error: "Alerta no encontrada" });
    }

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

    const supabase = getSupabaseClient();
    const { data: alerta, error } = await supabase
      .from("alertas")
      .insert([
        {
          user_id: userId,
          criptomoneda,
          condicion,
          precio_objetivo: precio_objetivo,
          precio_actual: precio_actual,
          estado: 'pendiente'
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

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

    const supabase = getSupabaseClient();
    const { data: alerta, error } = await supabase
      .from("alertas")
      .update({ 
        estado: 'pendiente',
        activado: null
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.json(alerta);
  } catch (error) {
    console.error("Error reactivando alerta:", error);
    return res.status(500).json({ error: "Error al reactivar alerta" });
  }
});

// Actualizar una alerta existente
alertasRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { criptomoneda, condicion, precio_objetivo, precio_actual } = req.body;

    if (!criptomoneda || !condicion || !precio_objetivo) {
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }

    const supabase = getSupabaseClient();
    const { data: alerta, error } = await supabase
      .from("alertas")
      .update({
        criptomoneda,
        condicion,
        precio_objetivo,
        precio_actual,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.json(alerta);
  } catch (error) {
    console.error("Error actualizando alerta:", error);
    return res.status(500).json({ error: "Error al actualizar alerta" });
  }
});

// Eliminar una alerta
alertasRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("alertas")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }

    return res.status(200).json({ message: "Alerta eliminada correctamente" });
  } catch (error) {
    console.error("Error eliminando alerta:", error);
    return res.status(500).json({ error: "Error al eliminar alerta" });
  }
});

// Obtener precio actual de una cripto
alertasRouter.get("/price/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const priceData = await monitorService.getSymbolPrice(symbol);
    return res.json(priceData);
  } catch (error) {
    console.error("Error obteniendo precio:", error);
    return res.status(500).json({ error: "Error al obtener precio" });
  }
});

export default alertasRouter;