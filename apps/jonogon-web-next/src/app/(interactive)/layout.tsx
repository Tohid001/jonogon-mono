import type {Metadata} from 'next';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {GoogleAnalytics} from '@next/third-parties/google';

export const runtime = 'edge';

import '../../styles/interactive.css';

import React, {Suspense} from 'react';
import AuthWrapper from '@/auth/Wrapper';
import {TRPCWrapper} from '@/trpc/Wrapper';
import Navigation from '@/components/custom/Navigation';
import {Toaster} from '@/components/ui/toaster';
import {RedirectType} from 'next/dist/client/components/redirect';
import Script from 'next/script';

export const metadata: Metadata = {
    title: 'Jonogon — জনগণ',
    description: 'আমাদের দাবির প্লাটফর্ম',
    metadataBase: new URL('https://jonogon.org'),
    openGraph: {
        title: 'Jonogon — জনগণ',
        description: 'আমাদের দাবির প্লাটফর্ম',
        url: 'https://jonogon.org',
        siteName: 'jonogon.org',
        type: 'website',
        images: [
            {
                url: 'https://jonogon.org/opengraph-image.jpeg',
            },
        ],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const headersList = headers();
    const host = headersList.get('host');

    if (host === 'www.jonogon.org') {
        redirect(`https://jonogon.org/`, RedirectType.replace);
    }

    return (
        <html lang="en">
            <body className={''}>
                <AuthWrapper>
                    <TRPCWrapper hostname={'localhost'}>
                        <Suspense fallback={<>LOADING ...</>}>
                            <Navigation />
                            <div className={'mt-16'}>
                                <Toaster />
                                {children}
                            </div>
                        </Suspense>
                    </TRPCWrapper>
                </AuthWrapper>
                <Script id={'ms-clarity'}>
                    {`
                        (function(c,l,a,r,i,t,y){
                            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                        })(window, document, "clarity", "script", "o0jgdp84rn");
                    `}
                </Script>
            </body>
            <GoogleAnalytics gaId={'G-BY995Q5BBE'} />
        </html>
    );
}
