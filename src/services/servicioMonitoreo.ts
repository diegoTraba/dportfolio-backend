import { binanceService } from "./servicioBinance.js";
import { servicioBot } from "./servicioBotS.js";
import { getSupabaseClient } from "../lib/supabase.js";
import { webSocketService } from "./servicioWebSocket.js";
import { decrypt } from "../lib/encriptacion.js";
import { servicioUsuario } from "./servicioUsuario.js";
import { BinanceCredentials } from "../interfaces/binance.types.js";
import { SimboloConfig, BotConfig } from "../interfaces/bot.types.js";
import { randomUUID } from "crypto";

export interface DatosPrecio {
  simbolo: string;
  precio: number;
  fechaActualizacion: string;
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
        // console.log("📊 Símbolos a monitorear:", simbolosAMonitorear);

        const precios = await this.obtenerMultiplesPrecios(simbolosAMonitorear);

        // console.log("💰 Precios obtenidos:", precios);

        // Guardar precios en la base de datos
        await this.guardarPreciosEnBD(precios);

        // Llamar al callback con los precios actualizados
        callback(precios);

        // Aquí podrías añadir lógica para verificar alertas
        await this.verificarAlertas(precios);

        this.ejecutarBotUsuariosActivos1();
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
        const simbolo = `${alerta.criptomoneda}USDC`;
        const precioActual = precios[simbolo]?.precio;

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
        } else if (
          alerta.condicion === "por debajo de" &&
          precioActual <= alerta.precio_objetivo
        ) {
          condicionCumplida = true;
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

    // Procesar los símbolos: pueden ser string[] (antiguo) o SimboloConfig[] (nuevo)
    let simbolosConfig: SimboloConfig[] = [];
    if (config.simbolos) {
      if (Array.isArray(config.simbolos)) {
        // Si el primer elemento es string, convertir cada uno a objeto sin límites
        if (
          config.simbolos.length > 0 &&
          typeof config.simbolos[0] === "string"
        ) {
          simbolosConfig = (config.simbolos as unknown as string[]).map(
            (s) => ({ symbol: s })
          );
        } else {
          // Ya es el nuevo formato
          simbolosConfig = config.simbolos as SimboloConfig[];
        }
      }
    }

    const configCompleta: BotConfig = {
      tradeAmountUSD: config.tradeAmountUSD ?? 10,
      intervals: config.intervals ?? ["3m", "5m"],
      simbolos: simbolosConfig,
      limit: config.limit ?? 50,
      cooldownMinutes: config.cooldownMinutes ?? 5,
      fechaActivacion: new Date().toISOString(),
      maxInversion: config.maxInversion ?? 100, // Valor por defecto si no se envía
    };

    this.usuariosBotActivos.set(userId, configCompleta);
    console.log(
      `✅ Bot activado para el usuario ${userId} con configuración:`,
      configCompleta
    );
    return true;
  }

  desactivarBot(userId: string): boolean {
    return this.usuariosBotActivos.delete(userId);
  }

  obtenerUsuariosActivos(): { userId: string; config: BotConfig }[] {
    return Array.from(this.usuariosBotActivos.entries()).map(
      ([userId, config]) => ({
        userId,
        config,
      })
    );
  }

  // Obtener configuración del bot para un usuario específico
  obtenerConfigUsuario(userId: string): BotConfig | null {
    const config = this.usuariosBotActivos.get(userId);
    return config ? { ...config } : null;
  }

  private async ejecutarBotUsuariosActivos() {
    if (this.usuariosBotActivos.size === 0) {
      console.log("🤖 No hay usuarios con bot activo.");
      return;
    }

    console.log(
      `🤖 Ejecutando bot para ${this.usuariosBotActivos.size} usuario(s) activo(s)...`
    );

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
          console.error(
            `❌ No se encontró exchange Binance activo para usuario ${userId}`
          );
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
        const result = await servicioBot.executeTrades(
          credentials,
          userId,
          config.tradeAmountUSD,
          config.intervals, // Ya es un array, no necesita conversión
          config.simbolos, // <-- Se pasa la lista de símbolos seleccionados
          config.limit,
          config.cooldownMinutes,
          config.maxInversion
        );

        console.log(
          `✅ Bot ejecutado para usuario ${userId}. Operaciones: ${result.executed.length}`
        );

        const operacionesExitosas = result.executed.filter(
          (r) => r.success
        ).length;
        //Solo notificamos al usuario si se ha realizado alguna operacion
        if (operacionesExitosas > 0) {
          // Notificación vía WebSocket
          webSocketService.enviarNotificacion(userId, {
            id: "temp_" + randomUUID(),
            titulo: "Bot ejecutado",
            tipo: "bot_ejecutado",
            mensaje: `Bot ejecutado. ${operacionesExitosas} operaciones realizadas.`,
            fecha: new Date().toISOString(),
            leida: false,
          });
        }
      } catch (error) {
        console.error(`❌ Error ejecutando bot para usuario ${userId}:`, error);
      }
    }
  }

  private async ejecutarBotUsuariosActivos1() {
    if (this.usuariosBotActivos.size === 0) return;

    console.log(
      `🤖 (Optimizado) Ejecutando bot para ${this.usuariosBotActivos.size} usuario(s)...`
    );

    const supabase = getSupabaseClient();
    const userIds = Array.from(this.usuariosBotActivos.keys());

    // ----- 1. OBTENER CREDENCIALES DE TODOS LOS USUARIOS -----
    const { data: exchanges, error } = await supabase
      .from("exchanges")
      .select("user_id, api_key, api_secret")
      .eq("exchange", "BINANCE")
      .eq("is_active", true)
      .in("user_id", userIds);

    if (error) {
      console.error("Error obteniendo credenciales:", error);
      return;
    }

    const credencialesMap = new Map<string, BinanceCredentials>();
    for (const ex of exchanges) {
      try {
        credencialesMap.set(ex.user_id, {
          apiKey: decrypt(ex.api_key),
          apiSecret: decrypt(ex.api_secret),
        });
      } catch (e) {
        console.error(
          `Error descifrando credenciales para usuario ${ex.user_id}:`,
          e
        );
      }
    }

    // ----- 2. RECOPILAR PARES ÚNICOS (símbolo|intervalo) -----
    const paresUnicos = new Set<string>();
    const usuariosValidos: string[] = [];

    for (const [userId, config] of this.usuariosBotActivos.entries()) {
      if (!credencialesMap.has(userId)) {
        console.warn(
          `Usuario ${userId} no tiene credenciales válidas, se omite`
        );
        continue;
      }
      usuariosValidos.push(userId);
      for (const simbolo of config.simbolos) {
        for (const interval of config.intervals) {
          paresUnicos.add(`${simbolo.symbol}|${interval}`);
        }
      }
    }

    if (paresUnicos.size === 0) {
      console.log("No hay pares válidos para analizar.");
      return;
    }

    // ----- 3. OBTENER VELAS PARA CADA PAR ÚNICO (CON LÍMITES DE CONCURRENCIA) -----
    const limit = 100; // O el valor que uses por defecto; podrías cogerlo de la configuración del primer usuario si todos usan el mismo
    const klinesMap = new Map<string, any[]>(); // clave: `${symbol}|${interval}`
    const paresArray = Array.from(paresUnicos);
    const CONCURRENCIA = 5; // Número de peticiones simultáneas (ajústalo según los límites de Binance)

    console.log(
      `📡 Obteniendo velas para ${paresArray.length} par(es) único(s)...`
    );

    for (let i = 0; i < paresArray.length; i += CONCURRENCIA) {
      const lote = paresArray.slice(i, i + CONCURRENCIA);
      const resultados = await Promise.allSettled(
        lote.map(async (par) => {
          const [symbol, interval] = par.split("|");
          // Usamos el mismo limit para todos; si cada usuario pudiera tener un limit diferente, habría que ajustarlo
          const klines = await binanceService.getKlines(
            symbol,
            interval,
            limit
          );
          return { par, klines };
        })
      );

      for (const res of resultados) {
        if (res.status === "fulfilled") {
          klinesMap.set(res.value.par, res.value.klines);
          console.log("par correcto: " + res.value.par);
        } else {
          console.error("❌ Error obteniendo klines para un par:", res.reason);
        }
      }
    }

    console.log(`✅ Velas obtenidas para ${klinesMap.size} pares.`);

    // ----- 4. CALCULAR INDICADORES COMPLETOS PARA CADA PAR -----
    const indicadoresGlobales = new Map<
      string,
      {
        closes: number[];
        ema7: number[];
        ema21: number[];
        rsi: number[];
        macd: { macd: number[]; signal: number[]; histogram: number[] };
      }
    >();

    for (const [par, klines] of klinesMap.entries()) {
      try {
        const indicadores =
          binanceService.calcularIndicadoresDesdeVelas(klines);
        indicadoresGlobales.set(par, indicadores);
        console.log("obteniendo indicadores para par:" + par);
        console.log(
          "closes: " +
            indicadores.closes +
            "; ema7: " +
            indicadores.ema7 +
            "; ema21: " +
            indicadores.ema21 +
            "; RSI: " +
            indicadores.rsi +
            ": MACD: " +
            indicadores.macd.macd +
            "; MACD signal: " +
            indicadores.macd.signal
        );
      } catch (error) {
        console.error(`❌ Error calculando indicadores para ${par}:`, error);
      }
    }

    console.log(`✅ indicadores obtenidos. procesando señales por usuario`);

    // ----- 5. PROCESAR CADA USUARIO -----
    for (const userId of usuariosValidos) {
      console.log(`Procesando usuario ${userId}`);
      const config = this.usuariosBotActivos.get(userId)!;
      const creds = credencialesMap.get(userId)!;
      const cooldownMs = config.cooldownMinutes * 60 * 1000;
      const totalIntervalos = config.intervals.length; // Todos los símbolos usan los mismos intervalos

      const resultadosUsuario = [];

      // Procesar cada símbolo del usuario
      for (const simboloConfig of config.simbolos) {
        const symbol = simboloConfig.symbol;
        let sumaConfianzaCompra = 0;
        let sumaConfianzaVenta = 0;

        // Evaluar cada intervalo para este símbolo
        for (const interval of config.intervals) {
          const key = `${symbol}|${interval}`;
          const indicadores = indicadoresGlobales.get(key);
          if (!indicadores) {
            console.warn(`No hay indicadores para ${key}, se omite`);
            continue;
          }

          const señal = binanceService.evaluateSignals(
            indicadores.closes,
            indicadores.ema7,
            indicadores.ema21,
            indicadores.rsi,
            indicadores.macd
          );

          // Solo acumulamos si la señal es válida (acción no NONE y confianza >= 0.5)
          if (señal.action === "NONE" || señal.confidence < 0.5) continue;

          if (señal.action === "BUY") {
            sumaConfianzaCompra += señal.confidence;
          } else if (señal.action === "SELL") {
            sumaConfianzaVenta += señal.confidence;
          }
        }

        // Calcular promedios sobre el total de intervalos
        const confianzaCompra = sumaConfianzaCompra / totalIntervalos;
        const confianzaVenta = sumaConfianzaVenta / totalIntervalos;

        // Determinar acción final
        let accionFinal: "BUY" | "SELL" | null = null;
        let confianzaFinal = 0;

        if (confianzaCompra > confianzaVenta) {
          accionFinal = "BUY";
          confianzaFinal = confianzaCompra;
        } else if (confianzaVenta > confianzaCompra) {
          accionFinal = "SELL";
          confianzaFinal = confianzaVenta;
        } else {
          console.log(`⚖️ Empate de confianza para ${symbol}, no se opera.`);
          continue;
        }

        // Opcional: no operar si la confianza final es muy baja
        if (confianzaFinal < 0.5) {
          console.log(
            `Confianza baja (${confianzaFinal}) para ${symbol}, no se opera.`
          );
          continue;
        }

        // Ejecutar orden
        const resultado = await servicioBot.ejecutarOrdenSegunSenial(
          creds,
          userId,
          symbol,
          { action: accionFinal, confidence: confianzaFinal },
          config.tradeAmountUSD,
          config.maxInversion,
          simboloConfig.lowerLimit,
          simboloConfig.upperLimit,
          cooldownMs
        );

        if (resultado?.success) {
          resultadosUsuario.push(resultado);
        }
      }

      // Notificar al usuario si hubo operaciones
      if (resultadosUsuario.length > 0) {
        webSocketService.enviarNotificacion(userId, {
          id: "temp_" + randomUUID(),
          titulo: "Bot ejecutado",
          tipo: "bot_ejecutado",
          mensaje: `Bot ejecutado. ${resultadosUsuario.length} operaciones realizadas.`,
          fecha: new Date().toISOString(),
          leida: false,
        });
      }
    }
  }
}

export const monitorService = new ServicioMonitoreo();
