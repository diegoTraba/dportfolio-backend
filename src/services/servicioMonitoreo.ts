import { binanceService } from "./servicioBinance.js";
import { getSupabaseClient } from "../lib/supabase.js";

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: string;
}

export class MonitorService {
  private isMonitoring: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  // Obtener precio de un símbolo específico
  async getSymbolPrice(symbol: string): Promise<PriceData> {
    try {
      const price = await binanceService.getPrice(symbol.toUpperCase());
      return {
        symbol: symbol.toUpperCase(),
        price,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error obteniendo precio para ${symbol}:`, error);
      throw error;
    }
  }

  // Obtener precios de múltiples símbolos
  async getMultiplePrices(symbols: string[]): Promise<{ [key: string]: PriceData }> {
    const prices: { [key: string]: PriceData } = {};

    for (const symbol of symbols) {
      try {
        const priceData = await this.getSymbolPrice(symbol);
        prices[symbol] = priceData;
      } catch (error) {
        console.error(`Error obteniendo precio para ${symbol}:`, error);
        // Podrías devolver un valor por defecto o manejarlo de otra forma
        prices[symbol] = {
          symbol,
          price: 0,
          timestamp: new Date().toISOString()
        };
      }
    }

    return prices;
  }

  // Iniciar monitoreo periódico (cada segundo)
  startPriceMonitoring(callback: (prices: { [key: string]: PriceData }) => void, intervalMs: number = 60000) {
    if (this.isMonitoring) {
      console.log('El monitoreo ya está activo');
      return;
    }

    this.isMonitoring = true;
    console.log(`Iniciando monitoreo de precios cada ${intervalMs}ms`);

    this.intervalId = setInterval(async () => {
      try {
        // Símbolos a monitorear (puedes hacer esto dinámico basado en las alertas de la BD)
        const symbolsToMonitor = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT'];
        const prices = await this.getMultiplePrices(symbolsToMonitor);
        
        // Llamar al callback con los precios actualizados
        callback(prices);

        // Aquí podrías añadir lógica para verificar alertas
        await this.checkAlerts(prices);
        
      } catch (error) {
        console.error('Error en el monitoreo de precios:', error);
      }
    }, intervalMs);
  }

  // Detener monitoreo
  stopPriceMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isMonitoring = false;
      console.log('Monitoreo de precios detenido');
    }
  }

  // Verificar alertas (esto es donde la magia ocurre)
  private async checkAlerts(prices: { [key: string]: PriceData }) {
    try {
      const supabase = getSupabaseClient();
      
      // Obtener todas las alertas pendientes
      const { data: alertas, error } = await supabase
        .from('alertas') // Asumiendo que tu tabla se llama 'alertas'
        .select('*')
        .eq('estado', 'pendiente');

      if (error) {
        console.error('Error obteniendo alertas:', error);
        return;
      }

      if (!alertas || alertas.length === 0) {
        return;
      }

      // Verificar cada alerta
      for (const alerta of alertas) {
        const symbol = `${alerta.criptomoneda}USDT`;
        const currentPrice = prices[symbol]?.price;

        if (!currentPrice) continue;

        let conditionMet = false;
        
        if (alerta.condicion === 'por encima de' && currentPrice >= alerta.precio_objetivo) {
          conditionMet = true;
        } else if (alerta.condicion === 'por debajo de' && currentPrice <= alerta.precio_objetivo) {
          conditionMet = true;
        }

        if (conditionMet) {
          // Actualizar alerta como activa
          const { error: updateError } = await supabase
            .from('alertas')
            .update({ 
              estado: 'activo',
              activado_en: new Date().toISOString(),
              precio_actual: currentPrice
            })
            .eq('id', alerta.id);

          if (!updateError) {
            console.log(`Alerta ${alerta.id} activada! ${alerta.criptomoneda} alcanzó ${currentPrice}`);
            // Aquí podrías añadir notificaciones push, emails, etc.
          } else{
            console.log(`Alerta ${alerta.id} no activada! ${alerta.criptomoneda} alcanzó ${currentPrice}`);
          }
        }
      }
    } catch (error) {
      console.error('Error verificando alertas:', error);
    }
  }
}

export const monitorService = new MonitorService();