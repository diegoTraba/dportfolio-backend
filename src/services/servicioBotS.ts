import { EMA, RSI, MACD } from "technicalindicators";
import { getSupabaseClient } from "../lib/supabase.js";
import { BinanceCredentials } from "../interfaces/binance.types";
import { SimboloConfig, BotConfig } from "../interfaces/bot.types.js";
import { binanceService } from "./servicioBinance.js";

// Lista fija de símbolos a consultar
export const SUPPORTED_SYMBOLS = [
  "BTCUSDC",
  "ETHUSDC",
  "SOLUSDC",
  "ADAUSDC",
  "XRPUSDC",
  "BNBUSDC",
  "AVAXUSDC",
  "LINKUSDC",
  "DOGEUSDC",
  "PEPEUSDC",
];

type IntervalSignal = {
  interval: string;
  lastClose: number;
  indicators: {
    ema7: number[];
    ema21: number[];
    rsi: number[];
    macd: { macd: number[]; signal: number[]; histogram: number[] };
  };
  signals: { action: "BUY" | "SELL" | "NONE"; confidence: number };
};

// Tipo para los resultados de ejecución de órdenes
type TradeExecutionResult = {
  symbol: string;
  side: "BUY" | "SELL";
  success: boolean;
  order?: any;
  error?: string;
  skipped?: boolean;
  reason?: string;
  dbSaved?: boolean;
  confidence: number;
};

// Type guard para señales de trading (excluye "NONE")
function isTradeSignal(signal: {
  action: "BUY" | "SELL" | "NONE";
  confidence: number;
}): signal is { action: "BUY" | "SELL"; confidence: number } {
  return signal.action !== "NONE";
}

// =============================================================================
// CLASE PRINCIPAL DEL SERVICIO
// =============================================================================

class ServicioBot {
  private lastTradeTime: Map<string, number> = new Map();

  /**
   * Ejecuta órdenes de compra/venta basadas en las señales combinadas.
   * @param credentials Credenciales de Binance
   * @param userId ID del usuario en la base de datos
   * @param tradeAmountUSD Cantidad en USD (quote) a invertir en cada compra (por defecto 10)
   * @param intervals Intervalos a considerar para las señales
   * @param simbolos Lista de símbolos a evaluar
   * @param limit Número de velas por intervalo
   * @param cooldownMinutes Minutos de espera entre operaciones del mismo símbolo
   * @param maxInversion Máximo total invertido permitido (suma de compras activas)
   */
  async executeTrades(
    credentials: BinanceCredentials,
    userId: string,
    tradeAmountUSD: number = 10,
    intervals: string[] = ["3m", "5m"],
    simbolosConfig: SimboloConfig[] = SUPPORTED_SYMBOLS.map((s) => ({
      symbol: s,
    })),
    limit: number = 50,
    cooldownMinutes: number = 3,
    maxInversion: number = 10
  ): Promise<{ executed: TradeExecutionResult[] }> {
    const results: TradeExecutionResult[] = [];
    const cooldownMs = cooldownMinutes * 60 * 1000;

    try {
      // Crear un mapa para acceso rápido a la configuración por símbolo
      const configMap = new Map(
        simbolosConfig.map((item) => [item.symbol, item])
      );
      // Extraer solo los símbolos para la consulta de señales
      const symbolsList = simbolosConfig.map((item) => item.symbol);
      // Obtener señales combinadas para todos los símbolos
      const allSignals = await binanceService.getAllTechnicalSignalsMulti(
        intervals,
        limit,
        symbolsList
      );

      // Procesar cada señal
      for (const signal of allSignals) {
        const { symbol, combinedSignal } = signal;

        // Obtener configuración específica del símbolo
        const config = configMap.get(symbol);
        if (!config) continue; // Seguridad, no debería ocurrir

        // 1. Type guard para asegurar que sea BUY/SELL y además confianza suficiente
        if (!isTradeSignal(combinedSignal) || combinedSignal.confidence < 0.5) {
          continue; // Ignorar señales no comerciales o de baja confianza
        }

        // 2. Verificar cooldown
        if (this.isCooldownActive(symbol, cooldownMs)) {
          const minsLeft = this.getCooldownMinutesLeft(symbol, cooldownMs);
          console.log(
            `⏳ Cooldown para ${symbol} (${minsLeft} min restantes). Omitiendo.`
          );
          results.push(
            this.buildSkippedResult(
              symbol,
              combinedSignal,
              `Cooldown activo (espera ${minsLeft} min)`
            )
          );
          continue;
        }

        // 3. Procesar según el tipo de señal
        if (combinedSignal.action === "BUY") {
          // TypeScript estrecha combinedSignal a { action: "BUY"; confidence: number }
          const buyResult = await this.processBuySignal(
            credentials,
            userId,
            symbol,
            combinedSignal,
            tradeAmountUSD,
            maxInversion,
            config.lowerLimit, // ← Límite inferior
            config.upperLimit // ← Límite superior
          );
          results.push(buyResult);
        } else {
          // combinedSignal.action === "SELL"
          const sellResults = await this.processSellSignal(
            credentials,
            userId,
            symbol,
            combinedSignal
          );
          results.push(...sellResults);
        }
      }
    } catch (error) {
      console.error("Error crítico en executeTrades:", error);
      throw error;
    }

    return { executed: results };
  }

