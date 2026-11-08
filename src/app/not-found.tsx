import Link from "next/link";
import { PageIntro } from "@/components/ui";
import { buttonPrimary } from "@/components/ui/styles";

export default function NotFound() {
  return (
    <>
      <PageIntro
        section="Notes"
        title="That page is not available."
        description="Check the link, or go back to your notes."
      />
      <Link href="/notes" className={buttonPrimary}>
        Back to notes
      </Link>
    </>
  );
}
