'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function CookiesPage() {
  return (
    <ContentPage
      eyebrow="cookie policy"
      title="cookie policy"
      intro="ip2p uses exactly one cookie: a session cookie, set when you log in, that keeps you signed in as you move between pages."
      sections={[
        { heading: 'what it is', body: ['a single "session" cookie, marked httponly (inaccessible to page scripts) and samesite=strict (never sent to any other site). it contains no personal information itself \u2014 just a reference to your session on our server.'] },
        { heading: 'what it\u2019s for', body: ['strictly to keep you logged in. without it, you\u2019d need to re-enter your password on every page.'] },
        { heading: 'what we don\u2019t use', body: ['iP2P does not use advertising cookies, third-party tracking cookies, or analytics cookies. we don\u2019t sell data to ad networks, so there\u2019s nothing to opt out of beyond your session itself \u2014 which ends when you log out or it naturally expires.'] },
        { heading: 'managing it', body: ['you can clear this cookie at any time by logging out or clearing your browser\u2019s cookies for this site; you\u2019ll simply need to log in again.'] },
      ]}
    />
  );
}
