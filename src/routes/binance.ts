import express, { Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";
import { encrypt, decrypt } from "../lib/encriptacion.js";
import {
  binanceService,
  SUPPORTED_SYMBOLS,
  isValidSymbol,
} from "../services/servicioBinance.js";
import {
  BinanceCredentials,
  ExchangeInfoResponse,
  TradeHistoryParams,
} from "../interfaces/binance.types.js";
import { servicioUsuario } from "../services/servicioUsuario.js";

interface Exchange {
  id: number;
  exchange: string;
  api_key: string;
  api_secret: string;
}

const binanceRouter = express.Router();

// Conexion a binance
binanceRouter.post("/connect", async (req: Request, res: Response) => {
  try {
    console.log("=== CONEXIÓN BINANCE - BACKEND ===");

    const { apiKey, apiSecret, userId } = req.body;

    console.log("Datos recibidos:", {
      userId,
      apiKey: apiKey ? `...${apiKey.slice(-4)}` : "undefined",
    });

    if (!userId) {
      return res.status(401).json({ error: "Usuario no identificado" });
    }

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: "API Key y Secret son requeridos" });
    }

    // Probar conexión con Binance
    const credentials: BinanceCredentials = {
      apiKey: apiKey,
      apiSecret: apiSecret,
    };
    const isValid = await binanceService.testConnection(credentials);

    if (!isValid) {
      return res
        .status(401)
        .json({ error: "Credenciales de Binance inválidas" });
    }

    // Encriptar credenciales
    const encryptedApiKey = encrypt(apiKey);
    const encryptedApiSecret = encrypt(apiSecret);

    // Guardar en base de datos
    const supabase = getSupabaseClient();
    const { data: exchange, error: exchangeError } = await supabase
      .from("exchanges")
      .upsert({
        user_id: userId,
        exchange: "BINANCE",
        api_key: encryptedApiKey,
        api_secret: encryptedApiSecret,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (exchangeError) {
      console.error("Error saving exchange:", exchangeError);
      return res.status(500).json({
        error: "Error al guardar la conexión en la base de datos",
      });
    }

    // Obtener balance total
    const totalBalance = await binanceService.getTotalUSDBalance(credentials);

    console.log("=== CONEXIÓN EXITOSA ===");
    return res.json({
      success: true,
      totalBalance,
      message: "Binance conectado correctamente",
    });
  } catch (error) {
    console.error("Error en conexión Binance:", error);
    return res.status(500).json({
      error: "Error al conectar con Binance. Verifica tus credenciales.",
    });
  }
});

