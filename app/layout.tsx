import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
