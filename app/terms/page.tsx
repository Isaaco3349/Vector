import type { Metadata } from "next";
import { LegalSection, LegalShell } from "../legal/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service — Vector",
  description: "Terms of Service for Vector Protocol at vectorprotocol.pro",
};

const LAST_UPDATED = "September 29, 2026";
const CONTACT = "vectorprotocol7@gmail.com";
const SITE = "https://vectorprotocol.pro";

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <LegalSection heading="1. Agreement">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of
          Vector Protocol (&quot;Vector,&quot; &quot;we,&quot; &quot;us&quot;), including the website at{" "}
          <a href={SITE} className="text-[var(--vector-pink)] underline">
            {SITE}
          </a>{" "}
          and related interfaces (the &quot;Service&quot;). By connecting a wallet,
          signing in with Google, or otherwise using the Service, you agree to these
          Terms. If you do not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection heading="2. What Vector is (and is not)">
        <p>
          Vector is a <strong className="text-[var(--vector-text)]">non-custodial</strong>{" "}
          interface for USDC-focused activities on Arc and supported networks. We do not
          hold your private keys, seed phrases, or funds. Transactions are initiated by
          you and executed on public blockchains through your wallet or Circle
          programmable wallet credentials.
        </p>
        <p>
          Vector is <strong className="text-[var(--vector-text)]">not</strong> a bank,
          broker, exchange, money transmitter, or investment adviser. We do not provide
          financial, legal, or tax advice. Displayed rates, APYs, and quotes come from
          third-party protocols and may change or fail.
        </p>
      </LegalSection>

      <LegalSection heading="3. Eligibility and your responsibilities">
        <p>
          You must be able to form a binding contract where you live and must comply
          with applicable laws. You are solely responsible for your wallet security
          (including Google account access, PIN, and device security for Circle wallets),
          for verifying transaction details before signing, and for paying network fees
          where your wallet path requires them.
        </p>
        <p>
          You must not use the Service for illegal activity, sanctions evasion, fraud,
          or to interfere with the Service or other users.
        </p>
      </LegalSection>

      <LegalSection heading="4. Third-party services">
        <p>
          The Service integrates third parties including, without limitation, Circle
          (programmable wallets, App Kit, CCTP, Earn, Gas Station), Google (sign-in),
          blockchain networks, wallet extensions, and liquidity/routing providers
          behind Circle&apos;s APIs. Your use of those services is subject to their
          terms and policies. Vector does not control third-party smart contracts,
          relayers, or RPC providers and is not responsible for their failures,
          delays, or losses.
        </p>
      </LegalSection>

      <LegalSection heading="5. Fees">
        <p>
          Vector may charge a disclosed platform fee on certain flows (for example,
          swap and bridge). Fees are shown in the interface before you confirm when
          applicable. You also pay blockchain and protocol fees as determined by the
          network and integrated kits. Circle custom-fee splits may apply per
          Circle&apos;s documentation.
        </p>
      </LegalSection>

      <LegalSection heading="6. Risks">
        <p>
          Digital assets and smart contracts involve substantial risk, including total
          loss of funds, smart contract bugs, bridge delays, slippage, MEV, wallet
          phishing, and user error. You use the Service at your own risk.
        </p>
      </LegalSection>

      <LegalSection heading="7. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF
          ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR
          A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE MAXIMUM EXTENT PERMITTED BY
          LAW.
        </p>
      </LegalSection>

      <LegalSection heading="8. Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, VECTOR AND ITS OPERATORS WILL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
          DAMAGES, OR ANY LOSS OF FUNDS, DATA, OR PROFITS, ARISING FROM YOUR USE OF
          THE SERVICE OR THIRD-PARTY SERVICES, EVEN IF ADVISED OF THE POSSIBILITY.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes">
        <p>
          We may update these Terms from time to time. We will post the revised Terms
          on this page and update the &quot;Last updated&quot; date. Continued use after changes
          constitutes acceptance of the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact">
        <p>
          Questions about these Terms:{" "}
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
