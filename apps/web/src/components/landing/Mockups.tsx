/**
 * Mockups — IDE/terminal mockup cards ported from Atelier-Landing.
 * Each is a presentational component composed of WinChrome + inner JSX.
 * Keeps the inline syntax-highlight spans (.t-kw, .t-fn, etc.)
 * and the landing sample copy verbatim.
 */
import { WinChrome } from "./WinChrome"

export const ChatMock = () => (
  <WinChrome title="atelier — session · checkout-flow" badge="Fable 5 · live">
    <div className="win__chat">
      <div className="win__bubble win__bubble--user">
        <span className="win__from">you</span>
        Fix the cart total rounding bug.
      </div>
      <div className="win__bubble win__bubble--agent">
        <span className="win__from win__from--agent">atelier</span>
        On it — rounding <code>totalCents</code> in <code>cart.ts</code> and adding a guard for sub-cent drift.
      </div>
      <div className="win__tool">
        <span className="win__tool-icon win__tool-icon--edit">✎</span>
        edit · cart.ts
        <span className="win__diff">+9 −3</span>
      </div>
      <div className="win__tool">
        <span className="win__tool-icon win__tool-icon--term">▌</span>
        run · pnpm test cart
        <span className="win__status">done</span>
      </div>
      <div className="win__composer">
        <span className="win__mic">●</span>
        Message the agent…
        <span className="win__send">↑</span>
      </div>
    </div>
  </WinChrome>
)

export const DiffMock = () => (
  <WinChrome title="cart.ts — diff" badge="+9 −3">
    <div className="win__code">
      <div className="win__line win__line--ctx">
        <span className="win__ln">42</span>
        <span className="t-kw">function</span> <span className="t-fn">total</span>(items) &#123;
      </div>
      <div className="win__line win__line--del">
        <span className="win__ln">43</span>
        {"  "}<span className="t-kw">return</span> items.<span className="t-fn">reduce</span>(<span className="t-fn">sum</span>, <span className="t-num">0</span>)<span className="t-op">;</span>
      </div>
      <div className="win__line win__line--add">
        <span className="win__ln">43</span>
        {"  "}<span className="t-kw">const</span> cents = items.<span className="t-fn">reduce</span>(<span className="t-fn">sumCents</span>, <span className="t-num">0</span>)<span className="t-op">;</span>
      </div>
      <div className="win__line win__line--add">
        <span className="win__ln">44</span>
        {"  "}<span className="t-kw">return</span> <span className="t-fn">round2</span>(cents)<span className="t-op">;</span> <span className="t-comment">// no drift</span>
      </div>
      <div className="win__line win__line--ctx">
        <span className="win__ln">45</span>
        &#125;
      </div>
    </div>
    <div className="win__term">
      <div className="win__term-label">terminal</div>
      <div className="win__term-line">
        <span className="t-prompt">$</span> pnpm test <span className="t-flag">--</span> cart
      </div>
      <div className="win__term-line">
        <span className="t-pass">✓</span> rounds to nearest cent <span className="t-dim">(9 ms)</span>
      </div>
      <div className="win__term-line">
        <span className="t-pass">Tests:</span> <span className="t-result">3 passed</span>
      </div>
    </div>
  </WinChrome>
)

export const SubMock = () => (
  <WinChrome title="atelier — subagents" badge="3 running">
    <div className="win__subs">
      <div className="win__sub">
        <span className="win__sub-icon win__sub-icon--blue">◆</span>
        <span className="win__sub-name">research-api-limits</span>
        <span className="win__sub-tag win__sub-tag--done">done · 4s</span>
      </div>
      <div className="win__sub">
        <span className="win__sub-icon win__sub-icon--violet">◆</span>
        <span className="win__sub-name">refactor-auth</span>
        <span className="win__sub-tag win__sub-tag--run">running</span>
      </div>
      <div className="win__sub">
        <span className="win__sub-icon win__sub-icon--amber">◆</span>
        <span className="win__sub-name">write-migration</span>
        <span className="win__sub-tag win__sub-tag--run">running</span>
      </div>
      <div className="win__sub-report">
        <span className="win__from">report · research-api-limits</span>
        Rate ceiling is 60 req/min — adding a token bucket in <code>client.ts</code>.
      </div>
    </div>
  </WinChrome>
)

export const PrMock = () => (
  <WinChrome title="atelier — pull request #142" badge="opened">
    <div className="win__pr">
      <div className="win__pr-head">
        <span className="win__pr-state">● open</span>
        <span className="win__pr-title">fix: round cart total to prevent drift</span>
      </div>
      <div className="win__pr-meta">
        +9 −3 · 1 file · base <code>main</code>
      </div>
      <div className="win__pr-checks">
        <span className="win__check win__check--pass">✓ ci</span>
        <span className="win__check win__check--pass">✓ tests</span>
        <span className="win__check win__check--pass">✓ lint</span>
      </div>
      <div className="win__pr-actions">
        <span className="win__pr-cta">Merge pull request</span>
        <span className="win__pr-ship">ship ↗</span>
      </div>
    </div>
  </WinChrome>
)

export const ProcessMock = () => (
  <WinChrome title="atelier — session · how-it-works" badge="4 steps · live">
    <div className="win__steps">
      <div className="win__step win__step--done">
        <span className="win__step-n">1</span>
        <div>
          <span className="win__step-title">Connect a repo</span>
          <span className="win__step-text">GitHub OAuth → fresh clone in sandbox</span>
        </div>
        <span className="win__step-tag win__step-tag--done">done</span>
      </div>
      <div className="win__step win__step--done">
        <span className="win__step-n">2</span>
        <div>
          <span className="win__step-title">Bring your key</span>
          <span className="win__step-text">AES-256-GCM at rest, sealed-box to sandbox</span>
        </div>
        <span className="win__step-tag win__step-tag--done">done</span>
      </div>
      <div className="win__step win__step--run">
        <span className="win__step-n">3</span>
        <div>
          <span className="win__step-title">Chat with your agent</span>
          <span className="win__step-text">streamed edits · terminal · todos · subagents</span>
        </div>
        <span className="win__step-tag win__step-tag--run">running</span>
      </div>
      <div className="win__step win__step--next">
        <span className="win__step-n">4</span>
        <div>
          <span className="win__step-title">Review &amp; ship</span>
          <span className="win__step-text">approve → branch → pull request</span>
        </div>
        <span className="win__step-tag win__step-tag--next">queued</span>
      </div>
    </div>
    <div className="win__term">
      <div className="win__term-label">timeline</div>
      <div className="win__term-line">
        <span className="t-pass">✓</span> connected <code>checkout-flow</code>
      </div>
      <div className="win__term-line">
        <span className="t-pass">✓</span> key sealed <span className="t-dim">(4s)</span>
      </div>
      <div className="win__term-line">
        <span className="t-prompt">→</span> driving turn 3…
      </div>
    </div>
  </WinChrome>
)
