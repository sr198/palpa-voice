import './globals.css';

export const metadata = {
  title: 'Palpa Voice',
  description: 'Voice session slice 1'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
