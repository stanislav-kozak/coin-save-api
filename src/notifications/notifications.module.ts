import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { NotificationService } from './notifications.service';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [NotificationService],
})
export class NotificationsModule {}