  // ----------------------------------------------------------------------
  // Métodos auxiliares privados
  // ----------------------------------------------------------------------

  /**
   * Verifica si el cooldown para un símbolo está activo.
   */
  private isCooldownActive(symbol: string, cooldownMs: number): boolean {
    const lastTrade = this.lastTradeTime.get(symbol);
    return !!(lastTrade && Date.now() - lastTrade < cooldownMs);
  }

  /**
   * Calcula los minutos restantes de cooldown para un símbolo.
   */
  private getCooldownMinutesLeft(symbol: string, cooldownMs: number): string {
    const lastTrade = this.lastTradeTime.get(symbol);
    if (!lastTrade) return "0";
    const minsLeft = (cooldownMs - (Date.now() - lastTrade)) / 60000;
    return minsLeft.toFixed(1);
  }

  private checkPriceWithinLimits(
    symbol: string,
    currentPrice: number,
    lowerLimit?: number | null,
    upperLimit?: number | null
  ): { within: boolean; message?: string } {
    if (lowerLimit != null && currentPrice < lowerLimit) {
      return {
        within: false,
        message: `Precio ${currentPrice} por debajo del límite inferior ${lowerLimit}`,
      };
    }
    if (upperLimit != null && currentPrice > upperLimit) {
      return {
        within: false,
        message: `Precio ${currentPrice} por encima del límite superior ${upperLimit}`,
      };
    }
    return { within: true };
  }

  /**
   * Construye un resultado para una operación omitida (skipped).
   */
  private buildSkippedResult(
    symbol: string,
    signal: { action: "BUY" | "SELL"; confidence: number },
    reason: string
  ): TradeExecutionResult {
    return {
      symbol,
      side: signal.action,
      success: false,
      skipped: true,
      reason,
      confidence: signal.confidence,
    };
  }

