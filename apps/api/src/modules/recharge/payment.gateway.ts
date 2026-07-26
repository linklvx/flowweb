import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { auth } from '../../auth/auth';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({ namespace: '/payment', cors: { origin: '*' } })
export class PaymentGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  afterInit(server: any) {
    server.use(async (socket: any, next: any) => {
      const token = socket.handshake.auth?.token;
      if (!token) {
        socket.data.userId = null;
        return next();
      }
      try {
        const session = await auth.api.getSession({
          headers: new Headers({ cookie: `flowweb.session_token=${token}` }),
        });
        socket.data.userId = session?.user?.id ?? null;
      } catch {
        socket.data.userId = null;
      }
      next();
    });
  }

  @SubscribeMessage('join:order')
  async handleJoinOrder(client: Socket, data: { orderNo: string }) {
    const { orderNo } = data;
    const userId = client.data.userId;

    if (!userId) return;

    const order = await this.prisma.rechargeOrder.findUnique({
      where: { orderNo },
      select: { userId: true },
    });

    if (order && order.userId === userId) {
      client.join(`order:${orderNo}`);
    }
  }

  emitPaymentSuccess(orderNo: string, amount: number, balanceAfter: number) {
    this.server.to(`order:${orderNo}`).emit('payment:success', {
      orderNo, amount, balanceAfter,
    });
  }

  emitPaymentFailed(orderNo: string) {
    this.server.to(`order:${orderNo}`).emit('payment:failed', { orderNo });
  }
}
