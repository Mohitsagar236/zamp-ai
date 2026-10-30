import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "InvoiceLens · Invoice review workspace",
  description: "From invoice PDF to an explainable decision.",
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
