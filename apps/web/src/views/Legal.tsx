import { useEffect, useState } from "react";
import { api } from "../api.ts";
import "./legal.css";

// ponytail: no error state — failed fetch just leaves Loading…; api wrapper
// surfaces errors via toast elsewhere. Add an error branch if this viewer ever
// needs standalone retry.
export function Legal({ docId }: { docId: string }) {
  const [doc, setDoc] = useState<{ title: string; body: string; version: string } | null>(null);

  useEffect(() => {
    api.getLegalDoc(docId).then(setDoc);
  }, [docId]);

  if (!doc) return <div className="legal-wrap">Loading…</div>;

  return (
    <div className="legal-wrap">
      <h1>{doc.title}</h1>
      <pre className="legal-body">{doc.body}</pre>
    </div>
  );
}
