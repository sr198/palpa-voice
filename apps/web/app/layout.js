import './globals.css';

export const metadata = {
  title: 'Palpa Studio',
  description: 'Canvas-first collaboration room for humans and agents'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
