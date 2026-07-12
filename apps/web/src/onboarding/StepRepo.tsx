import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, type RepoSummary, type BranchSummary } from "../api.ts";
import { isValidUrl, type FieldErrors } from "../lib.ts";
import { hoverLift, tapScale } from "../motion.ts";

// Step 3: Repo selection. Two modes:
//  - OAuth authed: searchable dropdown of GitHub repos + branch picker
//  - Manual: paste repo URL + branch
export function StepRepo({ onDone, onBack }: {
  onDone: (repoUrl: string, branch: string) => void;
  onBack: () => void;
}) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [usePicker, setUsePicker] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedFullName, setSelectedFullName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuthStatus().then((st) => {
      if (st.oauth && st.authed) {
        setUsePicker(true);
        api.listRepos().then(setRepos).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const onRepoSelect = (fullName: string) => {
    setBranches([]);
    setSelectedFullName(fullName);
    if (!fullName) {
      setRepoUrl("");
      setBranch("main");
      return;
    }
    const r = repos.find((x) => x.full_name === fullName);
    setRepoUrl(`https://github.com/${fullName}`);
    setBranch(r?.default_branch || "main");
    const [owner, repo] = fullName.split("/");
    api.listBranches(owner, repo).then(setBranches).catch(() => {});
  };

  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  const validate = (): boolean => {
    const e: FieldErrors = {};
    if (!repoUrl.trim()) e.repo_url = "required";
    else if (!isValidUrl(repoUrl)) e.repo_url = "invalid URL";
    if (!branch.trim()) e.branch = "required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validate()) onDone(repoUrl.trim(), branch.trim() || "main");
  };

  return (
    <div className="onb-step">
      <h2 className="onb-step-title">Pick a repository</h2>
      <p className="onb-step-sub">
        {usePicker
          ? "Search your GitHub repos, or switch to manual entry."
          : "Paste a Git repo URL and branch."}
      </p>

      {usePicker ? (
        <>
          <div className="onb-repo-toggle">
            <motion.button className="ghost"
              onClick={() => { setUsePicker(false); setSelectedFullName(""); setRepoUrl(""); }}
              variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
            >Switch to manual</motion.button>
          </div>
          <input
            className="onb-repo-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search repos…"
          />
          {loading ? (
            <p className="muted">loading repos…</p>
          ) : filtered.length === 0 ? (
            <p className="muted small">{search ? "no repos match" : "no repos found"}</p>
          ) : (
            <ul className="onb-repo-list">
              {filtered.slice(0, 50).map((r) => (
                <li key={r.id}>
                  <motion.button
                    className={`onb-repo-item ${selectedFullName === r.full_name ? "selected" : ""}`}
                    onClick={() => onRepoSelect(r.full_name)}
                    variants={hoverLift}
                    initial="rest"
                    whileHover="hover"
                    whileTap="hover"
                  >
                    <div className="repo-name">{r.full_name}</div>
                    <div className="repo-branch">default: {r.default_branch}{r.private ? " · private" : ""}</div>
                  </motion.button>
                </li>
              ))}
            </ul>
          )}
          {selectedFullName && (
            <div className="form" style={{ marginTop: "0.8rem" }}>
              <label>Branch
                <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                  {(branches.length ? branches : [{ name: branch }]).map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
                {errors.branch && <span className="field-err">{errors.branch}</span>}
              </label>
            </div>
          )}
        </>
      ) : (
        <div className="form">
          <label>Repo URL
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
            {errors.repo_url && <span className="field-err">{errors.repo_url}</span>}
          </label>
          <label>Branch
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
            {errors.branch && <span className="field-err">{errors.branch}</span>}
          </label>
        </div>
      )}

      <div className="onb-nav">
        <motion.button className="ghost" onClick={onBack}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >← Back</motion.button>
        <motion.button className="primary" onClick={next} disabled={!repoUrl.trim() || !branch.trim()}
          variants={tapScale} initial="rest" whileHover="hover" whileTap="pressed"
        >
          Continue →
        </motion.button>
      </div>
    </div>
  );
}
