// ponytail: full-page landing view that composes the ported landing
// components (HeroMockup, Reveal, SectionTag/Title/Sub, icons, mockups)
// with the CONTENT (copy, features, faqs, plans) ported leanly from
// Atelier-Landing/components/App.tsx. No new deps — React + framer-motion.
//
// The `onBack` prop returns to the workspaces list (authed) or triggers
// sign-in (the parent App owns view state). Rendered OUTSIDE AppShell
// and BEFORE the auth gate, so logged-out visitors can view it.

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  HeroMockup,
  Reveal,
  Check,
  featureIcons,
  toolIcons,
  SectionTag,
  SectionTitle,
  SectionSub,
  ChatMock,
  DiffMock,
  SubMock,
  PrMock,
  ProcessMock,
} from "../components/landing"

const easeOut: [number, number, number, number] = [0.21, 0.47, 0.32, 0.98]

// ponytail: content data — ported verbatim from the landing reference
const features = [
  { icon: "model", title: "Any model, your key", text: "OpenAI, Anthropic, local — bring any compatible endpoint. Atelier never marks up the model." },
  { icon: "approve", title: "Approve every change", text: "Human-in-the-loop by default. See the diff and tool call before the agent acts — or flip on autopilot." },
  { icon: "plan", title: "Plan before it codes", text: "The agent drafts an approach first, so you can redirect before a line is written." },
  { icon: "index", title: "Whole-repo context", text: "Semantic codebase mapping finds the right files and lines — no manual context picking." },
  { icon: "mcp", title: "MCP & integrations", text: "Connect GitHub, Linear, Slack, and any MCP server. The agent reaches your tools, not just your files." },
  { icon: "lock", title: "Your code stays yours", text: "No training on your repo. Sandboxed egress allowlist, secrets in a sealed box, never machine env." },
  { icon: "cloud", title: "Background tasks", text: "Hand off long-running work — the agent keeps going while you move on, then reports back." },
  { icon: "voice", title: "Speak a task", text: "Voice input in the composer. Dictate the bug, the agent writes the fix." },
]

const plans = [
  {
    label: "#BYOK + BYOC", title: "Free", price: "$0", cta: "Start free",
    features: ["Your model key", "Your compute credits", "All features", "Unlimited workspaces", "Community support"],
  },
  {
    label: "#Hosted", title: "Plus", price: "$6", cta: "Open the app",
    features: ["20 hrs / month", "1 vCPU · 2 GB", "Hosted compute", "All features", "Community support"],
  },
  {
    label: "#Hosted", title: "Pro", price: "$10", cta: "Open the app",
    features: ["40 hrs / month", "2 vCPU · 2 GB", "Hosted compute", "All features", "Priority support"],
  },
  {
    label: "#Hosted", title: "Max", price: "$25", cta: "Open the app",
    features: ["140 hrs / month", "2 vCPU · 4 GB", "Hosted compute", "All features", "Priority support"],
  },
]

const faqs = [
  { q: "What is Atelier?", a: "An open-source, chat-first agentic coding platform. You import a GitHub repo, chat with an agent in your browser, and it edits code, runs the terminal, manages todos, spawns subagents, and ships a PR — from an isolated cloud sandbox." },
  { q: "What does bring-your-own-key mean?", a: "You paste any OpenAI- or Anthropic-compatible endpoint key. Your key is AES-256-GCM encrypted at rest and only ever decrypted inside the sealed-box handshake to the sandbox — it is never sent to us beyond your control plane." },
  { q: "What is bring-your-own-compute?", a: "On the free plan, Atelier runs your agent sandbox on YOUR E2B or Daytona credits instead of operator-hosted compute. We never mark up compute — you pay your provider directly." },
  { q: "Is my code safe?", a: "Each session gets an isolated sandbox with an nftables egress allowlist (DNS + HTTPS to the model endpoint, GitHub, and the control plane only). Secrets ride the sealed-box handshake, never the machine env, and fail-closed if the firewall cannot apply." },
  { q: "Is it open source?", a: "Yes — MIT licensed and self-hostable, so you can run the control plane, runner image, and PWA yourself. The repo lives at github.com/3li-jpg/Atelier-App." },
]

