import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthDbStatusDto {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';

  @ApiPropertyOptional()
  error?: string;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ type: HealthDbStatusDto })
  db!: HealthDbStatusDto;

  @ApiProperty({ description: 'Process uptime in seconds' })
  uptime!: number;
}
