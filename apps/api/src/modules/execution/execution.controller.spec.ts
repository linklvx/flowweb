import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ExecutionController', () => {
  let controller: ExecutionController;
  let service: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      execute: vi.fn().mockResolvedValue({ success: true, errors: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExecutionController],
      providers: [{ provide: ExecutionService, useValue: service }],
    }).compile();

    controller = module.get<ExecutionController>(ExecutionController);
  });

  it('should call service.execute with provided parameters', async () => {
    const body = { projectId: 'p1', nodeId: 'n2', userId: 'user-1' };
    const result = await controller.execute(body);
    expect(service.execute).toHaveBeenCalledWith('p1', 'n2', 'user-1');
    expect(result).toEqual({ success: true, errors: [] });
  });

  it('should default userId to default-user when not provided', async () => {
    const body = { projectId: 'p1' };
    await controller.execute(body);
    expect(service.execute).toHaveBeenCalledWith('p1', undefined, 'default-user');
  });
});
