import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

export function bootstrapSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CoinSave API')
    .setDescription('REST API for the CoinSave family expense tracker')
    .setVersion('1.0')
    .addCookieAuth('access')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs.json',
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AppExceptionFilter());
  bootstrapSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
