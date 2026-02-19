import { binanceService } from "./servicioBinance.js";
import { getSupabaseClient } from "../lib/supabase.js";
import { webSocketService } from "./servicioWebSocket.js";
import { decrypt } from "../lib/encriptacion.js";
import { servicioUsuario } from "./servicioUsuario.js";
import { BinanceCredentials } from "../interfaces/binance.types.js";
import { randomUUID } from 'crypto';

export interface DatosPrecio {
  simbolo: string;
  precio: number;
  fechaActualizacion: string;
}

interface BotConfig {
  tradeAmountUSD: number;
  intervals: string[];
  simbolos: string[];   // <-- Nuevo campo
  limit: number;
  cooldownMinutes: number;
}

export interface CompraUsuario {
  id: number;
  user_id: string;
  criptomoneda: string;
  cantidad: number;
  precio_compra: number;
  fecha_compra: string;
  // Puedes añadir más campos según tu esquema
}


export class ServicioMonitoreo {
  private estaMonitoreando: boolean = false;
  private idIntervalo: NodeJS.Timeout | null = null;
  private monitoreosComprasActivos: Map<string, NodeJS.Timeout> = new Map();
  private usuariosBotActivos: Map<string, BotConfig> = new Map();

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
  private async guardarPreciosEnBD(precios: {
    [key: string]: DatosPrecio;
  }): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      const datosPrecio = Object.values(precios);

      console.log(
        `💾 Guardando ${datosPrecio.length} precios en la base de datos...`
      );

