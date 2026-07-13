import { useEffect, useRef, useState } from "react";
import { api, type RepoSummary, type BranchSummary } from "../api.ts";
import { Input, Select } from "@atelier/ui";

// Vercel-style repo picker: a searchable dropdown that lists the user's
// GitHub repos (for OAuth users) with a fallback to manual URL entry.
// Shows repo name, visibility badge, and default branch. Selecting a repo
// auto-loads its branches into the Branch dropdown.
export function RepoPicker({
  repoUrl,
  branch,
  onRepoChange,
  onBranchChange,
  errorRepo,
  errorBranch,
}: {
  repoUrl: string;
  branch: string;
  onRepoChange: (url: string, defaultBranch: string) => void;
  onBranchChange: (b: string) => void;
  errorRepo?: string;
  errorBranch?: string;
}) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [usePicker, setUsePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedFullName, setSelectedFullName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getAuthStatus().then((st) => {
      if (st.oauth && st.authed) {
        setUsePicker(true);
        api.listRepos().then(setRepos).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Extract full_name from current repoUrl for display
  useEffect(() => {
    if (repoUrl.startsWith("https://github.com/")) {
      setSelectedFullName(repoUrl.slice("https://github.com/".length));
    }
  }, [repoUrl]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load branches when a repo is selected
  useEffect(() => {
    if (!selectedFullName || !selectedFullName.includes("/")) return;
    const [owner, repo] = selectedFullName.split("/");
    api.listBranches(owner, repo).then(setBranches).catch(() => {});
  }, [selectedFullName]);

  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  const selectRepo = (fullName: string) => {
    setSelectedFullName(fullName);
    setOpen(false);
    setSearch("");
    const r = repos.find((x) => x.full_name === fullName);
    const defaultBranch = r?.default_branch || "main";
    onRepoChange(`https://github.com/${fullName}`, defaultBranch);
  };

  // If no OAuth, show manual input
  if (!usePicker && !loading) {
    return (
      <>
        <Input
          label="Repo URL"
          value={repoUrl}
          onChange={(e) => onRepoChange(e.target.value, branch)}
          placeholder="https://github.com/owner/repo"
          error={errorRepo}
        />
        <Input
          label="Branch"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          placeholder="main"
          error={errorBranch}
        />
      </>
    );
  }

  return (
    <>
      {/* Searchable repo dropdown */}
      <div className="repo-picker-wrap" ref={dropdownRef}>
        <label className="atelier-input-label">Repository</label>
        <button
          type="button"
          className="repo-picker-trigger"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Select repository"
        >
          {selectedFullName || (loading ? "Loading repos…" : "Select a repository…")}
          <span className="repo-picker-chevron">{open ? "▴" : "▾"}</span>
        </button>
        {errorRepo && <span className="atelier-input-error">{errorRepo}</span>}
        {open && (
          <div className="repo-picker-dropdown" role="listbox">
            <input
              className="repo-picker-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search repositories…"
              autoFocus
              aria-label="Search repositories"
            />
            {loading ? (
              <div className="repo-picker-empty">Loading repos…</div>
            ) : filtered.length === 0 ? (
              <div className="repo-picker-empty">
                {search ? "No repos match" : "No repos found"}
              </div>
            ) : (
              <ul className="repo-picker-list" role="option">
                {filtered.slice(0, 50).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`repo-picker-item ${selectedFullName === r.full_name ? "selected" : ""}`}
                      onClick={() => selectRepo(r.full_name)}
                      role="option"
                      aria-selected={selectedFullName === r.full_name}
                    >
                      <div className="repo-picker-item-name">{r.full_name}</div>
                      <div className="repo-picker-item-meta">
                        <span className="repo-picker-badge">{r.private ? "private" : "public"}</span>
                        <span className="muted small">default: {r.default_branch}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Branch dropdown */}
      {selectedFullName && (
        <Select
          label="Branch"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          error={errorBranch}
        >
          {(branches.length ? branches : [{ name: branch }]).map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </Select>
      )}

      {/* Toggle to manual */}
      <button
        type="button"
        className="ghost small repo-picker-toggle"
        onClick={() => setUsePicker(false)}
      >
        Switch to manual URL entry
      </button>

      <style>{`
        .repo-picker-wrap { position: relative; }
        .repo-picker-trigger {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0.7rem;
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: var(--radius-md, 8px);
          color: var(--text);
          font: inherit;
          cursor: pointer;
          text-align: left;
        }
        .repo-picker-trigger:hover { border-color: var(--accent); }
        .repo-picker-trigger:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .repo-picker-chevron { color: var(--muted); font-size: 0.7rem; }
        .repo-picker-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          z-index: 100;
          background: var(--panel-solid, #141414);
          border: 1px solid var(--border-strong, rgba(247,249,250,0.2));
          border-radius: var(--radius-md, 8px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          max-height: 320px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .repo-picker-search {
          padding: 0.5rem 0.7rem;
          background: var(--panel);
          border: none;
          border-bottom: 1px solid var(--border);
          color: var(--text);
          font: inherit;
          outline: none;
        }
        .repo-picker-search:focus { border-bottom-color: var(--accent); }
        .repo-picker-list {
          list-style: none;
          margin: 0;
          padding: 0;
          overflow-y: auto;
          flex: 1;
        }
        .repo-picker-item {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          padding: 0.5rem 0.7rem;
          background: transparent;
          border: none;
          color: var(--text);
          cursor: pointer;
          text-align: left;
        }
        .repo-picker-item:hover { background: var(--panel-2); }
        .repo-picker-item.selected { background: color-mix(in srgb, var(--accent) 12%, transparent); }
        .repo-picker-item-name { font-size: 0.85rem; font-weight: 500; }
        .repo-picker-item-meta { display: flex; gap: 0.5rem; align-items: center; }
        .repo-picker-badge {
          font-size: 0.65rem;
          padding: 0.1rem 0.35rem;
          border-radius: 3px;
          border: 1px solid var(--border);
          color: var(--muted);
          text-transform: uppercase;
        }
        .repo-picker-empty { padding: 0.8rem; color: var(--muted); font-size: 0.82rem; text-align: center; }
        .repo-picker-toggle { align-self: flex-start; padding: 0.2rem 0; font-size: 0.72rem; }
      `}</style>
    </>
  );
}
