import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';

const ACCESS_COOKIE = 'access';
const REFRESH_COOKIE = 'refresh';
// Non-secret "a session exists" hint on path=/ so the frontend middleware can
// tell a logged-in user apart after the 15-minute access cookie expires (the
// refresh cookie is only sent to /api/auth). Lives as long as the refresh token.
const SESSION_COOKIE = 'session';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const THROTTLE_5_PER_MIN = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('signup')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'EMAIL_ALREADY_EXISTS')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'EMAIL_DELIVERY_FAILED')
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'HTTP_ERROR')
  @ApiCreatedResponse({ type: MessageResponseDto })
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() dto: SignupDto): Promise<{ message: string }> {
    await this.authService.signup(
      dto.email,
      dto.password,
      dto.name,
      dto.locale,
    );
    return { message: 'Verification email sent' };
  }

  @Post('verify-email')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_VERIFICATION_TOKEN',
  )
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'HTTP_ERROR')
  @ApiOkResponse({ type: MessageResponseDto })
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified' };
  }

  @Post('resend-verification')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'HTTP_ERROR')
  @ApiOkResponse({ type: MessageResponseDto })
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    await this.authService.resendVerification(dto.email);
    return {
      message: 'If the account exists and is not verified, a new link was sent',
    };
  }

  @Post('login')
  @ApiErrorResponse(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    'HTTP_ERROR',
  )
  @ApiErrorResponse(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED')
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'HTTP_ERROR')
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: LoginResponseDto })
  @Throttle(THROTTLE_5_PER_MIN)
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    return { user };
  }

  @Post('logout')
  @ApiOkResponse({ type: MessageResponseDto })
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const refreshToken = this.extractRefreshToken(req);
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearAuthCookies(res);
    return { message: 'Logged out' };
  }

  @Post('refresh')
  @ApiErrorResponse(
    HttpStatus.UNAUTHORIZED,
    'INVALID_REFRESH_TOKEN',
    'REFRESH_TOKEN_REUSE_DETECTED',
  )
  @ApiOkResponse({ type: MessageResponseDto })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    try {
      const presented = this.extractRefreshToken(req);
      if (!presented) {
        throw new AppException(
          ERROR_CODES.INVALID_REFRESH_TOKEN,
          HttpStatus.UNAUTHORIZED,
          'Invalid refresh token',
        );
      }

      const { accessToken, refreshToken } = await this.authService.refresh(
        presented,
        {
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        },
      );
      this.setAuthCookies(res, accessToken, refreshToken);
      return { message: 'Refreshed' };
    } catch (error) {
      // A rejected refresh means the session is over: drop the session hint
      // too, otherwise the frontend middleware would keep letting the user in
      // and bounce between the app and /login. Transient failures (5xx) keep
      // the cookies so a retry can still succeed.
      if (
        error instanceof HttpException &&
        error.getStatus() === Number(HttpStatus.UNAUTHORIZED)
      ) {
        this.clearAuthCookies(res);
      }
      throw error;
    }
  }

  @Get('me')
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
  @ApiOkResponse({ type: UserResponseDto })
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findPublicById(user.id);
  }

  @Get('google')
  @ApiFoundResponse({ description: 'Redirects to Google OAuth consent' })
  @UseGuards(GoogleAuthGuard)
  googleStart(): void {}

  @Get('google/callback')
  @ApiFoundResponse({
    description: 'Sets auth cookies and redirects to the frontend',
  })
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { accessToken, refreshToken } = await this.authService.login(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    res.redirect('/');
  }

  @Post('request-password-reset')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'HTTP_ERROR')
  @ApiOkResponse({ type: MessageResponseDto })
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    return { message: 'If the email exists, a reset link was sent' };
  }

  @Post('reset-password')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_RESET_TOKEN',
  )
  @ApiErrorResponse(HttpStatus.TOO_MANY_REQUESTS, 'HTTP_ERROR')
  @ApiOkResponse({ type: MessageResponseDto })
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset' };
  }

  private extractRefreshToken(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[REFRESH_COOKIE];
    if (fromCookie) {
      return fromCookie;
    }
    const body = req.body as { refreshToken?: string } | undefined;
    return body?.refreshToken;
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: REFRESH_TTL_MS,
    });
    res.cookie(SESSION_COOKIE, '1', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_TTL_MS,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
