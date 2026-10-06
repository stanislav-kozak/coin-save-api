import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Kept out of main.ts so tests can import it without starting the server.
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
