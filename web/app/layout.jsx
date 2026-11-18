import "./globals.css";

export const metadata = {
  title: "ZK Lending",
  description: "Private lending on Cardano Preprod with zero-knowledge proofs generated in your browser.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
