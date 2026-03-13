import { Providers } from "../providers";
import { Header } from "../components/header";
import { Toaster } from "../components/Toaster";
import { CookieBanner } from "../components/CookieBanner";
import { TelemetryConsent } from "../components/TelemetryConsent";
import { DatadogRum } from "../components/DatadogRum";

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
