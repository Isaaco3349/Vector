import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "Vector",
  description: "Your wallet. Your keys. One tap in.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
