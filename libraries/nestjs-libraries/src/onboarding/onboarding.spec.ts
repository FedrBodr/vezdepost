import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import {
  onboardingMessage,
  OnboardingStep,
} from '@gitroom/nestjs-libraries/onboarding/onboarding.emails';
import {
  onboardingUnsubscribeUrl,
  signOnboardingUnsubscribeToken,
  verifyOnboardingUnsubscribeToken,
} from '@gitroom/nestjs-libraries/onboarding/onboarding.token';
import { isEmailActivationRequired } from '@gitroom/nestjs-libraries/services/email.activation';

const steps: OnboardingStep[] = [
  'welcome',
  'no_channel_day1',
  'no_channel_day3',
  'first_post',
];

describe('onboarding unsubscribe token', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.example.test/api';
  });

  it('round-trips the user id', () => {
    expect(
      verifyOnboardingUnsubscribeToken(signOnboardingUnsubscribeToken('user-1'))
    ).toBe('user-1');
  });

  it('rejects a JWT signed for another purpose', () => {
    expect(
      verifyOnboardingUnsubscribeToken(AuthChecker.signJWT({ id: 'user-1' }))
    ).toBeNull();
    expect(
      verifyOnboardingUnsubscribeToken(
        AuthChecker.signJWT({ id: 'user-1', purpose: 'something_else' })
      )
    ).toBeNull();
  });

  it('rejects garbage and missing tokens', () => {
    expect(verifyOnboardingUnsubscribeToken('not-a-jwt')).toBeNull();
    expect(verifyOnboardingUnsubscribeToken(undefined)).toBeNull();
  });

  it('builds the public backend unsubscribe link', () => {
    const url = new URL(onboardingUnsubscribeUrl('user-1'));
    expect(url.origin + url.pathname).toBe(
      'https://app.example.test/api/public/onboarding/unsubscribe'
    );
    expect(
      verifyOnboardingUnsubscribeToken(url.searchParams.get('token')!)
    ).toBe('user-1');
  });
});

describe('onboarding emails', () => {
  it.each(steps)('%s ends with the unsubscribe link', (step) => {
    const message = onboardingMessage(step, {
      unsubscribeUrl: 'https://unsubscribe.example.test/x',
    });

    expect(message.subject).not.toBe('');
    expect(message.html.trim().endsWith('</p>')).toBe(true);
    expect(message.html.lastIndexOf('https://unsubscribe.example.test/x')).toBe(
      message.html.indexOf('https://unsubscribe.example.test/x')
    );
    expect(message.html).toMatch(
      /href="https:\/\/unsubscribe\.example\.test\/x">Отписаться<\/a>\.<\/p>$/
    );
    expect(message.botText).not.toContain('unsubscribe');
    expect(message.botText.split('\n').length).toBeLessThanOrEqual(3);
  });

  it.each(steps)('%s never uses the word «зарплата»', (step) => {
    const message = onboardingMessage(step, { unsubscribeUrl: 'u' });
    expect(
      `${message.subject} ${message.html} ${message.botText}`.toLowerCase()
    ).not.toContain('зарплат');
  });

  it('invites a reply in every email', () => {
    for (const step of steps) {
      expect(onboardingMessage(step, { unsubscribeUrl: 'u' }).html).toMatch(
        /ответ/
      );
    }
  });
});

describe('isEmailActivationRequired', () => {
  const original = process.env.EMAIL_ACTIVATION_DISABLED;
  afterEach(() => {
    process.env.EMAIL_ACTIVATION_DISABLED = original;
  });

  it('keeps the upstream rule when the flag is unset', () => {
    delete process.env.EMAIL_ACTIVATION_DISABLED;
    expect(isEmailActivationRequired(true)).toBe(true);
    expect(isEmailActivationRequired(false)).toBe(false);
  });

  it('keeps users auto-activated when the flag is on', () => {
    process.env.EMAIL_ACTIVATION_DISABLED = 'true';
    expect(isEmailActivationRequired(true)).toBe(false);
    expect(isEmailActivationRequired(false)).toBe(false);
  });
});
