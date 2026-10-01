import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { HealthResponseDto } from './dto/health-response.dto';

interface HealthCheckResult {
  status: 'ok' | 'error';
  db: { status: 'up' | 'down'; error?: string };
  uptime: number;
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async check(): Promise<HealthCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: { status: 'up' },
        uptime: process.uptime(),
      };
    } catch (error) {
      const result: HealthCheckResult = {
        status: 'error',
        db: { status: 'down', error: (error as Error).message },
        uptime: process.uptime(),
      };
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
