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
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return res.json(alertas);
  } catch (error) {
    console.error("Error obteniendo alertas:", error);
    return res.status(500).json({ error: "Error al obtener alertas" });
  }
});

// Crear nueva alerta
alertasRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { userId, criptomoneda, condicion, precioObjetivo } = req.body;

    if (!userId || !criptomoneda || !condicion || !precioObjetivo) {
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
          precio_objetivo: precioObjetivo,
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