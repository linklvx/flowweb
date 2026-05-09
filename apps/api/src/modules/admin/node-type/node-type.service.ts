import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class NodeTypeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.nodeType.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findById(id: string) {
    return this.prisma.nodeType.findUnique({ where: { id }, include: { models: true } });
  }

  async create(data: { name: string; key: string; description?: string }) {
    return this.prisma.nodeType.create({ data });
  }

  async update(id: string, data: { name?: string; description?: string; active?: boolean }) {
    return this.prisma.nodeType.update({ where: { id }, data });
  }
}
