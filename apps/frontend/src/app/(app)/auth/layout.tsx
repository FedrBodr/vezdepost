export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { TestimonialComponent } from '@gitroom/frontend/components/auth/testimonial.component';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { AuthSocialProof } from '@gitroom/frontend/components/auth/auth.social-proof';

const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <MantineWrapper>
      <div className="bg-[#0E0E0E] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-white">
        <ReturnUrlComponent />
        <div className="flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[12px] text-white p-[12px] bg-[#1A1919]">
          <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white">
            <div className="flex items-center justify-between">
              <LogoTextComponent />
              <LanguageComponent />
            </div>
            <div className="flex">{children}</div>
          </div>
        </div>
        <div className="text-[36px] flex-1 pt-[88px] hidden lg:flex flex-col items-center">
          <AuthSocialProof />
          <TestimonialComponent />
        </div>
      </div>
    </MantineWrapper>
  );
}
