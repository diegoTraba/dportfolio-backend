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
      console.log('⚠️ El monitoreo ya está activo');
      return;
    }
  
    this.isMonitoring = true;
    console.log(`🚀 Iniciando monitoreo de precios cada ${intervalMs}ms`);
  
    this.intervalId = setInterval(async () => {
      try {
        console.log('\n=== 🔄 CICLO DE MONITOREO ===');
        console.log('⏰', new Date().toISOString());
        
        // Símbolos a monitorear (puedes hacer esto dinámico basado en las alertas de la BD)
        const symbolsToMonitor = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'SOLUSDT'];
        console.log('📊 Símbolos a monitorear:', symbolsToMonitor);
        
        const prices = await this.getMultiplePrices(symbolsToMonitor);
        
        console.log('💰 Precios obtenidos:', prices);
        
        // Llamar al callback con los precios actualizados
        callback(prices);
  
        // Aquí podrías añadir lógica para verificar alertas
        await this.checkAlerts(prices);
        
        console.log('✅ Ciclo de monitoreo completado\n');
      } catch (error) {
        console.error('💥 Error en el monitoreo de precios:', error);
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
      console.log('🔍 Iniciando verificación de alertas...');
      console.log('📊 Precios actuales:', prices);
      
      const supabase = getSupabaseClient();
      
      // Obtener todas las alertas pendientes
      const { data: alertas, error } = await supabase
        .from('alertas')
        .select('*')
        .eq('estado', 'pendiente');
  
      if (error) {
        console.error('❌ Error obteniendo alertas:', error);
        return;
      }
  
      console.log(`📋 Alertas pendientes encontradas: ${alertas?.length || 0}`);
  
      if (!alertas || alertas.length === 0) {
        console.log('ℹ️ No hay alertas pendientes para verificar');
        return;
      }
  
      // Verificar cada alerta
      for (const alerta of alertas) {
        console.log(`\n🔎 Procesando alerta ID: ${alerta.id}`);
        console.log(`   Cripto: ${alerta.criptomoneda}, Condición: ${alerta.condicion}, Objetivo: $${alerta.precio_objetivo}`);
        
        const symbol = `${alerta.criptomoneda}USDT`;
        const currentPrice = prices[symbol]?.price;
  
        console.log(`   Símbolo buscado: ${symbol}`);
        console.log(`   Precio actual: $${currentPrice}`);
  
        if (!currentPrice) {
          console.log(`   ⚠️ Precio no disponible para ${symbol}`);
          continue;
        }
  
        let conditionMet = false;
        
        if (alerta.condicion === 'por encima de' && currentPrice >= alerta.precio_objetivo) {
          conditionMet = true;
          console.log(`   ✅ CONDICIÓN CUMPLIDA: ${currentPrice} >= ${alerta.precio_objetivo}`);
        } else if (alerta.condicion === 'por debajo de' && currentPrice <= alerta.precio_objetivo) {
          conditionMet = true;
          console.log(`   ✅ CONDICIÓN CUMPLIDA: ${currentPrice} <= ${alerta.precio_objetivo}`);
        } else {
          console.log(`   ❌ Condición NO cumplida: ${currentPrice} ${alerta.condicion} ${alerta.precio_objetivo}`);
        }
  
        if (conditionMet) {
          console.log(`   🚀 Activando alerta ${alerta.id}...`);
          
          // Actualizar alerta como activa
          const { error: updateError } = await supabase
            .from('alertas')
            .update({ 
              estado: 'activo',
              activado_en: new Date().toISOString(),
              precio_actual: currentPrice
            })
            .eq('id', alerta.id);
  
          if (updateError) {
            console.error(`   💥 Error actualizando alerta ${alerta.id}:`, updateError);
          } else {
            console.log(`   ✅ Alerta ${alerta.id} activada correctamente!`);
            console.log(`   🎯 ${alerta.criptomoneda} alcanzó $${currentPrice} (objetivo: $${alerta.precio_objetivo})`);
          }
        }
      }
    } catch (error) {
      console.error('💥 Error verificando alertas:', error);
    }
  }
}

export const monitorService = new MonitorService();