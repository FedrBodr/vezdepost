import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { StreakService } from '@gitroom/nestjs-libraries/database/prisma/streak/streak.service';

@Injectable()
@Activity()
export class EmailActivity {
  private readonly _logger = new Logger(EmailActivity.name);

  constructor(
    private _emailService: EmailService,
    private _organizationService: OrganizationService,
    private _usersService: UsersService,
    private _streakService: StreakService
  ) {}

  @ActivityMethod()
  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    return this._emailService.sendEmailSync(to, subject, html, replyTo);
  }

  @ActivityMethod()
  async sendEmailAsync(
    to: string,
    subject: string,
    html: string,
    sendTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    return await this._emailService.sendEmail(
      to,
      subject,
      html,
      sendTo,
      replyTo
    );
  }

  @ActivityMethod()
  async getUserOrgs(id: string) {
    return this._organizationService.getTeam(id);
  }

  @ActivityMethod()
  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationService.setStreak(organizationId, type);
  }

  @ActivityMethod()
  async getStreakReminderContext(organizationId: string, userId: string) {
    try {
      return await this._streakService.getStreakReminderContext(
        organizationId,
        userId
      );
    } catch (error) {
      this.logStreakReminderFailure('load context', organizationId, userId);
      throw error;
    }
  }

  @ActivityMethod()
  async hasPublishedOnLocalDate(
    organizationId: string,
    userId: string,
    localDate: string
  ) {
    try {
      return await this._streakService.hasPublishedOnLocalDate(
        organizationId,
        userId,
        localDate
      );
    } catch (error) {
      this.logStreakReminderFailure(
        'check publication',
        organizationId,
        userId
      );
      throw error;
    }
  }

  @ActivityMethod()
  async sendStreakReminder(
    organizationId: string,
    userId: string,
    localDate: string
  ) {
    try {
      const context = await this._streakService.getStreakReminderContext(
        organizationId,
        userId
      );
      if (!context.enabled || !context.hasActiveStreak) {
        return false;
      }

      if (
        await this._streakService.hasPublishedOnLocalDate(
          organizationId,
          userId,
          localDate
        )
      ) {
        return false;
      }

      const user = await this._usersService.getStreakReminderUser(
        organizationId,
        userId
      );
      if (!user || user.disabled || !user.activated || !user.sendStreakEmails) {
        return false;
      }

      await this._emailService.sendEmail(
        user.email,
        'Streak Reminder',
        '<p>You are about to lose your streak in two hours! schedule a post now to keep it!</p>',
        'bottom',
        undefined
      );
      return true;
    } catch (error) {
      this.logStreakReminderFailure('send reminder', organizationId, userId);
      throw error;
    }
  }

  private logStreakReminderFailure(
    operation: string,
    organizationId: string,
    userId: string
  ) {
    this._logger.error(
      `Failed to ${operation} for streak reminder organizationId=${organizationId} userId=${userId}`
    );
  }
}