  /**
   * Procesa una señal de compra.
   */
  private async processBuySignal(
    credentials: BinanceCredentials,
    userId: string,
    symbol: string,
    signal: { action: "BUY" | "SELL"; confidence: number },
    tradeAmountUSD: number,
    maxInversion: number,
    lowerLimit?: number | null,
    upperLimit?: number | null
  ): Promise<TradeExecutionResult> {
    console.log(
      `🔔 Señal de COMPRA para ${symbol} con confianza ${signal.confidence}. Verificando disponibilidad...`
    );

    try {
      // Obtener precio actual e información del símbolo (filtros, minNotional, etc.)
      const currentPrice = await binanceService.getPrice(symbol);

      // Validar límites
      const priceCheck = this.checkPriceWithinLimits(
        symbol,
        currentPrice,
        lowerLimit,
        upperLimit
      );
      if (!priceCheck.within) {
        console.log(`⏭️ ${symbol}: ${priceCheck.message}`);
        return this.buildSkippedResult(symbol, signal, priceCheck.message!);
      }

      const symbolInfo = await binanceService.getSymbolInfo(
        credentials,
        symbol
      );
      const minNotional = symbolInfo.minNotional || 5; // valor por defecto si no viene

      // Ajustar el monto de compra si es menor que minNotional
      let montoCompra = tradeAmountUSD;
      if (montoCompra < minNotional) {
        console.log(
          `⚠️ tradeAmountUSD (${montoCompra}) es menor que minNotional (${minNotional}) para ${symbol}. Usando ${minNotional}`
        );
        montoCompra = minNotional;
      }

      // Verificar límite de inversión total (compras activas del usuario)
      if (maxInversion) {
        const limiteExcedido = await this.isMaxInvestmentExceeded(
          userId,
          montoCompra,
          maxInversion
        );
        if (limiteExcedido.excedido) {
          console.log(
            `⏭️ Límite de inversión alcanzado. Total: ${limiteExcedido.totalInvertido}, Máx: ${maxInversion}, Intento: ${montoCompra}`
          );
          return this.buildSkippedResult(
            symbol,
            signal,
            "Límite de inversión alcanzado"
          );
        }
      }

      // Verificar si ya existe una compra activa en un rango de ±0.4% del precio actual
      const existeCompraCercana = await this.existsActiveBuyInRange(
        userId,
        symbol,
        currentPrice
      );
      if (existeCompraCercana) {
        console.log(
          `⏭️ Ya existe una compra activa de ${symbol} en el rango de ±0.4% del precio actual. Omitiendo.`
        );
        return this.buildSkippedResult(
          symbol,
          signal,
          "Compra existente en rango de precio cercano"
        );
      }

      // Calcular cantidad base a comprar
      const quantityBase = montoCompra / currentPrice;

      // Verificar disponibilidad de fondos (saldo de la moneda quote)
      const availability = await binanceService.checkBuyAvailability(
        credentials,
        symbol,
        quantityBase,
        currentPrice
      );
      if (!availability.canBuy) {
        console.log(
          `❌ No se puede comprar ${symbol}: saldo insuficiente de ${availability.quoteAsset}`
        );
        return {
          symbol,
          side: "BUY",
          success: false,
          error: `Saldo insuficiente de ${availability.quoteAsset}`,
          confidence: signal.confidence,
        };
      }

      // Ejecutar orden de compra MARKET
      console.log(
        `✅ Disponibilidad OK. Ejecutando orden de compra para ${symbol}...`
      );
      const buyResult = await binanceService.placeBuyOrder(credentials, {
        symbol,
        quoteOrderQty: montoCompra,
        type: "MARKET",
      });

      if (!buyResult.success) {
        console.error(`❌ Error en compra de ${symbol}:`, buyResult.error);
        return {
          symbol,
          side: "BUY",
          success: false,
          error: buyResult.error,
          confidence: signal.confidence,
        };
      }

      console.log(`✅ Orden de compra ejecutada para ${symbol}`);
      this.lastTradeTime.set(symbol, Date.now());

      // Guardar la compra en la base de datos
      const dbSaved = await this.saveBuyToDatabase(
        userId,
        symbol,
        currentPrice,
        quantityBase,
        buyResult.order
      );

      return {
        symbol,
        side: "BUY",
        success: true,
        order: buyResult.order,
        dbSaved,
        confidence: signal.confidence,
      };
    } catch (error) {
      console.error(
        `Error inesperado en processBuySignal para ${symbol}:`,
        error
      );
      return {
        symbol,
        side: "BUY",
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
        confidence: signal.confidence,
      };
    }
  }

  /**
   * Verifica si el usuario ha alcanzado el límite máximo de inversión.
   * Retorna un objeto con indicador y el total invertido actual.
   */
  private async isMaxInvestmentExceeded(
    userId: string,
    montoCompra: number,
    maxInversion: number
  ): Promise<{ excedido: boolean; totalInvertido: number }> {
    const supabase = getSupabaseClient();
    const { data: comprasActivas, error: errorTotal } = await supabase
      .from("compras")
      .select("total")
      .eq("idUsuario", userId)
      .eq("botS", true)
      .eq("vendida", false);

    if (errorTotal) {
      console.error("⚠️ Error al calcular total invertido:", errorTotal);
      // En caso de error, asumimos que no se puede comprar por seguridad
      return { excedido: true, totalInvertido: 0 };
    }

    const totalInvertido = comprasActivas.reduce(
      (sum, c) => sum + (c.total || 0),
      0
    );
    const excedido = totalInvertido + montoCompra > maxInversion;
    return { excedido, totalInvertido };
  }

  /**
   * Verifica si existe una compra activa (no vendida) del mismo símbolo
   * cuyo precio esté dentro del ±0.4% del precio actual.
   */
  private async existsActiveBuyInRange(
    userId: string,
    symbol: string,
    currentPrice: number
  ): Promise<boolean> {
    const rangoInferior = currentPrice * 0.996;
    const rangoSuperior = currentPrice * 1.004;

    const supabase = getSupabaseClient();
    const { data: compraExistente, error: errorExistente } = await supabase
      .from("compras")
      .select("id")
      .eq("simbolo", symbol)
      .eq("idUsuario", userId)
      .eq("botS", true)
      .eq("vendida", false)
      .gte("precio", rangoInferior)
      .lte("precio", rangoSuperior)
      .limit(1);

    if (errorExistente) {
      console.error("⚠️ Error verificando compras existentes:", errorExistente);
      // Por seguridad, si hay error, asumimos que existe para no duplicar
      return true;
    }

    return compraExistente && compraExistente.length > 0;
  }

