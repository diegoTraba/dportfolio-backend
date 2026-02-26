// routes/usuario.ts
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { servicioUsuario } from "../services/servicioUsuario";
import { monitorService } from "../services/servicioMonitoreo";
import { binanceService } from "../services/servicioBinance";
const router = Router();

// Ruta para obtener los exchanges de un usuario
router.get("/:userId/exchanges", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "ID de usuario no proporcionado" });
    }

    console.log(`👤 Obteniendo exchanges para usuario ID: ${userId}`);

    // Llamar al servicio para obtener los exchanges
    const exchanges = await servicioUsuario.obtenerExchangesUsuario(userId);

    res.json({
      success: true,
      data: exchanges,
      count: exchanges.length,
      message:
        exchanges.length > 0
          ? "Exchanges obtenidos correctamente"
          : "No se encontraron exchanges para este usuario",
    });
  } catch (error) {
    console.error("💥 Error al obtener exchanges:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener exchanges",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Ruta para cargar las ventas de un usuario
router.get("/:userId/cargarventas", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "ID de usuario no proporcionado" });
    }

    console.log(`👤 Obteniendo ventas para usuario ID: ${userId}`);

    // Llamar al servicio para obtener las ventas
    const ventas = await servicioUsuario.obtenerVentasUsuario(userId);

    res.json({
      success: true,
      data: ventas,
      count: ventas.length,
      message:
        ventas.length > 0
          ? "Ventas obtenidas correctamente"
          : "No se encontraron ventas para este usuario",
    });
  } catch (error) {
    console.error("💥 Error al obtener ventas:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener ventas",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

router.get("/:userId/cargarcompras", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { noVendida } = req.query; // leer query param

    if (!userId) {
      return res.status(400).json({ error: "ID de usuario no proporcionado" });
    }

    console.log(`👤 Obteniendo compras para usuario ID: ${userId}, noVendida: ${noVendida}`);

    // Convertir noVendida a booleano (true si el query es "true")
    const soloNoVendidas = noVendida === "true";

    // Llamar al servicio para obtener las ventas
    const compras = await servicioUsuario.obtenerComprasUsuario(userId,false,undefined,soloNoVendidas);

    res.json({
      success: true,
      data: compras,
      count: compras.length,
      message:
        compras.length > 0
          ? "Compras obtenidas correctamente"
          : "No se encontraron compras para este usuario",
    });
  } catch (error) {
    console.error("💥 Error al obtener compras:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener compras",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Obtener compras de un usuario para un símbolo específico
router.get("/:userId/cargarcompras/:simbolo", async (req: Request, res: Response) => {
  try {
    const { userId, simbolo } = req.params;
    const bots = req.query.bots === "true";
    const fechaDesde = req.query.fechaDesde as string | undefined;

    if (!userId || !simbolo) {
      return res.status(400).json({ 
        error: "ID de usuario y símbolo son requeridos" 
      });
    }

    console.log(`👤 Obteniendo compras para usuario ${userId}, símbolo ${simbolo}`);

    const compras = await servicioUsuario.obtenerComprasUsuarioSimbolo(
      userId, 
      simbolo, 
      bots, 
      fechaDesde
    );

    res.json({
      success: true,
      data: compras,
      count: compras.length,
      message: compras.length > 0 
        ? "Compras obtenidas correctamente" 
        : "No se encontraron compras para este usuario y símbolo",
    });
  } catch (error) {
    console.error("💥 Error al obtener compras por símbolo:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener compras",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Obtener ventas de un usuario para un símbolo específico
router.get("/:userId/cargarventas/:simbolo", async (req: Request, res: Response) => {
  try {
    const { userId, simbolo } = req.params;
    const bots = req.query.bots === "true";
    const fechaDesde = req.query.fechaDesde as string | undefined;

    if (!userId || !simbolo) {
      return res.status(400).json({ 
        error: "ID de usuario y símbolo son requeridos" 
      });
    }

    console.log(`👤 Obteniendo ventas para usuario ${userId}, símbolo ${simbolo}`);

    const ventas = await servicioUsuario.obtenerVentasUsuarioSimbolo(
      userId, 
      simbolo, 
      bots, 
      fechaDesde
    );

    res.json({
      success: true,
      data: ventas,
      count: ventas.length,
      message: ventas.length > 0 
        ? "Ventas obtenidas correctamente" 
        : "No se encontraron ventas para este usuario y símbolo",
    });
  } catch (error) {
    console.error("💥 Error al obtener ventas por símbolo:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener ventas",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

router.get('/klines', async (req, res) => {
  try {
    const { symbol, interval = '1h', limit = 100 } = req.query;

    if (!symbol) {
      return res.status(400).json({ error: 'El parámetro symbol es obligatorio' });
    }

    // Validar intervalo (opcional, pero recomendado)
    const intervalosPermitidos = [
      '1m', '3m', '5m', '15m'
    ];
    if (!intervalosPermitidos.includes(interval as string)) {
      return res.status(400).json({ error: 'Intervalo no válido' });
    }

    const klines = await binanceService.getKlines(
      symbol as string,
      interval as string,
      parseInt(limit as string, 10)
    );

    res.json(klines); // Devuelve directamente el array transformado
  } catch (error) {
    console.error('❌ Error en /api/klines:', error);
    res.status(500).json({ error: 'Error al obtener datos de mercado' });
  }
});

// Ruta para iniciar monitoreo de compras
router.post(
  "/iniciar-monitoreo-compras",
  async (req: Request, res: Response) => {
    try {
      console.log("🚀 Solicitando inicio de monitoreo de compras...");

      // Obtener el token del header Authorization
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.log("❌ Token no proporcionado en el header");
        return res.status(401).json({ error: "Token no proporcionado" });
      }

      const token = authHeader.split(" ")[1];

      if (!token) {
        console.log("❌ Formato de token inválido");
        return res.status(401).json({ error: "Formato de token inválido" });
      }

      console.log("🔑 Token recibido para iniciar monitoreo de compras");

      // Verificar y decodificar el token JWT
      let decodedToken;
      try {
        decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY!);
        console.log(`✅ Token verificado para usuario: ${decodedToken.email}`);
      } catch (error) {
        console.error("❌ Error verificando token:", error);
        console.log("⚠️ Token inválido, intentando con userId del body...");
      }

      // Obtener parámetros del body
      const { ultimoAcceso, userId, intervaloMs } = req.body;

      if (!ultimoAcceso) {
        return res
          .status(400)
          .json({ error: "El campo ultimoAcceso es requerido" });
      }

      // Convertir ultimoAcceso a número si es string (y es un número en string)
      let ultimoAccesoNum: number;
      if (typeof ultimoAcceso === "string") {
        // Si es una cadena ISO, convertir a timestamp
        if (isNaN(Number(ultimoAcceso))) {
          // Es una fecha en formato ISO
          ultimoAccesoNum = new Date(ultimoAcceso).getTime();
        } else {
          // Es un número en string
          ultimoAccesoNum = parseInt(ultimoAcceso, 10);
        }
      } else {
        ultimoAccesoNum = ultimoAcceso;
      }

      // Validar que ultimoAcceso sea un número válido
      if (isNaN(ultimoAccesoNum)) {
        return res
          .status(400)
          .json({ error: "El campo ultimoAcceso no es una fecha válida" });
      }

      // Usar intervaloMs por defecto si no se proporciona
      const intervalo = intervaloMs || 300000; // 5 minutos

      console.log(
        `👤 Iniciando monitoreo de compras para usuario ID: ${userId}`
      );
      console.log(
        `📅 Último acceso: ${new Date(ultimoAccesoNum).toISOString()}`
      );
      console.log(`⏰ Intervalo: ${intervalo} ms`);

      // Verificar si ya existe un monitoreo activo
      const monitoreoActivo =
        monitorService.tieneMonitoreoComprasActivo(userId);

      if (monitoreoActivo) {
        console.log(
          `⚠️ El usuario ${userId} ya tiene un monitoreo de compras activo`
        );
        return res.json({
          success: true,
          message: "El monitoreo de compras ya está activo para este usuario",
          monitoreoActivo: true,
        });
      }

      // Iniciar el monitoreo de compras
      monitorService.iniciarMonitoreoCompras(
        userId,
        ultimoAccesoNum,
        intervalo
      );

      res.json({
        success: true,
        message: "Monitoreo de compras iniciado correctamente",
        userId,
        ultimoAcceso: new Date(ultimoAccesoNum).toISOString(),
        intervaloMs: intervalo,
        monitoreoActivo: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        "💥 Error inesperado al iniciar monitoreo de compras:",
        error
      );
      res.status(500).json({
        error: "Error interno del servidor al iniciar monitoreo de compras",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Ruta para detener monitoreo de compras
router.post('/detener-monitoreo-compras', async (req: Request, res: Response) => {
  try {
    console.log('🛑 Solicitando detención de monitoreo de compras...');

    // Obtener el token del header Authorization
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Token no proporcionado en el header');
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
      console.log('❌ Formato de token inválido');
      return res.status(401).json({ error: 'Formato de token inválido' });
    }

    // Verificar y decodificar el token JWT
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY!);
      console.log(`✅ Token verificado para usuario: ${decodedToken.email}`);
    } catch (error) {
      console.error('❌ Error verificando token:', error);
    }

    // Obtener userId del token decodificado o del body
    const userId = decodedToken?.id || req.body.userId;

    if (!userId) {
      console.log('❌ No se pudo obtener el ID del usuario');
      return res.status(400).json({ error: 'ID de usuario no proporcionado' });
    }

    console.log(`👤 Deteniendo monitoreo de compras para usuario ID: ${userId}`);

    // Detener el monitoreo de compras
    monitorService.detenerMonitoreoCompras(userId);

    res.json({
      success: true,
      message: 'Monitoreo de compras detenido correctamente',
      userId,
      monitoreoActivo: false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Error inesperado al detener monitoreo de compras:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor al detener monitoreo de compras',
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Ruta actualizar último acceso
router.post("/actualizarUltimoAcceso", async (req: Request, res: Response) => {
  try {
    console.log("🚪 Procesando cierre de sesión...");

    // Obtener el token del header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ Token no proporcionado en el header");
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      console.log("❌ Formato de token inválido");
      return res.status(401).json({ error: "Formato de token inválido" });
    }

    console.log("🔑 Token recibido para cierre de sesión");

    // Verificar y decodificar el token JWT
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY!);
      console.log(`✅ Token verificado para usuario: ${decodedToken.email}`);
    } catch (error) {
      console.error("❌ Error verificando token:", error);
      console.log("⚠️ Token inválido, intentando con userId del body...");
    }

    // Obtener userId del token decodificado o del body
    const userId = decodedToken?.id || req.body.userId;

    if (!userId) {
      console.log("❌ No se pudo obtener el ID del usuario");
      return res.status(400).json({ error: "ID de usuario no proporcionado" });
    }

    console.log(`👤 Actualizando último acceso para usuario ID: ${userId}`);

    // Llamar al servicio para actualizar el último acceso
    try {
      await servicioUsuario.actualizarUltimoAcceso(userId);
      console.log(`✅ Último acceso actualizado para usuario ID: ${userId}`);
    } catch (error) {
      console.error("❌ Error al actualizar último acceso:", error);
      return res.status(500).json({
        error: "Error al actualizar último acceso",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }

    res.json({
      success: true,
      message: "Último acceso actualizado correctamente",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("💥 Error inesperado en logout:", error);
    res.status(500).json({
      error: "Error interno del servidor al actualizar ultima conexion",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

router.get("/obtenerTodosPreciosCriptomonedas", async (req: Request, res: Response) => {
  try {

    // Llamar al servicio para obtener los exchanges
    const precios = await servicioUsuario.obtenerTodosPreciosCriptomonedas();

    console.log("✅ Precios obtenidos:", {
      cantidad: precios.length,
      primeros_5: precios.slice(0, 5),
      simbolos: precios.map(p => p.simbolo)
    });
    
    res.json({
      success: true,
      data: precios,
      message:
        precios.length > 0
          ? "precios obtenidos correctamente"
          : "No se encontraron precios",
    });
  } catch (error) {
    console.error("💥 Error al obtener exchanges:", error);
    res.status(500).json({
      error: "Error interno del servidor al obtener exchanges",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

export default router;
