import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { emailMatches } from '../common/utils/email';

// Fields safe to return to the client. Never add passwordHash here.
export const publicUserSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  avatarUrl: true,
  locale: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    // Oldest first, in case legacy rows differ only in letter case.
    return this.prisma.user.findFirst({
      where: { email: emailMatches(email) },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findPublicById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
  }

  createLocal(
    email: string,
    passwordHash: string,
    name?: string,
    locale?: string,
  ): Promise<User> {
    return this.prisma.user.create({
      data: { email, passwordHash, name, locale },
    });
  }

  updateProfile(
    id: string,
    data: { name?: string | null; locale?: string },
  ): Promise<PublicUser> {
    return this.prisma.user.update({
      where: { id },
      data: { name: data.name, locale: data.locale },
      select: publicUserSelect,
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }

  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    });
  }

  updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