  /**
   * Guarda una compra en la base de datos y retorna si fue exitoso.
   */
  private async saveBuyToDatabase(
    userId: string,
    symbol: string,
    currentPrice: number,
    quantityBase: number,
    order: any
  ): Promise<boolean> {
    try {
      const supabase = getSupabaseClient();

      // Calcular comisión total en USDC (o USDT) a partir de los fills
      let comisionTotalUSDC = 0;
      if (order.fills && order.fills.length > 0) {
        order.fills.forEach((fill: any) => {
          if (
            fill.commissionAsset === "USDC" ||
            fill.commissionAsset === "USDT"
          ) {
            comisionTotalUSDC += parseFloat(fill.commission);
          }
        });
      }

      const datosCompra = {
        exchange: "Binance",
        idOrden: order?.orderId?.toString() || "",
        simbolo: symbol,
        precio: order?.fills?.[0]?.price
          ? parseFloat(order.fills[0].price)
          : currentPrice,
        cantidad: quantityBase,
        total: order?.cummulativeQuoteQty
          ? parseFloat(order.cummulativeQuoteQty)
          : null,
        comision: comisionTotalUSDC,
        comisionMoneda: "USDC",
        fechaCompra: order?.transactTime
          ? new Date(order.transactTime).toISOString()
          : new Date().toISOString(),
        vendida: false,
        idUsuario: userId,
        botS: true,
      };

      const { error: errorInsercion } = await supabase
        .from("compras")
        .insert([datosCompra]);
      if (errorInsercion) {
        console.error("⚠️ Error guardando compra en BD:", errorInsercion);
        return false;
      }
      console.log("✅ Compra guardada en base de datos local");
      return true;
    } catch (dbError) {
      console.error("⚠️ Error en guardado BD:", dbError);
      return false;
    }
  }

  /**
   * Procesa una señal de venta.
   * Puede generar múltiples operaciones si hay varias compras elegibles.
   */
  private async processSellSignal(
    credentials: BinanceCredentials,
    userId: string,
    symbol: string,
    signal: { action: "BUY" | "SELL"; confidence: number }
  ): Promise<TradeExecutionResult[]> {
    console.log(
      `🔔 Señal de VENTA para ${symbol} con confianza ${signal.confidence}. Verificando disponibilidad...`
    );

    const results: TradeExecutionResult[] = [];

    try {
      // Obtener precio actual e información del símbolo
      const currentPrice = await binanceService.getPrice(symbol);
      const symbolInfo = await binanceService.getSymbolInfo(
        credentials,
        symbol
      );
      const minNotional = symbolInfo.minNotional || 0;
      const stepSize = symbolInfo.stepSize || 1;
      const minQty = symbolInfo.minQty || 0;

      // Umbral de precio: solo se consideran compras con precio < 0.995 * currentPrice (0.5% por debajo)
      const umbral = currentPrice * 0.995;

      // Obtener balance disponible del activo base
      const availability = await binanceService.checkSellAvailability(
        credentials,
        symbol,
        1,
        undefined
      );
      let balanceDisponible = availability.availableBalance;
      if (balanceDisponible <= 0) {
        console.log(
          `⚠️ No hay balance de ${availability.baseAsset} para vender.`
        );
        results.push({
          symbol,
          side: "SELL",
          success: false,
          error: `Balance insuficiente de ${availability.baseAsset}`,
          confidence: signal.confidence,
        });
        return results;
      }

      // Buscar en BD todas las compras no vendidas de este símbolo con botS=true y precio < umbral
      const supabase = getSupabaseClient();
      const { data: compras, error: errorBusqueda } = await supabase
        .from("compras")
        .select("*")
        .eq("simbolo", symbol)
        .eq("idUsuario", userId)
        .eq("vendida", false)
        .eq("botS", true)
        .lt("precio", umbral)
        .order("fechaCompra", { ascending: true });

      if (errorBusqueda || !compras || compras.length === 0) {
        console.log(
          `⚠️ No hay compras de ${symbol} con precio un 0.5% por debajo del actual (${currentPrice}). No se vende.`
        );
        results.push({
          symbol,
          side: "SELL",
          success: false,
          error: "No hay compras rentables para vender",
          confidence: signal.confidence,
        });
        return results;
      }

      console.log(
        `📦 Se encontraron ${compras.length} compra(s) que cumplen la condición.`
      );

      // Verificar que el balance total sea suficiente para la suma de todas las cantidades
      const cantidadTotalAVender = compras.reduce(
        (sum, c) => sum + c.cantidad,
        0
      );
      if (balanceDisponible < cantidadTotalAVender) {
        console.log(
          `❌ Balance insuficiente para vender todas las compras elegibles. Disponible: ${balanceDisponible}, necesario: ${cantidadTotalAVender}.`
        );
        results.push({
          symbol,
          side: "SELL",
          success: false,
          error: "Balance insuficiente para vender todas las compras elegibles",
          confidence: signal.confidence,
        });
        return results;
      }

      // Procesar cada compra elegible
      for (const compra of compras) {
        const sellResultForCompra = await this.sellSinglePurchase(
          credentials,
          userId,
          symbol,
          compra,
          currentPrice,
          symbolInfo,
          balanceDisponible // pasamos por referencia para descontar
        );
        results.push(sellResultForCompra);

        // Si la venta fue exitosa, actualizamos el balance disponible para las siguientes
        if (sellResultForCompra.success) {
          balanceDisponible -= compra.cantidad; // descontamos la cantidad vendida
        } else {
          // Si una venta falla, podríamos detenernos (depende de la lógica de negocio)
          // Aquí optamos por continuar con las siguientes, pero podríamos romper el bucle.
          console.log(
            `⚠️ La venta de la compra ${compra.id} falló. Se continúa con las siguientes.`
          );
        }
      }
    } catch (error) {
      console.error(
        `Error inesperado en processSellSignal para ${symbol}:`,
        error
      );
      results.push({
        symbol,
        side: "SELL",
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
        confidence: signal.confidence,
      });
    }

    return results;
  }

