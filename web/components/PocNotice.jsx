// Shown on every page: what this is, and what it is not.
export const PROPOSAL_URL = "https://milestones.projectcatalyst.io/projects/1300196";
export const REPO_URL = "https://github.com/TrustLevel/ZK-Defi-Protocol";

export default function PocNotice() {
  return (
    <div className="mb-6 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
      <strong>Proof of concept on Cardano Preprod.</strong> Test ADA only, no real funds, no audit. Built for the
      Project Catalyst proposal{" "}
      <a className="underline" href={PROPOSAL_URL} target="_blank" rel="noreferrer">ZK DeFi Lending &amp; Borrowing Protocol</a>{" "}
      to show private lending with zero-knowledge proofs in practice.{" "}
      <a className="underline" href={REPO_URL} target="_blank" rel="noreferrer">Code and documentation</a>.
    </div>
  );
}
