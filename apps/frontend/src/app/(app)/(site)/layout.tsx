import { LayoutComponent } from '@gitroom/frontend/components/new-layout/layout.component';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LayoutComponent
      mobileRouteEnabled={process.env.MOBILE_ROUTE_ENABLED === 'true'}
    >
      {children}
    </LayoutComponent>
  );
}
