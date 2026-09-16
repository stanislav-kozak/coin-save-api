import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

const ACCESS_COOKIE = 'access';
const REFRESH_COOKIE = 'refresh';
const THROTTLE_5_PER_MIN = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('signup')
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() dto: SignupDto): Promise<{ message: string }> {
    await this.authService.signup(dto.email, dto.password);
    return { message: 'Verification email sent' };
  }

  @Post('verify-email')
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified' };
  }

  @Post('login')
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
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ message: string }> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { message: 'Logged out' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ message: string }> {
    const presented = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    const { accessToken, refreshToken } = await this.authService.refresh(presented, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    return { message: 'Refreshed' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleStart(): void {}

  @Get('google/callback')
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
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    return { message: 'If the email exists, a reset link was sent' };
  }

  @Post('reset-password')
  @Throttle(THROTTLE_5_PER_MIN)
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset' };
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
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
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}
