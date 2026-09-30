import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayInit, WsException,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Server, Socket } from 'socket.io';
import { auth } from '../../auth/auth';
import { PrismaService } from '../../prisma/prisma.service';

/** 批0c 质量修复2：豁免全局 ThrottlerGuard——WS context 下 throttler handleRequest 对
 *  消息 payload 无条件 res.header(...) 抛 TypeError（@nestjs/throttler 6.5.0，同 execution.gateway），
 *  否则 join:order 每次调用即抛、支付状态推送断链。 */
@SkipThrottle()
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

    const subOrder = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo },
      select: { userId: true },
    });

    if (subOrder && subOrder.userId === userId) {
      client.join(`order:${orderNo}`);
      return;
    }

    const teamOrder = await this.prisma.teamRechargeOrder.findUnique({
      where: { outTradeNo: orderNo },
      select: { payerUserId: true },
    });
    if (teamOrder) {
      if (teamOrder.payerUserId !== userId) throw new WsException('无权加入此订单');
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

  emitSubscriptionPaymentSuccess(orderNo: string, amount: number) {
    this.server.to(`order:${orderNo}`).emit('subscription:order:success', {
      orderNo, amount,
    });
  }

  emitSubscriptionPaymentFailed(orderNo: string) {
    this.server.to(`order:${orderNo}`).emit('subscription:order:failed', { orderNo });
  }
}
