import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Eval — Find the best model for your use case",
  description:
    "Auto-generate realistic test prompts, run them across multiple AI models, and rate responses blind to find the best model for what you're building.",
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
