import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { AppConfig } from '../config/configuration';

describe('HealthController', () => {
  let controller: HealthController;

  const appConfig: AppConfig = {
    name: 'Emarath Backend',
    environment: 'development',
    port: 5000,
    apiPrefix: 'api',
    corsOrigin: 'http://localhost:3000',
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'app' ? appConfig : undefined),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get<HealthController>(HealthController);
  });

  it('reports an ok status with the current environment', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('Emarath Backend');
    expect(result.environment).toBe('development');
    expect(typeof result.timestamp).toBe('string');
    expect(typeof result.uptime).toBe('number');
  });
});