//obtener balance de la cuenta
binanceRouter.get("/balance/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Validación básica del parámetro
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({ error: "El userId es requerido" });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.json({
        totalBalance: 0,
        connected: false,
        exchangesCount: 0,
        message:
          "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Tomar el primer exchange del array
    const exchange = exchanges[0];
    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    // Obtener balance actual
    const credentials: BinanceCredentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };
    const totalUSD = await binanceService.getTotalUSDBalance(credentials);
    const exchangesCount = await servicioUsuario.contarExchangesUsuario(userId);

    return res.json({
      totalUSD,
      connected: true,
      exchangesCount: exchangesCount,
      currency: "USD",
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error obteniendo balance:", error);
    return res.json({
      totalUSD: 0,
      connected: false,
      exchangesCount: 0,
    });
  }
});

// Obtener historial de compras del usuario para un símbolo específico
binanceRouter.get("/trades/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { symbol, startTime, endTime, limit = "100" } = req.query;

    console.log("=== 🛒 OBTENIENDO COMPRAS DEL USUARIO ===");

    // Validaciones
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({ error: "El userId es requerido" });
    }

    if (!symbol) {
      return res.status(400).json({
        error: "El parámetro 'symbol' es obligatorio",
        supportedSymbols: SUPPORTED_SYMBOLS,
      });
    }

    const symbolStr = symbol as string;
    if (!isValidSymbol(symbolStr)) {
      return res.status(400).json({
        error: `Símbolo '${symbolStr}' no soportado`,
        supportedSymbols: SUPPORTED_SYMBOLS,
      });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.json({
        totalBalance: 0,
        connected: false,
        exchangesCount: 0,
        message:
          "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Tomar el primer exchange del array
    const exchange = exchanges[0];

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials: BinanceCredentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };

    // Preparar parámetros para la consulta
    const tradeParams: TradeHistoryParams = {
      symbol: symbolStr,
      limit: parseInt(limit as string),
    };

    if (startTime) {
      tradeParams.startTime = parseInt(startTime as string);
    }

    if (endTime) {
      tradeParams.endTime = parseInt(endTime as string);
    }

    // Obtener las compras del usuario
    const buyTrades = await binanceService.getUserTrades(
      credentials,
      tradeParams
    );

    // Formatear la respuesta
    const formattedTrades = buyTrades.map((trade) => ({
      id: trade.id,
      orderId: trade.orderId,
      symbol: trade.symbol,
      price: parseFloat(trade.price),
      quantity: parseFloat(trade.qty),
      total: parseFloat(trade.quoteQty),
      commission: parseFloat(trade.commission),
      commissionAsset: trade.commissionAsset,
      timestamp: trade.time,
      date: new Date(trade.time).toISOString(),
      isBuyer: trade.isBuyer,
      isMaker: trade.isMaker,
    }));

    console.log(
      `✅ ${formattedTrades.length} compras obtenidas para ${symbolStr}`
    );

    return res.json({
      success: true,
      symbol: symbolStr,
      trades: formattedTrades,
      total: formattedTrades.length,
      query: {
        startTime: startTime
          ? new Date(parseInt(startTime as string)).toISOString()
          : null,
        endTime: endTime
          ? new Date(parseInt(endTime as string)).toISOString()
          : null,
        limit: parseInt(limit as string),
      },
    });
  } catch (error) {
    console.error("❌ Error obteniendo compras del usuario:", error);
    return res.status(500).json({
      error: "Error al obtener el historial de compras",
      details: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

// Obtener todas las compras del usuario para todos los símbolos soportados
binanceRouter.get(
  "/all-trades/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { startTime, endTime, limit = "100" } = req.query;

      console.log("=== 🛒 OBTENIENDO TODAS LAS COMPRAS DEL USUARIO ===");

      if (!userId || userId.trim().length === 0) {
        return res.status(400).json({ error: "El userId es requerido" });
      }

      // Obtener credenciales de Binance del usuario
      const exchanges: Exchange[] =
        await servicioUsuario.obtenerExchangesUsuario(userId, {
          exchange: "binance",
          is_active: true,
        });

      // Verificar si hay exchanges
      if (!exchanges || exchanges.length === 0) {
        return res.json({
          totalBalance: 0,
          connected: false,
          exchangesCount: 0,
          message:
            "No se encontraron exchanges de Binance activos para este usuario",
        });
      }

      // Tomar el primer exchange del array
      const exchange = exchanges[0];

      // Desencriptar credenciales
      const decryptedApiKey = decrypt(exchange.api_key);
      const decryptedApiSecret = decrypt(exchange.api_secret);

      const credentials: BinanceCredentials = {
        apiKey: decryptedApiKey,
        apiSecret: decryptedApiSecret,
      };

      // Preparar parámetros para la consulta
      const tradeParams: Omit<TradeHistoryParams, "symbol"> = {
        limit: parseInt(limit as string),
      };

      if (startTime) {
        tradeParams.startTime = parseInt(startTime as string);
      }

      if (endTime) {
        tradeParams.endTime = parseInt(endTime as string);
      }

      // Obtener todas las compras del usuario para todos los símbolos soportados
      const allBuyTrades = await binanceService.getAllUserTrades(
        credentials,
        tradeParams
      );

      for (const trade of allBuyTrades) {
        try {
          const supabase = getSupabaseClient();
          // Verificar si la compra ya existe en la base de datos
          const { data: compraExistente, error: errorConsulta } = await supabase
            .from("compras")
            .select("id")
            .eq("idOrden", trade.orderId)
            .eq("simbolo", trade.symbol)
            .maybeSingle();

          if (errorConsulta) {
            console.error(
              `❌ Error verificando compra ${trade.orderId} - ${trade.symbol}:`,
              errorConsulta
            );
            continue;
          }
          if (compraExistente) {
            console.log(
              `⏭️ Compra ya existe en BD: ${trade.symbol} - Orden ${trade.orderId}`
            );
            continue;
          }

          // Preparar datos para insertar
          const datosCompra = {
            exchange: "Binance",
            idOrden: trade.orderId.toString(),
            simbolo: trade.symbol,
            precio: parseFloat(trade.price),
            cantidad: parseFloat(trade.qty),
            total: parseFloat(trade.quoteQty),
            comision: parseFloat(trade.commission),
            fechaCompra: new Date(trade.time).toISOString(),
            vendida: false,
            idUsuario: userId,
          };

          // Insertar en la base de datos
          const { data: nuevaCompra, error: errorInsercion } = await supabase
            .from("compras")
            .insert([datosCompra])
            .select();

          if (errorInsercion) {
            console.error(
              `❌ Error guardando compra ${trade.orderId} - ${trade.symbol}:`,
              errorInsercion
            );

            // Si el error es por duplicado, continuar
            if (errorInsercion.code === "23505") {
              continue;
            }
          } else {
            console.log(
              `✅ Guardada: ${trade.symbol} - ${trade.qty} @ $${trade.price}`
            );
          }
        } catch (error) {
          console.error(`💥 Error procesando compra ${trade.orderId}:`, error);
        }
      }

      // Formatear estadísticas
      const estadisticas = {
        comprasIdentificadas: allBuyTrades.length,
        fechaSincronizacion: new Date().toISOString(),
      };

      console.log("=== 📈 RESUMEN DE SINCRONIZACIÓN ===");
      console.log(
        `Total transacciones obtenidas: ${estadisticas.comprasIdentificadas}`
      );

      return res.json({
        success: true,
        trades: allBuyTrades.length,
      });
    } catch (error) {
      console.error("❌ Error obteniendo todas las compras:", error);
      return res.status(500).json({
        error: "Error al obtener el historial completo de compras",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Endpoint para obtener las compras activas (no vendidas) de un usuario
binanceRouter.get(
  "/compras-activas/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const {
        limit = "500",
        offset = "0",
        simbolo,
        fechaDesde,
        fechaHasta,
        orderBy = "fechaCompra",
        orderDirection = "desc",
      } = req.query;

      console.log("=== 📋 OBTENIENDO COMPRAS ACTIVAS DEL USUARIO ===");
      console.log(`👤 User ID: ${userId}`);

      // Log de filtros de fecha si se proporcionan
      if (fechaDesde) {
        console.log(`📅 Fecha desde: ${fechaDesde}`);
      }
      if (fechaHasta) {
        console.log(`📅 Fecha hasta: ${fechaHasta}`);
      }

      if (!userId || userId.trim().length === 0) {
        return res.status(400).json({ error: "El userId es requerido" });
      }

      // Validar formato de fechas si se proporcionan
      if (fechaDesde && !isValidDateString(fechaDesde as string)) {
        return res
          .status(400)
          .json({ error: "Formato de fechaDesde inválido. Use YYYY-MM-DD" });
      }

      if (fechaHasta && !isValidDateString(fechaHasta as string)) {
        return res
          .status(400)
          .json({ error: "Formato de fechaHasta inválido. Use YYYY-MM-DD" });
      }

      const supabase = getSupabaseClient();

      // Construir la consulta base
      let query = supabase
        .from("compras")
        .select("*", { count: "exact" })
        .eq("idUsuario", userId)
        .eq("vendida", false);

      // Aplicar filtro por símbolo si se proporciona
      if (simbolo && simbolo.toString().trim() !== "") {
        query = query.ilike("simbolo", `%${simbolo.toString().toUpperCase()}%`);
        console.log(`🔍 Filtro por símbolo: ${simbolo}`);
      }

      // Aplicar filtro por fecha desde si se proporciona
      if (fechaDesde) {
        const fechaDesdeObj = new Date(fechaDesde as string);
        // Establecer hora a 00:00:00 para incluir todo el día
        fechaDesdeObj.setHours(0, 0, 0, 0);
        query = query.gte("fechaCompra", fechaDesdeObj.toISOString());
        console.log(`📅 Filtrando desde: ${fechaDesdeObj.toISOString()}`);
      }

      // Aplicar filtro por fecha hasta si se proporciona
      if (fechaHasta) {
        const fechaHastaObj = new Date(fechaHasta as string);
        // Establecer hora a 23:59:59 para incluir todo el día
        fechaHastaObj.setHours(23, 59, 59, 999);
        query = query.lte("fechaCompra", fechaHastaObj.toISOString());
        console.log(`📅 Filtrando hasta: ${fechaHastaObj.toISOString()}`);
      }

      // Aplicar ordenamiento
      const orden = orderDirection === "asc" ? orderDirection : "desc";
      query = query.order(orderBy.toString(), { ascending: orden === "asc" });

      // Aplicar paginación
      const limite = parseInt(limit as string);
      const desplazamiento = parseInt(offset as string);
      query = query.range(desplazamiento, desplazamiento + limite - 1);

      // Ejecutar consulta
      const { data: compras, error, count } = await query;

      if (error) {
        console.error("❌ Error obteniendo compras activas:", error);
        return res.status(500).json({
          error: "Error al obtener las compras activas",
          details: error.message,
        });
      }

      console.log(`✅ ${compras?.length || 0} compras activas encontradas`);

      // Calcular estadísticas adicionales
      let valorTotalInvertido = 0;
      let cantidadTotalCriptos = 0;
      const simbolosUnicos = new Set<string>();

      if (compras && compras.length > 0) {
        compras.forEach((compra) => {
          valorTotalInvertido += compra.total || 0;
          cantidadTotalCriptos += compra.cantidad || 0;
          simbolosUnicos.add(compra.simbolo);
        });
      }

      const estadisticas = {
        totalCompras: count || 0,
        valorTotalInvertido: parseFloat(valorTotalInvertido.toFixed(2)),
        cantidadTotalCriptos: parseFloat(cantidadTotalCriptos.toFixed(8)),
        cantidadSimbolosDiferentes: simbolosUnicos.size,
        fechaConsulta: new Date().toISOString(),
      };

      return res.json({
        success: true,
        compras: compras || [],
        paginacion: {
          total: count || 0,
          limite,
          desplazamiento,
          paginas: Math.ceil((count || 0) / limite),
        },
        estadisticas,
        filtros: {
          simbolo: simbolo || null,
          fechaDesde: fechaDesde || null,
          fechaHasta: fechaHasta || null,
          orderBy,
          orderDirection: orden,
        },
      });
    } catch (error) {
      console.error("❌ Error inesperado obteniendo compras activas:", error);
      return res.status(500).json({
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

// Función auxiliar para validar formato de fecha (YYYY-MM-DD)
function isValidDateString(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

// Obtener símbolos con actividad del usuario
binanceRouter.get(
  "/trade-symbols/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      if (!userId || userId.trim().length === 0) {
        return res.status(400).json({ error: "El userId es requerido" });
      }
      const exchanges: Exchange[] =
        await servicioUsuario.obtenerExchangesUsuario(userId, {
          exchange: "BINANCE",
          is_active: true,
        });

      // Verificar si hay exchanges
      if (!exchanges || exchanges.length === 0) {
        return res.json({
          totalBalance: 0,
          connected: false,
          exchangesCount: 0,
          message:
            "No se encontraron exchanges de Binance activos para este usuario",
        });
      }

      // Tomar el primer exchange del array
      const exchange = exchanges[0];

      const decryptedApiKey = decrypt(exchange.api_key);
      const decryptedApiSecret = decrypt(exchange.api_secret);

      const credentials: BinanceCredentials = {
        apiKey: decryptedApiKey,
        apiSecret: decryptedApiSecret,
      };

      const symbols = await binanceService.getUserTradeSymbols(credentials);

      return res.json({
        success: true,
        symbols,
        total: symbols.length,
      });
    } catch (error) {
      console.error("❌ Error obteniendo símbolos:", error);
      return res.status(500).json({
        error: "Error al obtener los símbolos con actividad",
      });
    }
  }
);
// ====================================
// Compras
// ====================================

/**
 * Ruta para verificar disponibilidad antes de comprar
 */
binanceRouter.post("/check-buy", async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol, quantity } = req.body;

    if (!apiKey || !apiSecret || !symbol || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Todos los parámetros son requeridos",
      });
    }

    const credentials = { apiKey, apiSecret };
    const result = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      quantity
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en /check-buy:", error);
    res.status(500).json({
      success: false,
      error: "Error verificando disponibilidad",
    });
  }
});

/**
 * Ruta para compra simplificada con credenciales de usuario
 */
binanceRouter.post("/user/:userId/buy", async (req, res) => {
  try {
    const { userId } = req.params;
    // MODIFICADO: Añadir quoteQuantity
    const { symbol, quantity, price, type, quoteQuantity } = req.body;

    console.log("=== 🛒 COMPRA DESDE USUARIO ===");
    console.log(`👤 User ID: ${userId}`);
    console.log(`📊 Parámetros:`, {
      symbol,
      quantity,
      price,
      type,
      quoteQuantity,
    });

    // Validaciones básicas
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El userId es requerido",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: "El símbolo es requerido",
      });
    }

    // MODIFICADO: Validar que haya al menos una cantidad
    if (!quantity && !quoteQuantity) {
      return res.status(400).json({
        success: false,
        error:
          "Se requiere 'quantity' (activo base) o 'quoteQuantity' (moneda de cotización)",
      });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Tomar el primer exchange del array
    const exchange = exchanges[0];

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };

    console.log(`🔐 Credenciales obtenidas para usuario ${userId}`);

    // MODIFICADO: Obtener precio actual para cálculos
    const currentPrice = await binanceService.getPrice(symbol);
    console.log(`💰 Precio actual de ${symbol}: ${currentPrice}`);

    // MODIFICADO: Calcular cantidad real del activo base y costo estimado
    let baseQuantity, estimatedCost;

    if (
      quoteQuantity !== undefined &&
      quoteQuantity !== null &&
      quoteQuantity !== ""
    ) {
      // El usuario quiere gastar una cantidad fija de la moneda de cotización
      const quoteQty = parseFloat(quoteQuantity.toString());
      baseQuantity = quoteQty / currentPrice;
      estimatedCost = quoteQty; // El costo ya es conocido
    } else {
      // Comportamiento original: quantity es la cantidad del activo base
      baseQuantity = parseFloat(quantity.toString());
      estimatedCost = baseQuantity * currentPrice;
    }

    console.log(`📊 Cantidad calculada del activo base: ${baseQuantity}`);
    console.log(`📊 Costo estimado: ${estimatedCost}`);

    // MODIFICADO: Verificar disponibilidad con cantidad base y precio actual
    const availability = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      baseQuantity,
      currentPrice // Pasar precio para evitar doble cálculo
    );

    if (!availability.canBuy) {
      return res.status(400).json({
        success: false,
        error: `Saldo insuficiente. Disponible: ${availability.availableBalance} ${availability.quoteAsset}, Necesario estimado: ${availability.estimatedCost}`,
      });
    }

    // MODIFICADO: Construir parámetros de orden según el tipo
    const orderParams: any = {
      symbol,
      type: type || "MARKET",
    };

    const isMarketOrder = !type || type === "MARKET";
    const isLimitOrder = type === "LIMIT";

    // Para órdenes de mercado con quoteQuantity, usar quoteOrderQty
    if (
      isMarketOrder &&
      quoteQuantity !== undefined &&
      quoteQuantity !== null &&
      quoteQuantity !== ""
    ) {
      orderParams.quoteOrderQty = estimatedCost;
    } else {
      // Para órdenes límite o sin quoteQuantity, usar quantity normal
      orderParams.quantity = baseQuantity;
    }

    if (isLimitOrder && price) {
      orderParams.price = price;
    }

    const result = await binanceService.placeBuyOrder(credentials, orderParams);

    if (!result.success) {
      return res.status(400).json(result);
    }

    if (result.order.fills && result.order.fills.length > 0) {
      let comisionTotalUSDC = 0;

      result.order.fills.forEach((fill, index) => {
        console.log(`   Transacción ${index + 1}:`);
        console.log(
          `     - Comisión: ${fill.commission} ${fill.commissionAsset}`
        );

        // Si la comisión es en USDC/USDT, súmala
        if (
          fill.commissionAsset === "USDC" ||
          fill.commissionAsset === "USDT"
        ) {
          comisionTotalUSDC += parseFloat(fill.commission);
        } else {
          console.log(`La comision no esta en usdc`);
        }
      });

      console.log(`   Total comisión en USDC: ${comisionTotalUSDC}`);
    }

    // MODIFICADO: Guardar compra con cantidad base calculada
    try {
      const supabase = getSupabaseClient();
      const datosCompra = {
        exchange: "Binance",
        idOrden: result.order?.orderId.toString() || "",
        simbolo: symbol,
        precio: result.order?.fills?.[0]?.price
          ? parseFloat(result.order.fills[0].price)
          : currentPrice, // Usar precio actual como fallback
        cantidad: baseQuantity, // Guardar cantidad base calculada
        total: result.order?.cummulativeQuoteQty
          ? parseFloat(result.order.cummulativeQuoteQty)
          : null, // Usar costo estimado como fallback
        comision: result.order?.fills?.[0]?.commission
          ? parseFloat(result.order.fills[0].commission)
          : 0,
        comisionMoneda: result.order?.fills?.[0]?.commissionAsset
          ? result.order.fills[0].commissionAsset
          : "",
        fechaCompra: result.order?.transactTime
          ? new Date(result.order.transactTime).toISOString()
          : new Date().toISOString(),
        vendida: false,
        idUsuario: userId,
      };

      const { data: nuevaCompra, error: errorInsercion } = await supabase
        .from("compras")
        .insert([datosCompra])
        .select();

      if (errorInsercion) {
        console.error("⚠️ Error guardando compra en BD:", errorInsercion);
      } else {
        console.log("✅ Compra guardada en base de datos local");
      }
    } catch (dbError) {
      console.error("⚠️ Error en guardado BD:", dbError);
    }

    res.json({
      success: true,
      message: "Orden de compra ejecutada exitosamente",
      order: result.order,
      localId: result.order?.orderId,
    });
  } catch (error) {
    console.error("Error en /user/:userId/buy:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido al realizar la compra",
    });
  }
});

