import type { Metadata } from "next";
import "./globals.css";
import "./components/site-brand.css";

export const metadata: Metadata = {
  title: "Pharmacy Assistant | COMP 385 Capstone",
  description:
    "A local educational prototype for minor ailment assessment workflows and typed prescription verification.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