const portfolio = [
  { tag: "#From the studio", title: "Chat workspace", mock: ChatMock },
  { tag: "#From the studio", title: "Live diffs & terminal", mock: DiffMock },
  { tag: "#From the studio", title: "Subagents", mock: SubMock },
  { tag: "#From the studio", title: "PR shipping", mock: PrMock },
]

// ponytail: Nav — lean port of the landing nav. Scroll state + CTA.
function Nav({ onBack }: { onBack: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  return (
    <motion.header
      className={`nav ${scrolled ? "nav--scrolled" : ""}`}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: easeOut }}
    >
      <div className="nav__inner">
        <a href="#top" className="nav__logo">Atelier</a>
        <nav className="nav__links">
          <a href="#portfolio">Work</a>
          <a href="#about">How it works</a>
          <a href="#faqs">FAQs</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="nav__actions">
          <button className="btn btn--dark nav__cta" onClick={onBack}>Open the app</button>
        </div>
      </div>
    </motion.header>
  )
}

// ponytail: Hero — HeroMockup + headline + CTA. No scroll parallax (kept lean).
function Hero({ onBack }: { onBack: () => void }) {
  return (
    <section className="hero" id="top">
      <div className="hero__inner">
        <motion.div
          className="hero__left"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: easeOut }}
        >
          <h2 className="hero__headline">
            The <span className="hero__sketch">workshop</span> where <span className="hero__sketch">agents</span> ship your <span className="hero__sketch">code</span>.
          </h2>
          <p className="hero__sub">Open-source and chat-first. Bring your model key, bring your repo, ship from any browser.</p>
          <div className="hero__btns">
            <button className="btn btn--dark" onClick={onBack}>Enter Atelier →</button>
            <a
              href="https://github.com/3li-jpg/Atelier-App"
              target="_blank"
              rel="noreferrer"
              className="pill"
            >
              Star on GitHub
            </a>
          </div>
        </motion.div>
        <motion.div
          className="hero__window"
          initial={{ opacity: 0, scale: 0.92, y: 60 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 80, damping: 18, delay: 0.35 }}
        >
          <HeroMockup />
        </motion.div>
      </div>
    </section>
  )
}

