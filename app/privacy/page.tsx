import type { Metadata } from "next";
import { LegalSection, LegalShell } from "../legal/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — Vector",
  description: "Privacy Policy for Vector Protocol at vectorprotocol.pro",
};

const LAST_UPDATED = "September 29, 2026";
const CONTACT = "vectorprotocol7@gmail.com";
const SITE = "https://vectorprotocol.pro";

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <LegalSection heading="1. Overview">
        <p>
          Vector Protocol (&quot;Vector,&quot; &quot;we&quot;) respects your privacy. This Privacy Policy
          explains what information we process when you use{" "}
          <a href={SITE} className="text-[var(--vector-pink)] underline">
            {SITE}
          </a>{" "}
          (the &quot;Service&quot;) and how we handle it. The Service is a non-custodial
          interface; we do not store your private keys or seed phrases.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information we process">
        <p>
          <strong className="text-[var(--vector-text)]">Wallet and on-chain data.</strong>{" "}
          When you connect a browser wallet or use a Circle programmable wallet, we
          process public blockchain addresses and transaction-related data needed to
          show balances, quotes, and history. This data is public on-chain.
        </p>
        <p>
          <strong className="text-[var(--vector-text)]">Authentication (Google path).</strong>{" "}
          If you choose &quot;Continue with Google,&quot; Google and Circle process sign-in
          according to their policies. Vector receives session tokens from Circle
          (for example, user tokens used to create transaction challenges) to operate
          the wallet flow; we do not receive your Google password.
        </p>
        <p>
          <strong className="text-[var(--vector-text)]">Server and security logs.</strong>{" "}
          Our backend proxy ({SITE}/api/endpoints) may process your IP address,
          request timestamps, and action types for origin validation, rate limiting,
          and abuse prevention. Logs are kept only as long as needed for operations
          and security.
        </p>
        <p>
          <strong className="text-[var(--vector-text)]">Cookies and local storage.</strong>{" "}
          We may store minimal client data (for example, device identifiers required
          by Circle&apos;s wallet SDK) in cookies or browser storage to maintain your
          session. You can clear site data in your browser; doing so may sign you out.
        </p>
      </LegalSection>

      <LegalSection heading="3. How we use information">
        <p>We use the information above to:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Provide swap, bridge, earn, send, and receive features;</li>
          <li>Proxy authorized requests to Circle APIs with server-side keys;</li>
          <li>Protect the Service (origin allowlists, rate limits, fraud prevention);</li>
          <li>Respond to support requests and legal obligations.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </LegalSection>

      <LegalSection heading="4. Third parties">
        <p>
          We share data with service providers only as needed to run the Service,
          including Circle (wallets, swap, bridge, earn), Google (OAuth), hosting
          (for example Vercel), and your chosen wallet extension. Their processing
          is governed by their privacy policies. On-chain transactions are visible to
          anyone via public block explorers.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your choices">
        <p>
          You can disconnect your wallet, sign out of Google/Circle sessions, and
          stop using the Service at any time. You control what you sign in your
          wallet. For Google account data, use Google&apos;s account tools. For Circle
          wallet data, refer to Circle&apos;s privacy documentation.
        </p>
      </LegalSection>

      <LegalSection heading="6. Security">
        <p>
          We use industry-standard practices such as keeping API secrets on the
          server, restricting API access by origin, and rate limiting. No method of
          transmission or storage is 100% secure; use strong device and account
          security.
        </p>
      </LegalSection>

      <LegalSection heading="7. International users">
        <p>
          The Service may be operated from various locations. By using Vector, you
          understand that information may be processed in countries where we or our
          providers operate, which may have different data protection rules than your
          country.
        </p>
      </LegalSection>

      <LegalSection heading="8. Children">
        <p>
          The Service is not directed to children under 18 (or the age of majority in
          your jurisdiction). We do not knowingly collect personal information from
          children.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes">
        <p>
          We may update this Privacy Policy. We will post changes on this page and
          update the &quot;Last updated&quot; date. Material changes may also be noted in the
          app where practical.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact">
        <p>
          Privacy questions or requests:{" "}
          <a
            href={`mailto:${CONTACT}`}
            className="text-[var(--vector-pink)] underline"
          >
            {CONTACT}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
