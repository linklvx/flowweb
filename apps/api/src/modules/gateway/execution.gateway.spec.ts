import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionGateway } from './execution.gateway';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ExecutionGateway', () => {
  let gateway: ExecutionGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecutionGateway],
    }).compile();
    gateway = module.get<ExecutionGateway>(ExecutionGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
