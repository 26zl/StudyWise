/**
 * Layout for (main)-gruppen: Header, Toaster, CookieBanner, TelemetryConsent, Datadog RUM.
 * Wrapper alle innloggede sider (dashboard, oversikt, profil, osv.) med felles shell.
 */
import { Providers } from "../providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import { TelemetryConsent } from "@/app/components/layout/TelemetryConsent";
import { DatadogRum } from "@/app/components/layout/DatadogRum";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const rumApplicationId =
    process.env.DD_RUM_APPLICATION_ID ?? process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
  const rumClientToken =
    process.env.DD_RUM_CLIENT_TOKEN ?? process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
  const rumConfig =
    rumApplicationId && rumClientToken
      ? {
          applicationId: rumApplicationId,
          clientToken: rumClientToken,
          site: process.env.DD_RUM_SITE ?? process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com",
        }
      : null;

  return (
    <>
      {rumConfig && (
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__DD_RUM_CONFIG__=${JSON.stringify(rumConfig)};`,
          }}
        />
      )}
      <Providers>
        <div className="flex flex-col min-h-screen">
          <Header />
          <div className="flex-1 min-h-0 overflow-y-auto relative flex flex-col">
            {children}
          </div>
        </div>
        <Toaster />
        <DatadogRum />
        <TelemetryConsent />
        <CookieBanner />
      </Providers>
    </>
  );
}
