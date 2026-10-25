import Link from "next/link";

export default function SiteBrand() {
  return (
    <Link className="site-brand" href="/" aria-label="Pharmacy Assistant home">
      <span className="site-brand-mark" aria-hidden="true">Rx</span>
      <span>Pharmacy Assistant</span>
    </Link>
  );
}
