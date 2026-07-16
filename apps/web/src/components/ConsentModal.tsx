import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Button } from "@atelier/ui";

// Renders when the API returns 409 acceptance_required. Shows the docs, records
// acceptance on agree, then retries the blocked action via onDone.
export function ConsentModal({
  missing,
  onDone,
}: {
  missing: { docId: string; version: string }[];
  onDone: () => void;
}) {
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all(missing.map((m) => api.getLegalDoc(m.docId))).then((ds) => {
      const map: Record<string, string> = {};
      ds.forEach((d) => (map[d.doc_id] = d.body));
      setDocs(map);
    });
  }, [missing]);

  return (
    <div className="consent-overlay">
      <div className="consent-modal">
        <h2>We've updated our terms</h2>
        <p>Please review and accept to continue:</p>
        {missing.map((m) => (
          <details key={m.docId}>
            <summary>{m.docId}</summary>
            <pre>{docs[m.docId]}</pre>
          </details>
        ))}
        <label>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />{" "}
          I agree
        </label>
        <Button
          variant="primary"
          loading={busy}
          disabled={!agreed || busy}
          onClick={async () => {
            setBusy(true);
            try {
              for (const m of missing) await api.acceptLegal(m.docId, m.version);
              onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
