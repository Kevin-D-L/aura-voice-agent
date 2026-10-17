import "./globals.css";

export const metadata = {
  title: "Aura Skincare · Voice Agent",
  description: "Browser-based AI voice customer support agent (Aria) for Aura Skincare",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}