// servicioWebSocket.ts
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';

export class WebSocketService {
  private static instance: WebSocketService;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();

  private constructor() {
    // Constructor privado para evitar instanciación directa
  }

  /**
   * Obtener la instancia única del WebSocketService (Singleton)
   */
  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  /**
   * Inicializar el servidor WebSocket
   */
  public initialize(server: Server) {
    if (this.wss) {
      console.log('⚠️ WebSocket ya está inicializado');
      return;
    }

    // this.wss = new WebSocketServer({ server });
    this.wss = new WebSocketServer({ 
      server,
      path: '/api/ws'
    });
    this.setupWebSocket();
    console.log('🚀 WebSocket Server inicializado');
  }

  private setupWebSocket() {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('🔗 Nuevo cliente WebSocket conectado');

      // Configurar timeout para autenticación
      const authTimeout = setTimeout(() => {
        console.log('⏰ Timeout de autenticación WebSocket');
        ws.close(1008, 'Timeout de autenticación');
      }, 10000); // 10 segundos para autenticarse

      let pingInterval: NodeJS.Timeout | null = null;

      ws.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          
          if (data.tipo === 'autenticar' && data.usuarioId && data.token) {
            try {
              const decoded = jwt.verify(data.token, process.env.JWT_SECRET_KEY) as { id: string };
              
              if (decoded.id === data.usuarioId) {
                // Autenticación exitosa
                clearTimeout(authTimeout);
                this.clients.set(data.usuarioId, ws);
                console.log(`✅ Cliente autenticado: ${data.usuarioId}`);
                
                // Iniciar ping después de autenticación
                pingInterval = setInterval(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ tipo: 'ping', timestamp: Date.now() }));
                  }
                }, 30000);
                
                // Confirmar autenticación
                ws.send(JSON.stringify({
                  tipo: 'autenticacion_exitosa',
                  mensaje: 'WebSocket autenticado correctamente'
                }));
              } else {
                throw new Error('ID de usuario no coincide con token');
              }
            } catch (error) {
              console.error('❌ Error de autenticación WebSocket:', error);
              ws.send(JSON.stringify({
                tipo: 'error_autenticacion',
                mensaje: 'Token inválido'
              }));
              ws.close(1008, 'Error de autenticación');
            }
          }
          
          if (data.tipo === 'pong') {
            console.log('🏓 Pong recibido');
          }
        } catch (error) {
          console.error('Error procesando mensaje WebSocket:', error);
        }
      });

      ws.on('close', (code,reason) => {
        console.log(`🔌 WebSocket cerrado: ${code} - ${reason}`);
        
        // Limpiar intervalos y timeouts
        clearTimeout(authTimeout);
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        
        // Remover cliente
        for (const [userId, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(userId);
            console.log(`❌ Cliente desconectado: ${userId}`);
            break;
          }
        }
      });

      ws.on('error', (error) => {
        console.error('💥 Error WebSocket:', error);
        
        // Limpiar intervalos y timeouts
        clearTimeout(authTimeout);
        if (pingInterval) {
          clearInterval(pingInterval);
        }
      });

      // Enviar mensaje de bienvenida
      ws.send(JSON.stringify({
        tipo: 'conexion_establecida',
        mensaje: 'Conectado al servidor WebSocket. Por favor autentícate.'
      }));
    });
  }

  /**
   * Método para enviar notificación a un usuario específico
   */
  public enviarNotificacion(usuarioId: string, notificacion: any) {
    const client = this.clients.get(usuarioId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        tipo: 'nueva_notificacion',
        datos: notificacion
      }));
      console.log(`📤 Notificación enviada al usuario ${usuarioId}:`, notificacion);
      return true;
    } else {
      console.log(`❌ Usuario ${usuarioId} no está conectado o no se pudo enviar notificación`);
      return false;
    }
  }

  /**
   * Método para broadcast a todos los clientes
   */
  public broadcast(mensaje: any) {
    if (!this.wss) {
      console.log('❌ WebSocket no está inicializado');
      return;
    }

    let enviados = 0;
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(mensaje));
        enviados++;
      }
    });
    console.log(`📢 Broadcast enviado a ${enviados} clientes`);
  }

  /**
   * Verificar si un usuario está conectado
   */
  public estaUsuarioConectado(usuarioId: string): boolean {
    const client = this.clients.get(usuarioId);
    return !!(client && client.readyState === WebSocket.OPEN);
  }

  /**
   * Obtener número de clientes conectados
   */
  public getClientesConectados(): number {
    return this.clients.size;
  }
}

// Exportar la instancia única
export const webSocketService = WebSocketService.getInstance();