  /**
   * Vende una compra específica, realizando todas las validaciones y guardando en BD.
   */
  private async sellSinglePurchase(
    credentials: BinanceCredentials,
    userId: string,
    symbol: string,
    compra: any,
    currentPrice: number,
    symbolInfo: any,
    balanceDisponible: number // ya no se usa directamente, pero se mantiene por si acaso
  ): Promise<TradeExecutionResult> {
    const stepSize = symbolInfo.stepSize || 1;
    const minQty = symbolInfo.minQty || 0;
    const minNotional = symbolInfo.minNotional || 0;
    const precision = stepSize.toString().split(".")[1]?.length || 0;

    // 1. Redondear cantidad a vender según el stepSize del símbolo
    let cantidadAVender = Math.floor(compra.cantidad / stepSize) * stepSize;
    cantidadAVender = parseFloat(cantidadAVender.toFixed(precision));

    // 2. Validar cantidad mínima permitida
    if (cantidadAVender < minQty) {
      console.log(
        `⚠️ Cantidad redondeada ${cantidadAVender} < minQty (${minQty}) para ${symbol}. Omitiendo compra ${compra.id}.`
      );
      return {
        symbol,
        side: "SELL",
        success: false,
        skipped: true,
        reason: `Cantidad redondeada insuficiente (${cantidadAVender} < ${minQty})`,
        confidence: 0,
      };
    }

    // 3. Validar valor mínimo de venta (minNotional)
    let valorVenta = cantidadAVender * currentPrice;
    if (valorVenta < minNotional) {
      console.log(
        `⚠️ Valor de venta ${valorVenta.toFixed(
          2
        )} es menor que minNotional (${minNotional}) para ${symbol}. Omitiendo compra ${
          compra.id
        }.`
      );
      return {
        symbol,
        side: "SELL",
        success: false,
        skipped: true,
        reason: `Valor de venta (${valorVenta.toFixed(
          2
        )}) menor que mínimo (${minNotional})`,
        confidence: 0,
      };
    }

    // 4. Verificar que el precio actual sea al menos 0.5% superior al precio de compra
    const minAcceptablePrice = compra.precio * 1.005; // 0.5% más
    if (currentPrice < minAcceptablePrice) {
      console.log(
        `⚠️ Precio actual ${currentPrice} es inferior al mínimo aceptable (${minAcceptablePrice}) para compra ${compra.id} (precio compra: ${compra.precio}). Venta cancelada.`
      );
      return {
        symbol,
        side: "SELL",
        success: false,
        skipped: true,
        reason: `Precio insuficiente (actual ${currentPrice} < ${minAcceptablePrice})`,
        confidence: 0,
      };
    }

    // 5. Ejecutar orden de venta MARKET
    console.log(
      `✅ Vendiendo ${cantidadAVender} de ${symbol} correspondiente a compra ${compra.id}...`
    );
    const sellResult = await binanceService.placeSellOrder(credentials, {
      symbol,
      quantity: cantidadAVender,
      type: "MARKET",
    });

    if (!sellResult.success) {
      console.error(
        `❌ Error en venta de compra ${compra.id}:`,
        sellResult.error
      );
      return {
        symbol,
        side: "SELL",
        success: false,
        error: sellResult.error,
        confidence: 0,
      };
    }

    console.log(`✅ Orden de venta ejecutada para compra ${compra.id}`);
    this.lastTradeTime.set(symbol, Date.now());

    // 6. Guardar la venta en BD y marcar la compra como vendida
    const dbSaved = await this.saveSellToDatabase(
      userId,
      compra,
      cantidadAVender,
      sellResult.order
    );

    return {
      symbol,
      side: "SELL",
      success: true,
      order: sellResult.order,
      dbSaved,
      confidence: 0,
    };
  }

