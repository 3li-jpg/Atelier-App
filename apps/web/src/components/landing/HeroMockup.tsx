/**
 * HeroMockup — the signature IDE mockup from the landing hero.
 * Ported from the `.hero-mockup` block: chrome with titlebar + badge,
 * body grid with sidebar (AGENT label, user/agent message bubbles,
 * tool rows, input bar) and editor (tabs, code lines with line numbers,
 * terminal pane).
 *
 * Accepts optional props to override the sample text, defaulting to
 * the landing's original copy.
 */

export interface HeroMockupProps {
  titlebar?: string
  badge?: string
  sidebarLabel?: string
  userMessage?: string
  agentMessage?: React.ReactNode
  tool1Name?: string
  tool1Diff?: string
  tool2Name?: string
  tool2Status?: string
  inputPlaceholder?: string
  activeTab?: string
  inactiveTab?: string
  terminalLabel?: string
  terminalLines?: React.ReactNode
}

const defaultAgentMessage = (
  <>
    I&apos;ll update <code className="hero-mockup__inline-code">HibernationFSM.ts</code> and flip state before the request resolves, rolling back on error.
  </>
)

const defaultTerminalLines = (
  <>
    <div className="hero-mockup__terminal-line">
      <span className="t-prompt">$</span> npm test <span className="t-flag">--</span> hibernation
    </div>
    <div className="hero-mockup__terminal-line">
      <span className="t-pass">✓</span> suspends after idle threshold <span className="t-dim">(12 ms)</span>
    </div>
    <div className="hero-mockup__terminal-line">
      <span className="t-pass">✓</span> rolls back state on suspend error <span className="t-dim">(8 ms)</span>
    </div>
    <div className="hero-mockup__terminal-line">
      <span className="t-pass">Tests:</span> <span className="t-result">2 passed</span>, 2 total
    </div>
    <div className="hero-mockup__terminal-cursor">▍</div>
  </>
)

const defaultCodeLines = (
  <>
    <div className="hero-mockup__line hero-mockup__line--muted">
      <span className="hero-mockup__ln">18</span>
      <span className="t-kw">export</span> <span className="t-kw">function</span> <span className="t-fn">suspendIdle</span>(s<span className="t-op">:</span> <span className="t-type">Session</span>) &#123;
    </div>
    <div className="hero-mockup__line hero-mockup__line--muted">
      <span className="hero-mockup__ln">19</span>
      {"  "}<span className="t-kw">if</span> (s.idleMs <span className="t-op">&gt;</span> <span className="t-num">30_000</span>) &#123;
    </div>
    <div className="hero-mockup__line hero-mockup__line--add">
      <span className="hero-mockup__ln">20</span>
      {"    "}s.<span className="t-fn">setState</span>(<span className="t-str">&apos;suspended&apos;</span>)<span className="t-op">;</span> <span className="t-comment">// optimistic</span>
    </div>
    <div className="hero-mockup__line hero-mockup__line--muted">
      <span className="hero-mockup__ln">21</span>
      {"    "}<span className="t-kw">await</span> <span className="t-fn">fly</span>.machines.<span className="t-fn">suspend</span>(s.vmId)<span className="t-op">;</span>
    </div>
    <div className="hero-mockup__line hero-mockup__line--muted">
      <span className="hero-mockup__ln">22</span>
      {"  "}&#125;
    </div>
    <div className="hero-mockup__line hero-mockup__line--muted">
      <span className="hero-mockup__ln">23</span>
      &#125;
    </div>
  </>
)

export function HeroMockup(props: HeroMockupProps) {
  const {
    titlebar = "atelier — session · atelier-sandboxes/vm-7f3a",
    badge = "Fable 5 · active",
    sidebarLabel = "Agent",
    userMessage = "Add optimistic UI to the session hibernation toggle.",
    agentMessage = defaultAgentMessage,
    tool1Name = "edit · suspend.ts",
    tool1Diff = "+18 −4",
    tool2Name = "run · npm test",
    tool2Status = "done",
    inputPlaceholder = "Dictate a task…",
    activeTab = "HibernationFSM.ts",
    inactiveTab = "suspend.ts",
    terminalLabel = "terminal",
    terminalLines = defaultTerminalLines,
  } = props

  return (
    <div className="hero-mockup">
      <div className="hero-mockup__chrome">
        <span className="hero-mockup__dot hero-mockup__dot--red" />
        <span className="hero-mockup__dot hero-mockup__dot--yellow" />
        <span className="hero-mockup__dot hero-mockup__dot--green" />
        <span className="hero-mockup__titlebar">{titlebar}</span>
        <span className="hero-mockup__badge">{badge}</span>
      </div>
      <div className="hero-mockup__body">
        <div className="hero-mockup__sidebar">
          <div className="hero-mockup__sidebar-label">{sidebarLabel}</div>
          <div className="hero-mockup__msg hero-mockup__msg--user">
            <div className="hero-mockup__msg-from">you</div>
            <div className="hero-mockup__msg-text">{userMessage}</div>
          </div>
          <div className="hero-mockup__msg hero-mockup__msg--agent">
            <div className="hero-mockup__msg-from hero-mockup__msg-from--agent">atelier</div>
            <div className="hero-mockup__msg-text">{agentMessage}</div>
          </div>
          <div className="hero-mockup__tool">
            <span className="hero-mockup__tool-icon hero-mockup__tool-icon--edit">✎</span>
            <span className="hero-mockup__tool-name">{tool1Name}</span>
            <span className="hero-mockup__tool-diff hero-mockup__tool-diff--add">{tool1Diff}</span>
          </div>
          <div className="hero-mockup__tool">
            <span className="hero-mockup__tool-icon hero-mockup__tool-icon--term">▌</span>
            <span className="hero-mockup__tool-name">{tool2Name}</span>
            <span className="hero-mockup__tool-status">{tool2Status}</span>
          </div>
          <div className="hero-mockup__input">
            <span className="hero-mockup__input-mic">●</span>
            <span className="hero-mockup__input-text">{inputPlaceholder}</span>
            <span className="hero-mockup__input-send">↑</span>
          </div>
        </div>
        <div className="hero-mockup__editor">
          <div className="hero-mockup__tabs">
            <div className="hero-mockup__tab hero-mockup__tab--active">{activeTab}</div>
            <div className="hero-mockup__tab">{inactiveTab}</div>
          </div>
          <div className="hero-mockup__code">{defaultCodeLines}</div>
          <div className="hero-mockup__terminal">
            <div className="hero-mockup__terminal-label">{terminalLabel}</div>
            {terminalLines}
          </div>
        </div>
      </div>
    </div>
  )
}