/**
 * Ruta para verificar disponibilidad antes de comprar (con credenciales de usuario)
 */
binanceRouter.post("/user/:userId/check-buy", async (req, res) => {
  try {
    const { userId } = req.params;
    const { symbol, quantity } = req.body;

    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El userId es requerido",
      });
    }

    if (!symbol || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Todos los parámetros son requeridos",
      });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Tomar el primer exchange del array
    const exchange = exchanges[0];

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };

    const result = await binanceService.checkBuyAvailability(
      credentials,
      symbol,
      quantity
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en /user/:userId/check-buy:", error);
    // Para desarrollo, envía más detalles
    const errorResponse = {
      success: false,
      error:
        "Error verificando disponibilidad. Message: " +
        error.message +
        "; Stack: " +
        error.stack,
    };

    res.status(500).json(errorResponse);
  }
});

//====================================
// Ventas
//====================================

/**
 * Ruta para venta simplificada con credenciales de usuario
 */
binanceRouter.post("/user/:userId/sell", async (req, res) => {
  try {
    const { userId } = req.params;
    // Parámetros: compraId es obligatorio para asociar la venta
    const { compraId, symbol, quantity, price, type, quoteQuantity } = req.body;

    console.log("=== 📤 VENTA DESDE USUARIO ===");
    console.log(`👤 User ID: ${userId}`);
    console.log(`📊 Parámetros:`, {
      compraId,
      symbol,
      quantity,
      price,
      type,
      quoteQuantity,
    });

    // Validaciones básicas
    if (!userId || userId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "El userId es requerido",
      });
    }

    if (!compraId) {
      return res.status(400).json({
        success: false,
        error: "El compraId es requerido para asociar la venta",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: "El símbolo es requerido",
      });
    }

    // Validar que haya al menos una cantidad
    if (!quantity && !quoteQuantity) {
      return res.status(400).json({
        success: false,
        error:
          "Se requiere 'quantity' (activo base) o 'quoteQuantity' (moneda de cotización)",
      });
    }

    // Obtener credenciales de Binance del usuario
    const exchanges: Exchange[] = await servicioUsuario.obtenerExchangesUsuario(
      userId,
      {
        exchange: "binance",
        is_active: true,
      }
    );

    // Verificar si hay exchanges
    if (!exchanges || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No se encontraron exchanges de Binance activos para este usuario",
      });
    }

    // Obtener la compra asociada desde Supabase
    const supabase = getSupabaseClient();
    const { data: compra, error: errorCompra } = await supabase
      .from("compras")
      .select("*")
      .eq("id", compraId)
      .eq("idUsuario", userId)
      .single();

    if (errorCompra || !compra) {
      return res.status(400).json({
        success: false,
        error: "Compra no encontrada o no pertenece al usuario",
      });
    }

    // Verificar que la compra no esté ya vendida
    if (compra.vendida) {
      return res.status(400).json({
        success: false,
        error: "Esta compra ya ha sido vendida completamente",
      });
    }

    // Calcular cantidad disponible para vender
    const cantidadDisponible = compra.cantidad_restante || compra.cantidad;
    
    // Tomar el primer exchange del array
    const exchange = exchanges[0];

    // Desencriptar credenciales
    const decryptedApiKey = decrypt(exchange.api_key);
    const decryptedApiSecret = decrypt(exchange.api_secret);

    const credentials = {
      apiKey: decryptedApiKey,
      apiSecret: decryptedApiSecret,
    };

    console.log(`🔐 Credenciales obtenidas para usuario ${userId}`);

    // Obtener precio actual para cálculos
    const currentPrice = await binanceService.getPrice(symbol);
    console.log(`💰 Precio actual de ${symbol}: ${currentPrice}`);

    // Calcular cantidad real a vender
    let cantidadAVender, estimatedRevenue;

    if (
      quoteQuantity !== undefined &&
      quoteQuantity !== null &&
      quoteQuantity !== ""
    ) {
      // El usuario quiere obtener una cantidad fija de la moneda de cotización
      const quoteQty = parseFloat(quoteQuantity.toString());
      cantidadAVender = quoteQty / currentPrice;
      estimatedRevenue = quoteQty;
    } else {
      // Comportamiento original: quantity es la cantidad del activo base
      cantidadAVender = parseFloat(quantity.toString());
      estimatedRevenue = cantidadAVender * currentPrice;
    }

    // Verificar que no se intente vender más de lo disponible
    if (cantidadAVender > cantidadDisponible) {
      return res.status(400).json({
        success: false,
        error: `Cantidad insuficiente. Disponible: ${cantidadDisponible}, Intenta vender: ${cantidadAVender}`,
        disponible: cantidadDisponible,
        intentaVender: cantidadAVender,
      });
    }

    console.log(`📊 Cantidad a vender: ${cantidadAVender}`);
    console.log(`📊 Ingreso estimado: ${estimatedRevenue}`);

    // Verificar disponibilidad para vender (balance en Binance)
    const availability = await binanceService.checkSellAvailability(
      credentials,
      symbol,
      cantidadAVender,
      currentPrice
    );

    if (!availability.canSell) {
      return res.status(400).json({
        success: false,
        error: `Saldo insuficiente en Binance. Disponible: ${availability.availableBalance} ${availability.baseAsset} Razones: ${availability.reasons}`,
      });
    }

    // Construir parámetros de orden según el tipo
    const orderParams: any = {
      symbol,
      type: type || "MARKET",
    };

    const isMarketOrder = !type || type === "MARKET";
    const isLimitOrder = type === "LIMIT";

    // Para órdenes de mercado con quoteQuantity, usar quoteOrderQty
    if (
      isMarketOrder &&
      quoteQuantity !== undefined &&
      quoteQuantity !== null &&
      quoteQuantity !== ""
    ) {
      orderParams.quoteOrderQty = estimatedRevenue;
    } else {
      // Para órdenes límite o sin quoteQuantity, usar quantity normal
      orderParams.quantity = cantidadAVender;
    }

    if (isLimitOrder && price) {
      orderParams.price = price;
    }

    // Ejecutar orden de venta
    const result = await binanceService.placeSellOrder(credentials, orderParams);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Log de comisiones
    let comisionTotalVenta = 0;
    let comisionMonedaVenta = "";

    if (result.order.fills && result.order.fills.length > 0) {
      result.order.fills.forEach((fill, index) => {
        console.log(`   Transacción ${index + 1}:`);
        console.log(
          `     - Comisión: ${fill.commission} ${fill.commissionAsset}`
        );

        // Sumar comisiones si son en la moneda de cotización (USDC/USDT)
        if (
          fill.commissionAsset === "USDC" ||
          fill.commissionAsset === "USDT"
        ) {
          comisionTotalVenta += parseFloat(fill.commission);
          comisionMonedaVenta = fill.commissionAsset;
        } else {
          console.log(`La comisión no está en USDC/USDT`);
          // Guardamos la primera moneda de comisión no USDC
          if (!comisionMonedaVenta) {
            comisionMonedaVenta = fill.commissionAsset;
          }
        }
      });

      console.log(`   Total comisión en venta: ${comisionTotalVenta} ${comisionMonedaVenta}`);
    }

    // Calcular precio de venta real (promedio ponderado)
    let precioVentaReal = currentPrice;
    if (result.order.fills && result.order.fills.length > 0) {
      let totalCantidad = 0;
      let totalValor = 0;
      
      result.order.fills.forEach(fill => {
        const cantidad = parseFloat(fill.qty);
        const precio = parseFloat(fill.price);
        totalCantidad += cantidad;
        totalValor += cantidad * precio;
      });
      
      if (totalCantidad > 0) {
        precioVentaReal = totalValor / totalCantidad;
      }
    }

    // Guardar venta en base de datos y actualizar compra
    try {
      const totalVentaReal = result.order?.cummulativeQuoteQty
        ? parseFloat(result.order.cummulativeQuoteQty)
        : estimatedRevenue;

      // Calcular beneficio
      const totalCompra = compra.total || (compra.precio * cantidadAVender);
      const beneficio = totalVentaReal - totalCompra;
      const porcentajeBeneficio = (beneficio / totalCompra) * 100;

      // 1. Insertar registro en ventas
      const datosVenta = {
        idCompra: compraId,
        exchange: "Binance",
        // idOrdenVenta: result.order?.orderId.toString() || "",
        simbolo: symbol,
        precioVenta: precioVentaReal,
        cantidadVendida: cantidadAVender,
        // totalVenta: totalVentaReal,
        comisionVenta: comisionTotalVenta,
        comisionMoneda: comisionMonedaVenta,
        beneficio: beneficio,
        fechaVenta: result.order?.transactTime
          ? new Date(result.order.transactTime).toISOString()
          : new Date().toISOString(),
      };

      const { data: nuevaVenta, error: errorVenta } = await supabase
        .from("ventas")
        .insert([datosVenta])
        .select();

      if (errorVenta) {
        console.error("⚠️ Error guardando venta en BD:", errorVenta);
      } else {
        console.log("✅ Venta guardada en base de datos");
      }

      // 2. Actualizar la compra (marcar como vendida o reducir cantidad)
      const cantidadRestante = cantidadDisponible - cantidadAVender;
      const estaCompletamenteVendida = cantidadRestante <= 0.00001; // Tolerancia por decimales

      const updateData: any = {
        vendida: estaCompletamenteVendida,
      };

      // Si la cantidad restante es muy pequeña, establecer a 0 y marcar como vendida
      if (cantidadRestante < 0.00001) {
        updateData.cantidadRestante= 0
        updateData.vendida = true;
      }

      const { error: errorUpdateCompra } = await supabase
        .from("compras")
        .update(updateData)
        .eq("id", compraId);

      if (errorUpdateCompra) {
        console.error("⚠️ Error actualizando compra:", errorUpdateCompra);
      } else {
        console.log(`✅ Compra actualizada. Vendida: ${updateData.vendida}, Cantidad restante: ${updateData.cantidad_restante}`);
      }

    } catch (dbError) {
      console.error("⚠️ Error en guardado BD:", dbError);
    }

    res.json({
      success: true,
      message: "Orden de venta ejecutada exitosamente",
      order: result.order,
      localId: result.order?.orderId,
      compraActualizada: {
        compraId,
        vendida: cantidadAVender >= cantidadDisponible,
        cantidadRestante: cantidadDisponible - cantidadAVender,
      },
    });
  } catch (error) {
    console.error("Error en /user/:userId/sell:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error desconocido al realizar la venta",
    });
  }
});

