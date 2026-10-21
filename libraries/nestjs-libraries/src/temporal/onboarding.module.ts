import { Global, Module } from '@nestjs/common';
import { OnboardingStarter } from './onboarding.starter';

@Global()
@Module({
  providers: [OnboardingStarter],
  exports: [OnboardingStarter],
})
export class OnboardingModule {}
