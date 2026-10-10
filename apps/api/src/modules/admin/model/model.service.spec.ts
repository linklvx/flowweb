import { Test, TestingModule } from '@nestjs/testing';
import { ModelService } from './model.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ModelService', () => {
  let service: ModelService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aIModel: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      modelResolution: { create: vi.fn(), delete: vi.fn() },
      modelDuration: { create: vi.fn(), delete: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ModelService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ModelService>(ModelService);
  });

  it('should list models for a node type with resolutions and durations', async () => {
    prisma.aIModel.findMany.mockResolvedValue([{ id: 'm1', name: 'SD XL', resolutions: [], durations: [] }]);
    const result = await service.findByNodeType('nt1');
    expect(result).toHaveLength(1);
    expect(prisma.aIModel.findMany).toHaveBeenCalledWith({
      where: { nodeTypeId: 'nt1' },
      include: { resolutions: true, durations: true },
      orderBy: { sortOrder: 'asc' },
    });
  });

  it('should find a model by id with resolutions and durations', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', name: 'SD XL', resolutions: [], durations: [] });
    const result = await service.findById('m1');
    expect(result.id).toBe('m1');
    expect(prisma.aIModel.findUnique).toHaveBeenCalledWith({
      where: { id: 'm1' },
      include: { resolutions: true, durations: true },
    });
  });

  it('should throw NotFoundException when findById fails', async () => {
    prisma.aIModel.findUnique.mockResolvedValue(null);
    await expect(service.findById('bad')).rejects.toThrow(NotFoundException);
  });

  it('should create a model with resolutions', async () => {
    prisma.aIModel.create.mockResolvedValue({ id: 'm1', name: 'test' });
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', name: 'test', resolutions: [{ id: 'r1', label: '1024x1024', width: 1024, height: 1024 }], durations: [] });
    const result = await service.create({
      nodeTypeId: 'nt1', name: 'HY-Image', provider: 'tencent', apiModelName: 'hy-image-v3.0', apiKey: 'sk-x', apiUrl: 'https://api.example.com',
      resolutions: [{ label: '1024x1024', width: 1024, height: 1024 }],
    });
    expect(result.id).toBe('m1');
    expect(prisma.modelResolution.create).toHaveBeenCalled();
  });

  it('should create a model with durations', async () => {
    prisma.aIModel.create.mockResolvedValue({ id: 'm1', name: 'test' });
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', name: 'test', resolutions: [], durations: [{ id: 'd1', label: '15s', seconds: 15 }] });
    const result = await service.create({
      nodeTypeId: 'nt1', name: 'HY-Video', provider: 'tencent', apiModelName: 'hy-video-1.5', apiKey: 'sk-x', apiUrl: 'https://api.example.com',
      durations: [{ label: '15s', seconds: 15 }],
    });
    expect(result.id).toBe('m1');
    expect(prisma.modelDuration.create).toHaveBeenCalled();
  });

  it('Y0b-2（Z117①）写边界：create 落 active=true 但 !ready（缺 apiKey）→ 400 MODEL_NOT_READY', async () => {
    await expect(service.create({
      nodeTypeId: 'nt1', name: 'X', provider: 'tencent', apiModelName: 'hy', apiUrl: 'https://api.example.com',
    })).rejects.toMatchObject({ errorCode: 'MODEL_NOT_READY' });
    expect(prisma.aIModel.create).not.toHaveBeenCalled();
  });

  it('Y0b-2（Z117①）写边界：create 无 adapter slug 同判 MODEL_NOT_READY', async () => {
    await expect(service.create({
      nodeTypeId: 'nt1', name: 'X', provider: 'stability', apiModelName: 'sdxl', apiKey: 'sk-x', apiUrl: 'https://api.example.com',
    })).rejects.toMatchObject({ errorCode: 'MODEL_NOT_READY' });
  });

  it('should update a model', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: false, provider: 'tencent', apiModelName: 'hy', apiKey: null });
    prisma.aIModel.update.mockResolvedValue({ id: 'm1', name: 'updated' });
    const result = await service.update('m1', { name: 'updated' });
    expect(result.name).toBe('updated');
    expect(prisma.aIModel.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { name: 'updated' } });
  });

  it('Y0b-2（Z117①）写边界：update 清空 apiKey（active 行变 !ready）→ 400 MODEL_NOT_READY', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: true, provider: 'tencent', apiModelName: 'hy', apiKey: 'sk-old' });
    await expect(service.update('m1', { apiKey: '' })).rejects.toMatchObject({ errorCode: 'MODEL_NOT_READY' });
    expect(prisma.aIModel.update).not.toHaveBeenCalled();
  });

  it('Y0b-2（Z117①）写边界：update 为 inactive 行改名放行（!active 不受 ready 约束）', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: false, provider: 'stability', apiModelName: null, apiKey: null });
    prisma.aIModel.update.mockResolvedValue({ id: 'm1', name: 'renamed' });
    const result = await service.update('m1', { name: 'renamed' });
    expect(result.name).toBe('renamed');
  });

  it('should toggle model active status', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: true });
    prisma.aIModel.update.mockResolvedValue({ id: 'm1', active: false });
    const result = await service.toggle('m1');
    expect(result.active).toBe(false);
  });

  it('Y0b-2（Z117①）写边界：toggle 上线 !ready 行（缺钥）→ 400 MODEL_NOT_READY', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: false, provider: 'tencent', apiModelName: 'hy', apiKey: null });
    await expect(service.toggle('m1')).rejects.toMatchObject({ errorCode: 'MODEL_NOT_READY' });
    expect(prisma.aIModel.update).not.toHaveBeenCalled();
  });

  it('Y0b-2（Z117①）写边界：toggle 上线 ready 行放行', async () => {
    prisma.aIModel.findUnique.mockResolvedValue({ id: 'm1', active: false, provider: 'tencent', apiModelName: 'hy', apiKey: 'sk-x' });
    prisma.aIModel.update.mockResolvedValue({ id: 'm1', active: true });
    const result = await service.toggle('m1');
    expect(result.active).toBe(true);
  });

  it('should throw NotFoundException on toggle for missing model', async () => {
    prisma.aIModel.findUnique.mockResolvedValue(null);
    await expect(service.toggle('bad-id')).rejects.toThrow(NotFoundException);
  });

  it('should add resolution to model', async () => {
    prisma.modelResolution.create.mockResolvedValue({ id: 'r1', label: '2048x2048', width: 2048, height: 2048 });
    const result = await service.addResolution('m1', { label: '2048x2048', width: 2048, height: 2048 });
    expect(result.label).toBe('2048x2048');
  });

  it('should remove resolution', async () => {
    prisma.modelResolution.delete.mockResolvedValue({ id: 'r1' });
    await service.removeResolution('r1');
    expect(prisma.modelResolution.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('should add duration to model', async () => {
    prisma.modelDuration.create.mockResolvedValue({ id: 'd1', label: '15s', seconds: 15 });
    const result = await service.addDuration('m1', { label: '15s', seconds: 15 });
    expect(result.seconds).toBe(15);
  });

  it('should remove duration', async () => {
    prisma.modelDuration.delete.mockResolvedValue({ id: 'd1' });
    await service.removeDuration('d1');
    expect(prisma.modelDuration.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('should delete a model', async () => {
    prisma.aIModel.delete.mockResolvedValue({ id: 'm1' });
    await service.delete('m1');
    expect(prisma.aIModel.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });
});
