import './load-env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ShutdownService } from './common/services/shutdown.service';
import express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Enable shutdown hooks for graceful shutdown
  app.enableShutdownHooks();

  // Wire up graceful shutdown service
  const shutdownService = app.get(ShutdownService);
  shutdownService.setShutdownCallback(async () => {
    await app.close();
  });

  // Enhanced Security Headers (Phase 3 Security Audit)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Disable for API usage
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS Configuration (Phase 3 Security Audit)
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || ['*'];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin) return callback(null, true);

      // Check if wildcard or origin matches
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Enhanced Validation pipe with security options
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: process.env.NODE_ENV === 'production', // Hide details in prod
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('OpenWA API')
    .setDescription('Open Source WhatsApp API Gateway - Free, Self-Hosted HTTP API')
    .setVersion('0.1.6')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .addTag('sessions', 'WhatsApp session management')
    .addTag('messages', 'Send and manage messages')
    .addTag('webhooks', 'Webhook configuration')
    .addTag('contacts', 'Contact management')
    .addTag('groups', 'Group management')
    .addTag('labels', 'Label management (WhatsApp Business)')
    .addTag('channels', 'Channel/Newsletter management')
    .addTag('health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 2785;
  await app.listen(port);

  console.log(`🚀 OpenWA is running on: http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

void bootstrap();
