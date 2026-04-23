import type { Metadata } from 'next'
import { Nunito, Lora } from 'next/font/google'
import './globals.css'

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
})

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
})

export const metadata: Metadata = {
  title: 'Proxia Care',
  description: 'Family care coordination dashboard',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${nunito.variable} ${lora.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