// ponytail: Portfolio — grid of mockup cards (reuse ported mockups).
function Portfolio({ onBack }: { onBack: () => void }) {
  return (
    <section className="section portfolio" id="portfolio">
      <div className="portfolio__grid">
        <div className="portfolio__intro">
          <Reveal>
            <SectionTag>#From the studio</SectionTag>
            <SectionTitle>Recent work from the studio</SectionTitle>
            <SectionSub>Every workspace is a chat that edits code, runs the terminal, and opens a PR.</SectionSub>
            <button className="btn btn--dark" onClick={onBack}>Start free →</button>
          </Reveal>
        </div>
        <div className="portfolio__cards">
          {portfolio.map((p, i) => {
            const Mock = p.mock
            return (
              <motion.div
                key={p.title}
                initial={{
                  opacity: 0,
                  x: i % 2 === 0 ? 140 : -140,
                  y: i < 2 ? 90 : -90,
                  rotate: [-8, 7, 10, -6][i],
                  scale: 0.92,
                }}
                whileInView={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ type: "spring", stiffness: 70, damping: 14, delay: i * 0.06 }}
              >
                <div className="project-card">
                  <div className="project-card__img">
                    <Mock />
                  </div>
                  <div className="project-card__meta">
                    <p className="doodle project-card__tag">{p.tag}</p>
                    <p className="project-card__title">{p.title}</p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ponytail: About — tool tiles + steps grid + ProcessMock. Lean port.
function About() {
  const steps = [
    { n: 1, title: "Connect a repo", text: "Sign in with GitHub OAuth and pick any repository — your agent works against a fresh clone in its own sandbox." },
    { n: 2, title: "Bring your key", text: "Add any OpenAI- or Anthropic-compatible endpoint. Your key is encrypted at rest and never placed in the sandbox machine env." },
    { n: 3, title: "Chat with your agent", text: "Each message drives one turn: streamed edits, terminal output, a live todo list, and subagents spawned for big tasks." },
    { n: 4, title: "Review & ship", text: "Read the diffs, approve tool calls, then the agent commits to a branch and pushes a pull request — all from the chat." },
  ]
  return (
    <section className="section about" id="about">
      <Reveal>
        <SectionTag>#The process</SectionTag>
        <SectionTitle>How Atelier works</SectionTitle>
      </Reveal>
      <div className="about__grid">
        <div className="about__left">
          <Reveal>
            <p className="doodle about__label">Connects to</p>
          </Reveal>
          <div className="about__tools">
            {Object.entries(toolIcons).map(([name, icon], i) => (
              <motion.div
                className="tool-tile"
                key={name}
                title={name}
                initial={{ opacity: 0, x: i * -56, scale: 0.8 }}
                whileInView={{ opacity: 1, x: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ type: "spring", stiffness: 160, damping: 16, delay: i * 0.07 }}
              >
                {icon}
              </motion.div>
            ))}
          </div>
          <Reveal delay={100}>
            <p className="doodle about__label">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ verticalAlign: "-6px", marginRight: "6px" }}>
                <rect x="3" y="3" width="22" height="22" rx="4" stroke="currentColor" strokeWidth="2" fill="none" />
                <path d="M8 14l4 4 8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              Work Process
            </p>
          </Reveal>
          <div className="about__steps">
            {steps.map((s, i) => (
              <motion.div
                className="step-card"
                key={s.n}
                initial={{
                  opacity: 0,
                  x: i % 2 === 0 ? 90 : -90,
                  y: i < 2 ? 50 : -50,
                  rotate: [-6, 5, 8, -5][i],
                  scale: 0.94,
                }}
                whileInView={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ type: "spring", stiffness: 80, damping: 15, delay: i * 0.08 }}
              >
                <p className="doodle step-card__tag">#Step {s.n}</p>
                <p className="step-card__title">{s.title}</p>
                <p className="step-card__text">{s.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <Reveal className="about__right" delay={150}>
          <div className="about__photo">
            <ProcessMock />
            <span className="doodle about__hi">Ship it :)</span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ponytail: Features — feature grid using featureIcons + ported primitives.
function Features() {
  return (
    <section className="section features" id="features">
      <Reveal className="section__center">
        <SectionTag>#What it does</SectionTag>
        <SectionTitle>Everything you&apos;d expect<br />from an agent that ships</SectionTitle>
        <SectionSub>Table-stakes capabilities, open-source and self-hostable.</SectionSub>
      </Reveal>
      <div className="features__grid">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            className="feature-card"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: (i % 4) * 0.06, ease: easeOut }}
          >
            <span className="feature-card__icon">{featureIcons[f.icon as keyof typeof featureIcons]}</span>
            <h3 className="feature-card__title">{f.title}</h3>
            <p className="feature-card__text">{f.text}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ponytail: Faq — accordion using useState. Lean port.
function Faq() {
  const [open, setOpen] = useState(-1)
  return (
    <section className="section faq" id="faqs">
      <Reveal className="section__center">
        <SectionTag>#Questions</SectionTag>
        <SectionTitle>Frequently asked</SectionTitle>
        <SectionSub>The basics on keys, compute, security, and open source.</SectionSub>
      </Reveal>
      <div className="faq__list">
        {faqs.map((f, i) => (
          <motion.div
            key={f.q}
            initial={{ opacity: 0, scaleX: 0.7, y: 20 }}
            whileInView={{ opacity: 1, scaleX: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.6, delay: i * 0.06, ease: easeOut }}
          >
            <div className={`faq__item ${open === i ? "faq__item--open" : ""}`}>
              <button className="faq__row" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="doodle faq__qmark" aria-hidden="true">?</span>
                <span className="faq__question">{f.q}</span>
                <span className="doodle faq__x" aria-hidden="true">{open === i ? "−" : "+"}</span>
              </button>
              <div className="faq__answer"><p>{f.a}</p></div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ponytail: Pricing — plan cards. CTAs call onBack (enter the app).
function Pricing({ onBack }: { onBack: () => void }) {
  return (
    <section className="section pricing" id="pricing">
      <Reveal className="section__center">
        <SectionTag>#Pricing</SectionTag>
        <SectionTitle>Pricing that scales<br />with your build</SectionTitle>
        <SectionSub>
          Free is BYOK + BYOC — your key, your compute.<br />
          Paid plans add hosted compute hours.
        </SectionSub>
      </Reveal>
      <div className="pricing__cards pricing__cards--four">
        {plans.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, x: i % 2 === 0 ? 90 : -90, y: 40, scale: 0.9 }}
            whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ type: "spring", stiffness: 75, damping: 15, delay: i * 0.08 }}
          >
            <div className="price-card">
              <p className="doodle price-card__label">{p.label}</p>
              <h3 className="price-card__title">{p.title}</h3>
              <p className="doodle price-card__price">{p.price}</p>
              <button className="btn btn--dark" onClick={onBack}>{p.cta}</button>
              <div className="price-card__features">
                {p.features.map((feat) => (
                  <div className="price-card__feature" key={feat}>
                    <Check />
                    <span>{feat}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ponytail: Footer — lean port. CTA calls onBack.
function Footer({ onBack }: { onBack: () => void }) {
  const GITHUB_URL = "https://github.com/3li-jpg/Atelier-App"
  return (
    <footer className="footer-wrap">
      <div className="footer">
        <div className="footer__top">
          <Reveal className="footer__left">
            <p className="footer__logo">Atelier</p>
            <p className="doodle section__tag">#Get started</p>
            <h2 className="footer__title">Open a workspace today.</h2>
            <p className="section__sub">BYOK + BYOC free plan. Ship a PR from any browser.</p>
            <button className="btn btn--dark" onClick={onBack}>Open the app</button>
          </Reveal>
          <Reveal className="footer__right" delay={120}>
            <p className="footer__socials-label">Follow along</p>
            <div className="footer__socials">
              <a href="https://x.com" target="_blank" rel="noreferrer" className="pill">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2H8l4.4 5.9L18.9 2zm-1.1 18h1.7L7.1 3.9H5.3L17.8 20z" />
                </svg>
                Twitter/X
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="pill">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1.5A10.5 10.5 0 0 0 8.6 21.9c.5.1.7-.2.7-.5v-1.7c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.2-4.7-5.2 0-1.1.4-2 1-2.8-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.7 1 2.8 0 4-2.4 4.9-4.7 5.2.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z" />
                </svg>
                GitHub
              </a>
            </div>
            <div className="footer__cols">
              <div>
                <p className="footer__col-title">Pages</p>
                <a href="#top">Home</a>
                <a href="#pricing">Pricing</a>
                <a href="#faqs">FAQs</a>
                <a href="#about">How it works</a>
              </div>
              <div>
                <p className="footer__col-title">Product</p>
                <button className="footer__link-btn" onClick={onBack}>Open the app</button>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
                <a href={GITHUB_URL + "#readme"} target="_blank" rel="noreferrer">Docs</a>
              </div>
              <div>
                <p className="footer__col-title">Legal / Meta</p>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">MIT License</a>
                <a href="#top">© 2026 Atelier</a>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
      <div className="footer__bottom">
        <p>©2026 Atelier. MIT licensed, open source.</p>
        <p><a href="https://studioatelier.ca">studioatelier.ca</a></p>
      </div>
    </footer>
  )
}

export function LandingView({ onBack }: { onBack: () => void }) {
  return (
    <div className="landing-page" style={{ minHeight: "100%" }}>
      <Nav onBack={onBack} />
      <main>
        <Hero onBack={onBack} />
        <Portfolio onBack={onBack} />
        <About />
        <Features />
        <Faq />
        <Pricing onBack={onBack} />
      </main>
      <Footer onBack={onBack} />
    </div>
  )
}