      for (const precioData of datosPrecio) {
        try {
          // Verificar si el símbolo ya existe en la base de datos
          const { data: precioExistente, error: errorConsulta } = await supabase
            .from("precioCriptomoneda")
            .select("id, simbolo")
            .eq("simbolo", precioData.simbolo)
            .maybeSingle();

          if (errorConsulta) {
            console.error(
              `❌ Error verificando símbolo ${precioData.simbolo}:`,
              errorConsulta
            );
            continue;
          }

          if (precioExistente) {
            // Actualizar precio existente
            const { error: errorActualizacion } = await supabase
              .from("precioCriptomoneda")
              .update({
                precio: precioData.precio,
                fechaActualizacion: precioData.fechaActualizacion,
              })
              .eq("simbolo", precioData.simbolo);

            if (errorActualizacion) {
              console.error(
                `❌ Error actualizando ${precioData.simbolo}:`,
                errorActualizacion
              );
            } else {
              console.log(
                `✅ Actualizado: ${precioData.simbolo} = $${precioData.precio}`
              );
            }
          } else {
            // Insertar nuevo precio
            const { error: errorInsercion } = await supabase
              .from("precioCriptomoneda")
              .insert([
                {
                  simbolo: precioData.simbolo,
                  precio: precioData.precio,
                  fechaActualizacion: precioData.fechaActualizacion,
                },
              ]);

            if (errorInsercion) {
              console.error(
                `❌ Error insertando ${precioData.simbolo}:`,
                errorInsercion
              );
            } else {
              console.log(
                `➕ Insertado: ${precioData.simbolo} = $${precioData.precio}`
              );
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
    intervalMs: number = 60000
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
        const simbolosAMonitorear = [
          "BTCUSDC",
          "ETHUSDC",
          "ADAUSDC",
          "SOLUSDC",
          "XRPUSDC",
          "BNBUSDC",
          "LINKUSDC",
        ];
        console.log("📊 Símbolos a monitorear:", simbolosAMonitorear);

        const precios = await this.obtenerMultiplesPrecios(simbolosAMonitorear);

        // console.log("💰 Precios obtenidos:", precios);

        // Guardar precios en la base de datos
        await this.guardarPreciosEnBD(precios);

        // Llamar al callback con los precios actualizados
        callback(precios);

        // Aquí podrías añadir lógica para verificar alertas
        await this.verificarAlertas(precios);

        this.ejecutarBotUsuariosActivos();
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
      // console.log("📊 Precios actuales:", precios);

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
        // console.log(`\n🔎 Procesando alerta ID: ${alerta.id}`);
        // console.log(
        //   `   Cripto: ${alerta.criptomoneda}, Condición: ${alerta.condicion}, Objetivo: $${alerta.precio_objetivo}`
        // );

        const simbolo = `${alerta.criptomoneda}USDC`;
        const precioActual = precios[simbolo]?.precio;

        // console.log(`   Símbolo buscado: ${simbolo}`);
        // console.log(`   Precio actual: $${precioActual}`);

        if (!precioActual) {
          console.log(`   ⚠️ Precio no disponible para ${simbolo}`);
          continue;
        }

        let condicionCumplida = false;

        if (
          alerta.condicion === "por encima de" &&
          precioActual >= alerta.precio_objetivo
        ) {
          condicionCumplida = true;
          // console.log(
          //   `   ✅ CONDICIÓN CUMPLIDA: ${precioActual} >= ${alerta.precio_objetivo}`
          // );
        } else if (
          alerta.condicion === "por debajo de" &&
          precioActual <= alerta.precio_objetivo
        ) {
          condicionCumplida = true;
          // console.log(
          //   `   ✅ CONDICIÓN CUMPLIDA: ${precioActual} <= ${alerta.precio_objetivo}`
          // );
        } else {
          // console.log(
          //   `   ❌ Condición NO cumplida: ${precioActual} ${alerta.condicion} ${alerta.precio_objetivo}`
          // );
        }

        if (condicionCumplida) {
          console.log(`   🚀 Activando alerta ${alerta.id}...`);

          // Actualizar alerta como activa
          const { error: updateError } = await supabase
            .from("alertas")
            .update({
              estado: "activo",
              activado: new Date().toISOString(),
              precio_actual: precioActual,
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
              `   🎯 ${alerta.criptomoneda} alcanzó $${precioActual} (objetivo: $${alerta.precio_objetivo})`
            );
          }

          console.log("user_id: " + alerta.user_id);
          // Enviar notificación por WebSocket usando la instancia
          const notificacionEnviada = webSocketService.enviarNotificacion(
            alerta.user_id,
            {
              id: alerta.id,
              criptomoneda: alerta.criptomoneda,
              precio_objetivo: alerta.precio_objetivo,
              precio_actual: precioActual,
              condicion: alerta.condicion,
            }
          );

          if (notificacionEnviada) {
            console.log(
              `   📤 Notificación enviada al usuario ${alerta.user_id}`
            );
          } else {
            // console.log(
            //   `   ⚠️ Usuario ${alerta.user_id} no está conectado, notificación en cola`
            // );
            // Aquí podrías guardar la notificación en BD para enviarla cuando se conecte
          }
        }
      }
    } catch (error) {
      console.error("💥 Error verificando alertas:", error);
    }
  }

  // Monitorear compras de un usuario específico
  private async monitorearComprasUsuario(
    userId: string,
    ultimoAcceso?: number | string
  ): Promise<void> {
    try {
      console.log(`\n=== 🔄 MONITOREO DE COMPRAS PARA USUARIO ${userId} ===`);
      console.log("⏰", new Date().toISOString());

      const supabase = getSupabaseClient();

      // 1. Obtener exchanges del usuario usando el servicio de usuario
      let exchanges;
      try {
        exchanges = await servicioUsuario.obtenerExchangesUsuario(userId);
        // console.log(
        //   `📊 Encontrados ${exchanges.length} exchanges para el usuario`
        // );
      } catch (error) {
        console.error(
          `❌ Error obteniendo exchanges para usuario ${userId}:`,
          error
        );
        return;
      }

      if (!exchanges || exchanges.length === 0) {
        console.log(`ℹ️ Usuario ${userId} no tiene exchanges configurados`);
        return;
      }

      // console.log(
      //   `📊 Encontrados ${exchanges.length} exchanges activos para el usuario`
      // );

      // 2. Buscar exchange de Binance
      const binanceExchange = exchanges.find(
        (exchange) => exchange.exchange?.toUpperCase() === "BINANCE"
      );

      if (!binanceExchange) {
        console.log(
          `ℹ️ Usuario ${userId} no tiene exchange de Binance configurado`
        );
        return;
      }

      // console.log(`✅ Exchange de Binance encontrado para usuario ${userId}`);

      // 3. Desencriptar credenciales de Binance
      let credentials;
      try {
        // Asumiendo que tienes una función decrypt disponible
        const decryptedApiKey = decrypt(binanceExchange.api_key);
        const decryptedApiSecret = decrypt(binanceExchange.api_secret);

        credentials = {
          apiKey: decryptedApiKey,
          apiSecret: decryptedApiSecret,
        };
      } catch (decryptError) {
        console.error(
          `❌ Error desencriptando credenciales para usuario ${userId}:`,
          decryptError
        );
        return;
      }

      // 4. Obtener todas las compras del usuario desde Binance usando ultimoAcceso como startTime
      console.log(`🔄 Obteniendo trades de Binance para usuario ${userId}...`);

      try {
        // Convertir ultimoAcceso a timestamp si es string
        const startTime =
          typeof ultimoAcceso === "string"
            ? new Date(ultimoAcceso).getTime()
            : ultimoAcceso || Date.now() - 24 * 60 * 60 * 1000; // Si no hay ultimoAcceso, usar 24 horas atrás

        const endTime = Date.now();

        console.log(
          `📅 Buscando compras desde: ${new Date(startTime).toISOString()}`
        );
        console.log(`📅 Hasta: ${new Date(endTime).toISOString()}`);

        const allBuyTrades = await binanceService.getAllUserTrades(
          credentials,
          {
            startTime,
            endTime,
            limit: 1000, // Puedes ajustar este límite
          }
        );

        console.log(
          `📊 Obtenidos ${allBuyTrades.length} trades de Binance para usuario ${userId}`
        );

        // 5. Procesar y guardar las compras en la base de datos
        let nuevasCompras = 0;
        let comprasActualizadas = 0;
        let huboErrores = false;

        for (const trade of allBuyTrades) {
          try {
            // Solo procesar trades de compra (isBuyer = true)
            if (!trade.isBuyer) {
              continue;
            }

            // Verificar si la compra ya existe en la base de datos
            const { data: compraExistente, error: errorConsulta } =
              await supabase
                .from("compras")
                .select("id")
                .eq("idOrden", trade.orderId.toString())
                .eq("simbolo", trade.symbol)
                .eq("idUsuario", userId)
                .maybeSingle();

            if (errorConsulta) {
              console.error(
                `❌ Error verificando compra ${trade.orderId} - ${trade.symbol}:`,
                errorConsulta
              );
              huboErrores = true;
              continue;
            }

            // Preparar datos para insertar/actualizar
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
              fechaActualizacion: new Date().toISOString(),
            };

            if (compraExistente) {
              // Actualizar compra existente
              const { error: errorActualizacion } = await supabase
                .from("compras")
                .update(datosCompra)
                .eq("id", compraExistente.id);

              if (errorActualizacion) {
                console.error(
                  `❌ Error actualizando compra ${trade.orderId} - ${trade.symbol}:`,
                  errorActualizacion
                );
                huboErrores = true;
              } else {
                comprasActualizadas++;
                console.log(
                  `↻ Actualizada: ${trade.symbol} - ${trade.qty} @ $${trade.price}`
                );
              }
            } else {
              // Insertar nueva compra
              const { error: errorInsercion } = await supabase
                .from("compras")
                .insert([datosCompra]);

              if (errorInsercion) {
                console.error(
                  `❌ Error guardando compra ${trade.orderId} - ${trade.symbol}:`,
                  errorInsercion
                );
                huboErrores = true;

                // Si el error es por duplicado, continuar
                if (errorInsercion.code === "23505") {
                  continue;
                }
              } else {
                nuevasCompras++;
                console.log(
                  `✅ Guardada: ${trade.symbol} - ${trade.qty} @ $${trade.price}`
                );
              }
            }
          } catch (error) {
            console.error(`💥 Error procesando trade ${trade.orderId}:`, error);
            huboErrores = true;
          }
        }

        // 6. Mostrar resumen
        console.log(`\n📈 RESUMEN DE SINCRONIZACIÓN PARA ${userId}:`);
        console.log(`   Total trades obtenidos: ${allBuyTrades.length}`);
        console.log(`   Nuevas compras guardadas: ${nuevasCompras}`);
        console.log(`   Compras actualizadas: ${comprasActualizadas}`);
        console.log(`   Hubo errores: ${huboErrores ? "Sí" : "No"}`);

        // 7. Actualizar último acceso si no hubo errores
        if (!huboErrores) {
          try {
            await servicioUsuario.actualizarUltimoAcceso(userId);
            console.log(
              `✅ Fecha de último acceso actualizada para usuario ${userId}`
            );

            // Notificar al usuario que la sincronización fue exitosa
            webSocketService.enviarNotificacion(userId, {
              tipo: "sincronizacion_exitosa",
              mensaje: `Sincronización completada: ${nuevasCompras} nuevas compras`,
              nuevasCompras,
              comprasActualizadas,
              timestamp: new Date().toISOString(),
            });
          } catch (updateError) {
            console.error(
              `❌ Error actualizando último acceso para usuario ${userId}:`,
              updateError
            );
            // No marcamos como error general porque fue un error de actualización posterior
          }
        } else {
          console.log(
            `⚠️ No se actualizó el último acceso debido a errores en el proceso`
          );

          // Notificar al usuario que hubo errores
          webSocketService.enviarNotificacion(userId, {
            tipo: "sincronizacion_con_errores",
            mensaje: "La sincronización de compras tuvo algunos errores",
            nuevasCompras,
            comprasActualizadas,
            timestamp: new Date().toISOString(),
          });
        }

        // 8. Notificar al usuario vía WebSocket si hay nuevas compras
        if (nuevasCompras > 0 && !huboErrores) {
          const notificacionEnviada = webSocketService.enviarNotificacion(
            userId,
            {
              tipo: "nuevas_compras",
              mensaje: `Se han encontrado ${nuevasCompras} nuevas compras en tu cuenta de Binance`,
              nuevasCompras,
              totalCompras: allBuyTrades.length,
              timestamp: new Date().toISOString(),
            }
          );

          if (notificacionEnviada) {
            console.log(
              `📤 Notificación de nuevas compras enviada al usuario ${userId}`
            );
          }
        }
      } catch (binanceError) {
        console.error(
          `❌ Error obteniendo trades de Binance para usuario ${userId}:`,
          binanceError
        );

        // Notificar error al usuario
        webSocketService.enviarNotificacion(userId, {
          tipo: "error_sincronizacion",
          mensaje: "Error al sincronizar compras con Binance",
          error:
            binanceError instanceof Error
              ? binanceError.message
              : "Error desconocido",
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`✅ Monitoreo de compras completado para ${userId}\n`);
    } catch (error) {
      console.error(`💥 Error en monitoreo de compras para ${userId}:`, error);

      // Notificar error crítico al usuario
      webSocketService.enviarNotificacion(userId, {
        tipo: "error_monitoreo",
        mensaje: "Error crítico en el monitoreo de compras",
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Iniciar monitoreo periódico de compras para un usuario
  iniciarMonitoreoCompras(
    userId: string,
    ultimoAcceso: number | string, // Nuevo parámetro: timestamp en ms o string ISO
    intervaloMs: number = 300000
  ): void {
    // Verificar si ya hay un monitoreo activo para este usuario
    if (this.monitoreosComprasActivos.has(userId)) {
      console.log(
        `⚠️ Ya existe un monitoreo de compras activo para el usuario ${userId}`
      );
      return;
    }

    console.log(
      `🚀 Iniciando monitoreo de compras para usuario ${userId} cada ${
        intervaloMs / 60000
      } minutos`
    );
    console.log(
      `📅 Último acceso del usuario: ${new Date(ultimoAcceso).toISOString()}`
    );

    // Ejecutar inmediatamente, pasando el ultimoAcceso
    this.monitorearComprasUsuario(userId, ultimoAcceso);

    // Configurar intervalo periódico
    const intervalo = setInterval(() => {
      this.monitorearComprasUsuario(userId, ultimoAcceso);
    }, intervaloMs);

    // Guardar referencia al intervalo
    this.monitoreosComprasActivos.set(userId, intervalo);
  }
  // Detener monitoreo de compras para un usuario específico
  detenerMonitoreoCompras(userId: string): void {
    const intervalo = this.monitoreosComprasActivos.get(userId);

    if (intervalo) {
      clearInterval(intervalo);
      this.monitoreosComprasActivos.delete(userId);
      console.log(`🛑 Monitoreo de compras detenido para usuario ${userId}`);
    } else {
      console.log(
        `⚠️ No hay monitoreo de compras activo para el usuario ${userId}`
      );
    }
  }

  // Detener todos los monitoreos de compras
  detenerTodosMonitoreosCompras(): void {
    for (const [userId, intervalo] of this.monitoreosComprasActivos.entries()) {
      clearInterval(intervalo);
      console.log(`🛑 Monitoreo detenido para usuario ${userId}`);
    }

    this.monitoreosComprasActivos.clear();
    console.log("✅ Todos los monitoreos de compras han sido detenidos");
  }

  // Verificar si un usuario tiene monitoreo activo
  tieneMonitoreoComprasActivo(userId: string): boolean {
    return this.monitoreosComprasActivos.has(userId);
  }

  // Obtener lista de usuarios con monitoreo activo
  obtenerUsuariosConMonitoreoActivo(): string[] {
    return Array.from(this.monitoreosComprasActivos.keys());
  }

  //BOT trading
  activarBot(userId: string, config: Partial<BotConfig> = {}): boolean {
    if (this.usuariosBotActivos.has(userId)) {
      console.log(`⚠️ El bot ya está activo para el usuario ${userId}`);
      return false;
    }
  
    // Valores por defecto incluyendo simbolos (vacío por defecto)
    const configCompleta: BotConfig = {
      tradeAmountUSD: config.tradeAmountUSD ?? 10,
      intervals: config.intervals ?? ['3m', '5m'],
      simbolos: config.simbolos ?? [],  // <-- Se guarda la lista de símbolos
      limit: config.limit ?? 50,
      cooldownMinutes: config.cooldownMinutes ?? 5,
    };
  
    this.usuariosBotActivos.set(userId, configCompleta);
    console.log(`✅ Bot activado para el usuario ${userId} con configuración:`, configCompleta);
    return true;
  }
  
  desactivarBot(userId: string): boolean {
    return this.usuariosBotActivos.delete(userId);
  }
  
  obtenerUsuariosActivos(): { userId: string; config: BotConfig }[] {
    return Array.from(this.usuariosBotActivos.entries()).map(([userId, config]) => ({
      userId,
      config,
    }));
  }

  // private async ejecutarBotUsuariosActivos() {
  //   if (this.usuariosBotActivos.size === 0) {
  //     console.log("🤖 No hay usuarios con bot activo.");
  //     return;
  //   }
  
  //   console.log(`🤖 Ejecutando bot para ${this.usuariosBotActivos.size} usuario(s) activo(s)...`);
  
  //   const baseUrl = 'https://dportfolio-pi.vercel.app';
  
  //   for (const [userId, config] of this.usuariosBotActivos.entries()) {
  //     try {
  //       console.log(`🚀 Procesando usuario ${userId}...`);
  
  //       const response = await fetch(`${baseUrl}/api/atecnico/execute`, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({
  //           userId,
  //           tradeAmountUSD: config.tradeAmountUSD,
  //           intervals: config.intervals.join(','),
  //           limit: config.limit,
  //           cooldownMinutes: config.cooldownMinutes,
  //         }),
  //       });
  
  //       if (!response.ok) {
  //         const errorText = await response.text();
  //         throw new Error(`HTTP ${response.status}: ${errorText}`);
  //       }
  
  //       const result = await response.json();
  //       console.log(`✅ Bot ejecutado para usuario ${userId}. Resultado:`, result);
  
  //       // Opcional: notificar vía WebSocket
  //       // webSocketService.enviarNotificacion(userId, {
  //       //   tipo: 'bot_ejecutado',
  //       //   mensaje: `Bot ejecutado correctamente.`,
  //       //   resultado: result,
  //       // });
  
  //     } catch (error) {
  //       console.error(`❌ Error ejecutando bot para usuario ${userId}:`, error);
        
  //       // Opcional: notificar error
  //       // webSocketService.enviarNotificacion(userId, {
  //       //   tipo: 'bot_error',
  //       //   mensaje: `Error al ejecutar el bot: ${error.message}`,
  //       // });
  //     }
  //   }
  // }

  private async ejecutarBotUsuariosActivos() {
    if (this.usuariosBotActivos.size === 0) {
      console.log("🤖 No hay usuarios con bot activo.");
      return;
    }
  
    console.log(`🤖 Ejecutando bot para ${this.usuariosBotActivos.size} usuario(s) activo(s)...`);
  
    const supabase = getSupabaseClient();
  
    for (const userId of this.usuariosBotActivos.keys()) {
      try {
        const config = this.usuariosBotActivos.get(userId);
        if (!config) continue;
  
        // Obtener credenciales de Binance
        const { data: exchanges, error } = await supabase
          .from("exchanges")
          .select("api_key, api_secret")
          .eq("user_id", userId)
          .eq("exchange", "BINANCE")
          .eq("is_active", true)
          .limit(1);
  
        if (error || !exchanges || exchanges.length === 0) {
          console.error(`❌ No se encontró exchange Binance activo para usuario ${userId}`);
          continue;
        }
  
        const exchangeData = exchanges[0];
        const decryptedApiKey = decrypt(exchangeData.api_key);
        const decryptedApiSecret = decrypt(exchangeData.api_secret);
  
        const credentials: BinanceCredentials = {
          apiKey: decryptedApiKey,
          apiSecret: decryptedApiSecret,
        };
  
        // Ejecutar el bot con la configuración completa, incluyendo símbolos
        const result = await binanceService.executeTrades(
          credentials,
          userId,
          config.tradeAmountUSD,
          config.intervals,        // Ya es un array, no necesita conversión
          config.simbolos,         // <-- Se pasa la lista de símbolos seleccionados
          config.limit,
          config.cooldownMinutes
        );
  
        console.log(`✅ Bot ejecutado para usuario ${userId}. Operaciones: ${result.executed.length}`);
  
        // Notificación vía WebSocket
        webSocketService.enviarNotificacion(userId, {
          id: randomUUID(),
          titulo: "Bot ejecutado",
          tipo: "bot_ejecutado",
          mensaje: `Bot ejecutado. ${result.executed.filter(r => r.success).length} operaciones realizadas.`,
          fecha: new Date().toISOString(),
          leida: false,
        });
  
      } catch (error) {
        console.error(`❌ Error ejecutando bot para usuario ${userId}:`, error);
      }
    }
  }
}

export const monitorService = new ServicioMonitoreo();
