import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata = {
  title: "Vector",
  description: "USDC-native swap, bridge, and earn on Arc.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("vector-theme");if(t==="light")document.documentElement.setAttribute("data-theme","light");}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
