import { binanceService } from "./servicioBinance.js";
import { getSupabaseClient } from "../lib/supabase.js";
import {webSocketService} from "./servicioWebSocket.js";

export interface DatosPrecio {
  simbolo: string;
  precio: number;
  fechaActualizacion: string;
}

export class ServicioMonitoreo  {
  private estaMonitoreando: boolean = false;
  private idIntervalo: NodeJS.Timeout | null = null;

  // Obtener precio de un símbolo específico
  async obtenerPrecioSimbolo(simbolo: string): Promise<DatosPrecio> {
    try {
      const precio = await binanceService.getPrice(simbolo.toUpperCase());
      return {
        simbolo: simbolo.toUpperCase(),
        precio,
        fechaActualizacion: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error obteniendo precio para ${simbolo}:`, error);
      throw error;
    }
  }

  // Obtener precios de múltiples símbolos
  async obtenerMultiplesPrecios(
    simbolos: string[]
  ): Promise<{ [key: string]: DatosPrecio }> {
    const precios: { [key: string]: DatosPrecio } = {};

    for (const simbolo of simbolos) {
      try {
        const datosPrecio = await this.obtenerPrecioSimbolo(simbolo);
        precios[simbolo] = datosPrecio;
      } catch (error) {
        console.error(`Error obteniendo precio para ${simbolo}:`, error);
        // Podrías devolver un valor por defecto o manejarlo de otra forma
        precios[simbolo] = {
          simbolo,
          precio: 0,
          fechaActualizacion: new Date().toISOString(),
        };
      }
    }

    return precios;
  }

  // Guardar o actualizar precios en la base de datos
  private async guardarPreciosEnBD(precios: { [key: string]: DatosPrecio }): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      const datosPrecio = Object.values(precios);

      console.log(`💾 Guardando ${datosPrecio.length} precios en la base de datos...`);

      for (const precioData of datosPrecio) {
        try {
          // Verificar si el símbolo ya existe en la base de datos
          const { data: precioExistente, error: errorConsulta } = await supabase
            .from("precioCriptomoneda")
            .select("id, simbolo")
            .eq("simbolo", precioData.simbolo)
            .maybeSingle();

          if (errorConsulta) {
            console.error(`❌ Error verificando símbolo ${precioData.simbolo}:`, errorConsulta);
            continue;
          }

          if (precioExistente) {
            // Actualizar precio existente
            const { error: errorActualizacion } = await supabase
              .from("precioCriptomoneda")
              .update({
                precio: precioData.precio,
                fechaActualizacion: precioData.fechaActualizacion
              })
              .eq("simbolo", precioData.simbolo);

            if (errorActualizacion) {
              console.error(`❌ Error actualizando ${precioData.simbolo}:`, errorActualizacion);
            } else {
              console.log(`✅ Actualizado: ${precioData.simbolo} = $${precioData.precio}`);
            }
          } else {
            // Insertar nuevo precio
            const { error: errorInsercion } = await supabase
              .from("precioCriptomoneda")
              .insert([{
                simbolo: precioData.simbolo,
                precio: precioData.precio,
                fechaActualizacion: precioData.fechaActualizacion
              }]);

            if (errorInsercion) {
              console.error(`❌ Error insertando ${precioData.simbolo}:`, errorInsercion);
            } else {
              console.log(`➕ Insertado: ${precioData.simbolo} = $${precioData.precio}`);
            }
          }
        } catch (error) {
          console.error(`💥 Error procesando ${precioData.simbolo}:`, error);
        }
      }

      console.log("📊 Precios guardados en base de datos exitosamente");
    } catch (error) {
      console.error("💥 Error general guardando precios en BD:", error);
    }
  }

  // Iniciar monitoreo periódico (cada 2 min)
  iniciarMonitoreoPrecios(
    callback: (precios: { [key: string]: DatosPrecio }) => void,
    intervalMs: number = 120000
  ) {
    if (this.estaMonitoreando) {
      console.log("⚠️ El monitoreo ya está activo");
      return;
    }

    this.estaMonitoreando = true;
    console.log(`🚀 Iniciando monitoreo de precios cada ${intervalMs}ms`);

    this.idIntervalo = setInterval(async () => {
      try {
        console.log("\n=== 🔄 CICLO DE MONITOREO ===");
        console.log("⏰", new Date().toISOString());

        // Símbolos a monitorear (puedes hacer esto dinámico basado en las alertas de la BD)
        const simbolosAMonitorear  = ["BTCUSDC", "ETHUSDC", "ADAUSDC", "SOLUSDC", "XRPUSDC","BNBUSDC","LINKUSDC"];
        console.log("📊 Símbolos a monitorear:", simbolosAMonitorear );

        const precios = await this.obtenerMultiplesPrecios(simbolosAMonitorear );

        console.log("💰 Precios obtenidos:", precios);

        // Guardar precios en la base de datos
        await this.guardarPreciosEnBD(precios);

        // Llamar al callback con los precios actualizados
        callback(precios);

        // Aquí podrías añadir lógica para verificar alertas
        await this.verificarAlertas(precios);

        console.log("✅ Ciclo de monitoreo completado\n");
      } catch (error) {
        console.error("💥 Error en el monitoreo de precios:", error);
      }
    }, intervalMs);
  }

  // Detener monitoreo
  detenerMonitoreoPrecios() {
    if (this.idIntervalo) {
      clearInterval(this.idIntervalo);
      this.idIntervalo = null;
      this.estaMonitoreando = false;
      console.log("Monitoreo de precios detenido");
    }
  }

  // Verificar alertas (esto es donde la magia ocurre)
  private async verificarAlertas(precios: { [key: string]: DatosPrecio }) {
    try {
      console.log("🔍 Iniciando verificación de alertas...");
      console.log("📊 Precios actuales:", precios);

      const supabase = getSupabaseClient();

      // Obtener todas las alertas pendientes
      const { data: alertas, error } = await supabase
        .from("alertas")
        .select("*")
        .eq("estado", "pendiente");

      if (error) {
        console.error("❌ Error obteniendo alertas:", error);
        return;
      }

      console.log(`📋 Alertas pendientes encontradas: ${alertas?.length || 0}`);

      if (!alertas || alertas.length === 0) {
        console.log("ℹ️ No hay alertas pendientes para verificar");
        return;
      }

      // Verificar cada alerta
      for (const alerta of alertas) {
        console.log(`\n🔎 Procesando alerta ID: ${alerta.id}`);
        console.log(
          `   Cripto: ${alerta.criptomoneda}, Condición: ${alerta.condicion}, Objetivo: $${alerta.precio_objetivo}`
        );

        const simbolo = `${alerta.criptomoneda}USDC`;
        const precioActual  = precios[simbolo]?.precio;

        console.log(`   Símbolo buscado: ${simbolo}`);
        console.log(`   Precio actual: $${precioActual }`);

        if (!precioActual ) {
          console.log(`   ⚠️ Precio no disponible para ${simbolo}`);
          continue;
        }

        let condicionCumplida  = false;

        if (
          alerta.condicion === "por encima de" &&
          precioActual  >= alerta.precio_objetivo
        ) {
          condicionCumplida = true;
          console.log(
            `   ✅ CONDICIÓN CUMPLIDA: ${precioActual } >= ${alerta.precio_objetivo}`
          );
        } else if (
          alerta.condicion === "por debajo de" &&
          precioActual  <= alerta.precio_objetivo
        ) {
          condicionCumplida = true;
          console.log(
            `   ✅ CONDICIÓN CUMPLIDA: ${precioActual } <= ${alerta.precio_objetivo}`
          );
        } else {
          console.log(
            `   ❌ Condición NO cumplida: ${precioActual } ${alerta.condicion} ${alerta.precio_objetivo}`
          );
        }

        if (condicionCumplida) {
          console.log(`   🚀 Activando alerta ${alerta.id}...`);

          // Actualizar alerta como activa
          const { error: updateError } = await supabase
            .from("alertas")
            .update({
              estado: "activo",
              activado: new Date().toISOString(),
              precio_actual: precioActual ,
              leido: false,
            })
            .eq("id", alerta.id);

          if (updateError) {
            console.error(
              `   💥 Error actualizando alerta ${alerta.id}:`,
              updateError
            );
          } else {
            console.log(`   ✅ Alerta ${alerta.id} activada correctamente!`);
            console.log(
              `   🎯 ${alerta.criptomoneda} alcanzó $${precioActual } (objetivo: $${alerta.precio_objetivo})`
            );
          }

          console.log("user_id: " + alerta.user_id);
          // Enviar notificación por WebSocket usando la instancia
          const notificacionEnviada = webSocketService.enviarNotificacion(alerta.user_id, {
            id: alerta.id,
            criptomoneda: alerta.criptomoneda,
            precio_objetivo: alerta.precio_objetivo,
            precio_actual: precioActual ,
            condicion: alerta.condicion,
          });

          if (notificacionEnviada) {
            console.log(`   📤 Notificación enviada al usuario ${alerta.user_id}`);
          } else {
            console.log(`   ⚠️ Usuario ${alerta.user_id} no está conectado, notificación en cola`);
            // Aquí podrías guardar la notificación en BD para enviarla cuando se conecte
          }
        }
      }
    } catch (error) {
      console.error("💥 Error verificando alertas:", error);
    }
  }
}

export const monitorService = new ServicioMonitoreo();
