import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Role, type Space, type Membership } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import { findMatchingToken } from '../common/utils/find-matching-token';
import { slugify } from '../common/utils/slugify';
import { DEFAULT_CATEGORIES } from './constants/default-categories';

const INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SpaceWithRole {
  id: string;
  name: string;
  slug: string;
  primaryCurrency: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  joinedAt: Date;
}

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  invitedById: string;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async createSpace(ownerId: string, name: string): Promise<Space> {
    const slug = await this.generateUniqueSlug(name);
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    const locale = owner?.locale === 'en' ? 'en' : 'uk';

    const space = await this.prisma.space.create({
      data: {
        name,
        slug,
        ownerId,
        memberships: { create: { userId: ownerId, role: Role.OWNER } },
      },
    });

    await this.seedDefaultCategories(space.id, locale);

    return space;
  }

  async listSpacesForUser(userId: string): Promise<SpaceWithRole[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { space: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.space.id,
      name: m.space.name,
      slug: m.space.slug,
      primaryCurrency: m.space.primaryCurrency,
      role: m.role,
      createdAt: m.space.createdAt,
      updatedAt: m.space.updatedAt,
    }));
  }

  async getSpace(spaceId: string): Promise<Space> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
    });
    if (!space) {
      throw new AppException(
        ERROR_CODES.SPACE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Space not found',
      );
    }
    return space;
  }

  updateSpace(
    spaceId: string,
    data: { name?: string; primaryCurrency?: string },
  ): Promise<Space> {
    return this.prisma.space.update({ where: { id: spaceId }, data });
  }

  async deleteSpace(spaceId: string): Promise<void> {
    await this.prisma.space.delete({ where: { id: spaceId } });
  }

  async listMembers(spaceId: string): Promise<MemberView[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { spaceId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
  }

  async changeMemberRole(
    spaceId: string,
    membershipId: string,
    role: Role,
  ): Promise<Membership> {
    const membership = await this.findMembershipOrThrow(spaceId, membershipId);

    if (membership.role === Role.OWNER && role !== Role.OWNER) {
      await this.assertNotLastOwner(spaceId);
    }

    return this.prisma.membership.update({
      where: { id: membershipId },
      data: { role },
    });
  }

  async removeMember(spaceId: string, membershipId: string): Promise<void> {
    const membership = await this.findMembershipOrThrow(spaceId, membershipId);

    if (membership.role === Role.OWNER) {
      await this.assertNotLastOwner(spaceId);
    }

    await this.prisma.membership.delete({ where: { id: membershipId } });
  }

  async leaveSpace(spaceId: string, membership: Membership): Promise<void> {
    if (membership.role === Role.OWNER) {
      await this.assertNotLastOwner(spaceId);
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });
  }

  async inviteMember(
    spaceId: string,
    invitedById: string,
    email: string,
  ): Promise<void> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      const existingMembership = await this.prisma.membership.findUnique({
        where: { userId_spaceId: { userId: existingUser.id, spaceId } },
      });
      if (existingMembership) {
        throw new AppException(
          ERROR_CODES.ALREADY_MEMBER,
          HttpStatus.CONFLICT,
          'User is already a member',
        );
      }
    }

    await this.prisma.invitation.deleteMany({
      where: { spaceId, email, acceptedAt: null },
    });

    const token = randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(token);
    const space = await this.getSpace(spaceId);
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitedById },
    });

    await this.prisma.invitation.create({
      data: {
        spaceId,
        email,
        tokenHash,
        invitedById,
        expiresAt: new Date(Date.now() + INVITATION_TOKEN_TTL_MS),
      },
    });

    const locale = existingUser?.locale === 'en' ? 'en' : 'uk';
    await this.mail.send(
      email,
      locale,
      'invitation',
      locale === 'en'
        ? "You've been invited to CoinSave"
        : 'Запрошення до CoinSave',
      {
        spaceName: space.name,
        inviterName: inviter?.name ?? inviter?.email ?? 'CoinSave',
        acceptUrl: `${this.config.get<string>('FRONTEND_URL')}/invitations/accept?token=${token}`,
      },
    );
  }

  async listInvitations(spaceId: string): Promise<InvitationView[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: { spaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedById: invitation.invitedById,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }));
  }

  async revokeInvitation(spaceId: string, invitationId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.INVITATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Invitation not found',
      );
    }

    await this.prisma.invitation.delete({ where: { id: invitationId } });
  }

  async acceptInvitation(
    userId: string,
    userEmail: string,
    token: string,
  ): Promise<Membership> {
    const candidates = await this.prisma.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
    });

    const matched = await findMatchingToken(candidates, token);
    if (!matched) {
      throw new AppException(
        ERROR_CODES.INVALID_INVITATION_TOKEN,
        HttpStatus.BAD_REQUEST,
        'Invalid or expired invitation',
      );
    }

    if (matched.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new AppException(
        ERROR_CODES.INVITATION_EMAIL_MISMATCH,
        HttpStatus.FORBIDDEN,
        'This invitation was sent to a different email address',
      );
    }

    const existingMembership = await this.prisma.membership.findUnique({
      where: { userId_spaceId: { userId, spaceId: matched.spaceId } },
    });
    if (existingMembership) {
      throw new AppException(
        ERROR_CODES.ALREADY_MEMBER,
        HttpStatus.CONFLICT,
        'Already a member of this space',
      );
    }

    const membership = await this.prisma.membership.create({
      data: { userId, spaceId: matched.spaceId, role: matched.role },
    });

    await this.prisma.invitation.update({
      where: { id: matched.id },
      data: { acceptedAt: new Date() },
    });

    return membership;
  }

  private async findMembershipOrThrow(
    spaceId: string,
    membershipId: string,
  ): Promise<Membership> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.MEMBER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Member not found in this space',
      );
    }
    return membership;
  }

  private async assertNotLastOwner(spaceId: string): Promise<void> {
    const ownerCount = await this.prisma.membership.count({
      where: { spaceId, role: Role.OWNER },
    });
    if (ownerCount <= 1) {
      throw new AppException(
        ERROR_CODES.CANNOT_REMOVE_LAST_OWNER,
        HttpStatus.FORBIDDEN,
        'Cannot remove the last owner of the space',
      );
    }
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'space';
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = randomBytes(3).toString('hex');
      const candidate = `${base}-${suffix}`;
      const existing = await this.prisma.space.findUnique({
        where: { slug: candidate },
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new Error('Could not generate a unique space slug');
  }

  private async seedDefaultCategories(
    spaceId: string,
    locale: 'uk' | 'en',
  ): Promise<void> {
    const categories = DEFAULT_CATEGORIES[locale];
    await this.prisma.category.createMany({
      data: categories.map((c, index) => ({
        spaceId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sortOrder: index,
      })),
    });
  }
}