  /**
   * Guarda una venta en la base de datos, calcula beneficio y actualiza la compra.
   */
  private async saveSellToDatabase(
    userId: string,
    compra: any,
    cantidadVendida: number,
    order: any
  ): Promise<boolean> {
    try {
      const supabase = getSupabaseClient();

      // Calcular comisiones y precio promedio de venta a partir de los fills
      let comisionTotalVenta = 0;
      let comisionMonedaVenta = "";
      let precioVentaReal = 0;

      if (order.fills && order.fills.length > 0) {
        let totalCantidad = 0;
        let totalValor = 0;
        order.fills.forEach((fill: any) => {
          const cantidad = parseFloat(fill.qty);
          const precio = parseFloat(fill.price);
          totalCantidad += cantidad;
          totalValor += cantidad * precio;

          if (
            fill.commissionAsset === "USDC" ||
            fill.commissionAsset === "USDT"
          ) {
            comisionTotalVenta += parseFloat(fill.commission);
            comisionMonedaVenta = fill.commissionAsset;
          } else if (!comisionMonedaVenta) {
            comisionMonedaVenta = fill.commissionAsset;
          }
        });
        precioVentaReal = totalValor / totalCantidad;
      }

      const totalVentaReal = order?.cummulativeQuoteQty
        ? parseFloat(order.cummulativeQuoteQty)
        : cantidadVendida * precioVentaReal;

      // Calcular beneficio
      const totalCompra = compra.precio * cantidadVendida;
      const beneficio = totalVentaReal - totalCompra;
      const porcentajeBeneficio = (beneficio / totalCompra) * 100;

      // Insertar en tabla ventas
      const datosVenta = {
        idCompra: compra.id,
        exchange: "Binance",
        simbolo: compra.simbolo,
        precioVenta: precioVentaReal,
        cantidadVendida: cantidadVendida,
        comisionVenta: comisionTotalVenta,
        comisionMoneda: comisionMonedaVenta,
        beneficio: beneficio,
        porcentajeBeneficio: porcentajeBeneficio,
        idUsuario: userId,
        fechaVenta: order?.transactTime
          ? new Date(order.transactTime).toISOString()
          : new Date().toISOString(),
        botS: true,
      };

      const { error: errorVenta } = await supabase
        .from("ventas")
        .insert([datosVenta]);
      if (errorVenta) {
        console.error("⚠️ Error guardando venta en BD:", errorVenta);
        return false;
      }
      console.log("✅ Venta guardada en base de datos");

      // Marcar la compra como vendida
      const { error: errorUpdateCompra } = await supabase
        .from("compras")
        .update({ vendida: true })
        .eq("id", compra.id);

      if (errorUpdateCompra) {
        console.error("⚠️ Error actualizando compra:", errorUpdateCompra);
        // No retornamos false porque la venta ya se guardó, pero la compra queda inconsistente
      } else {
        console.log("✅ Compra marcada como vendida");
      }

      return true;
    } catch (dbError) {
      console.error("⚠️ Error en guardado BD:", dbError);
      return false;
    }
  }
}

export const servicioBot = new ServicioBot();