/**
 * Ruta para verificar disponibilidad antes de vender
 */
binanceRouter.post("/check-sell", async (req, res) => {
  try {
    const { apiKey, apiSecret, symbol, quantity } = req.body;

    if (!apiKey || !apiSecret || !symbol || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Todos los parámetros son requeridos",
      });
    }

    const credentials = { apiKey, apiSecret };
    const result = await binanceService.checkSellAvailability(
      credentials,
      symbol,
      quantity
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error en /check-sell:", error);
    res.status(500).json({
      success: false,
      error: "Error verificando disponibilidad",
    });
  }
});

/**
 * Ruta para obtener información de un símbolo
 */
/**
 * Ruta PÚBLICA para obtener información de un símbolo (sin credenciales)
 */
binanceRouter.get("/symbol-info-public/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;

    console.log(`🔍 Obteniendo información pública para símbolo: ${symbol}`);

    // Hacemos una solicitud pública a la API de Binance
    const response = await fetch(
      `https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol.toUpperCase()}`
    );

    if (!response.ok) {
      throw new Error(`Error de Binance: ${response.status}`);
    }

    const data = await response.json() as ExchangeInfoResponse;
    const symbolInfo = data.symbols?.find(
      (s: any) => s.symbol === symbol.toUpperCase()
    );

    if (!symbolInfo) {
      return res.status(404).json({
        success: false,
        error: `Símbolo ${symbol} no encontrado`,
      });
    }

    // Extraer filtros importantes
    const filters = symbolInfo.filters.reduce((acc: any, filter: any) => {
      acc[filter.filterType] = filter;
      return acc;
    }, {});

    // Extraer valores específicos de los filtros
    const lotSizeFilter = filters.LOT_SIZE || {};
    const minNotionalFilter = filters.MIN_NOTIONAL || filters.NOTIONAL || {};

    const result = {
      symbol: symbolInfo.symbol,
      baseAsset: symbolInfo.baseAsset,
      quoteAsset: symbolInfo.quoteAsset,
      status: symbolInfo.status,
      minQty: lotSizeFilter.minQty ? parseFloat(lotSizeFilter.minQty) : 0,
      stepSize: lotSizeFilter.stepSize ? parseFloat(lotSizeFilter.stepSize) : 0,
      minNotional: minNotionalFilter.minNotional 
        ? parseFloat(minNotionalFilter.minNotional) 
        : 0,
    };

    console.log("✅ Información pública obtenida:", {
      symbol: result.symbol,
      stepSize: result.stepSize,
      minQty: result.minQty,
    });

    res.json({
      success: true,
      symbolInfo: result,
    });
  } catch (error: any) {
    console.error("❌ Error en /symbol-info-public:", error);
    res.status(500).json({
      success: false,
      error: "Error obteniendo información del símbolo",
      message: error.message,
    });
  }
});

export default binanceRouter;
