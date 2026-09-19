import { Module } from '@nestjs/common';
import { SpacesService } from './spaces.service';
import { SpacesController } from './spaces.controller';
import { InvitationsController } from './invitations.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [SpacesController, InvitationsController],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
