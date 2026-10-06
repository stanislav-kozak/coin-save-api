// Fails when a DTO property is missing from the OpenAPI document generated
// from the built app (dist/). The @nestjs/swagger CLI plugin infers schemas
// at build time and silently drops a property it cannot analyse — e.g.
// initialBalance with @Min(-1_000_000_000) — which leaves the frontend's
// generated client unable to send it. Run after `npm run build`.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// The app module must be instantiated (not started) to build the document;
// these only satisfy constructors, nothing connects anywhere.
for (const key of [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
]) {
  process.env[key] ??= 'ci-placeholder';
}
process.env.FRONTEND_URL ??= 'http://localhost';
process.env.DATABASE_URL ??= 'postgresql://user:password@localhost:5432/db';

const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const { AppModule } = require(path.resolve('dist/app.module'));

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  await app.close();

  const schemas = doc.components.schemas;
  const queryParams = new Set();
  for (const ops of Object.values(doc.paths)) {
    for (const op of Object.values(ops)) {
      for (const p of op.parameters ?? []) {
        if (p.in === 'query') queryParams.add(p.name);
      }
    }
  }

  const files = execSync("find src -name '*.dto.ts'")
    .toString()
    .trim()
    .split('\n');
  const problems = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, cls, body] of source.matchAll(
      /export class (\w+)[^{]*\{([\s\S]*?)\n\}/g,
    )) {
      const props = [...body.matchAll(/^ {2}(\w+)[!?]?:/gm)].map((m) => m[1]);
      // Query DTOs are expanded into query parameters, not schemas.
      const present = cls.endsWith('QueryDto')
        ? (p) => queryParams.has(p)
        : (p) => Boolean(schemas[cls]?.properties?.[p]);
      const missing = props.filter((p) => !present(p));
      if (missing.length)
        problems.push(`${cls}: ${missing.join(', ')} (${file})`);
    }
  }

  if (problems.length) {
    console.error('DTO properties missing from the OpenAPI document:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Add an explicit @ApiProperty to these fields.');
    process.exit(1);
  }
  console.log(`OpenAPI covers every DTO property (${files.length} files).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
