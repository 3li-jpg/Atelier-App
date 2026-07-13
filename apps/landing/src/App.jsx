import { useEffect, useRef, useState } from 'react'
import { motion, MotionConfig, useScroll, useTransform } from 'framer-motion'

/* ponytail: app URL resolved once; env is optional, falls back to dev PWA port */
const APP_URL = import.meta.env.VITE_DASHBOARD_URL ?? 'http://localhost:5173'
const GITHUB_URL = 'https://github.com/3li-jpg/Atelier-App'

/* ---------- small helpers ---------- */

const easeOut = [0.21, 0.47, 0.32, 0.98]

function Reveal({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 44, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, delay: delay / 1000, ease: easeOut }}
    >
      {children}
    </motion.div>
  )
}

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M4 13l5 5L21 5" stroke="#009dff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const Star = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#009dff">
    <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8L12 2z" />
  </svg>
)

/* ---------- data ---------- */

const projects = [
  { tag: '#Feature', title: 'Chat workspace', img: '/proj2.png' },
  { tag: '#Feature', title: 'Live diffs & terminal', img: '/proj4.png' },
  { tag: '#Feature', title: 'Subagents', img: '/proj3.png' },
  { tag: '#Feature', title: 'PR shipping', img: '/proj1.png' },
]

const steps = [
  { n: 1, title: 'Connect a repo', text: 'Sign in with GitHub OAuth and pick any repository — your agent works against a fresh clone in its own sandbox.' },
  { n: 2, title: 'Bring your key', text: 'Add any OpenAI- or Anthropic-compatible endpoint. Your key is encrypted at rest and never placed in the sandbox machine env.' },
  { n: 3, title: 'Chat with your agent', text: 'Each message drives one turn: streamed edits, terminal output, a live todo list, and subagents spawned for big tasks.' },
  { n: 4, title: 'Review & ship', text: 'Read the diffs, approve tool calls, then the agent commits to a branch and pushes a pull request — all from the chat.' },
]

const faqs = [
  { q: 'What is Atelier?', a: 'An open-source, chat-first agentic coding platform. You import a GitHub repo, chat with an agent in your browser, and it edits code, runs the terminal, manages todos, spawns subagents, and ships a PR — from an isolated cloud sandbox.' },
  { q: 'What does bring-your-own-key mean?', a: 'You paste any OpenAI- or Anthropic-compatible endpoint key. Your key is AES-256-GCM encrypted at rest and only ever decrypted inside the sealed-box handshake to the sandbox — it is never sent to us beyond your control plane.' },
  { q: 'What is bring-your-own-compute?', a: 'On the free plan, Atelier runs your agent sandbox on YOUR E2B or Daytona credits instead of operator-hosted compute. We never mark up compute — you pay your provider directly.' },
  { q: 'Is my code safe?', a: 'Each session gets an isolated sandbox with an nftables egress allowlist (DNS + HTTPS to the model endpoint, GitHub, and the control plane only). Secrets ride the sealed-box handshake, never the machine env, and fail-closed if the firewall cannot apply.' },
  { q: 'Is it open source?', a: 'Yes — MIT licensed and self-hostable, so you can run the control plane, runner image, and PWA yourself. The repo lives at github.com/3li-jpg/Atelier-App.' },
]

/* product-highlight cards (no invented people): capability text + a real-feature label */
const highlights = [
  { text: 'A persistent chat against a cloned repo — every message drives the agent one turn, with streamed edits, terminal, todos, and approvals.', label: 'Chat workspaces', role: 'core feature' },
  { text: 'Complex tasks fan out to isolated-context subagents in parallel or background modes, then report back into the same timeline.', label: 'Subagents', role: 'hermes delegation' },
  { text: 'Free-plan sandboxes run on your own E2B or Daytona credits — bring a key in Settings and Atelier uses it for your sessions.', label: 'BYOC', role: 'E2B & Daytona' },
]

const plans = [
  {
    label: '#BYOK + BYOC', title: 'Free', price: '$0', cta: 'Start free',
    features: ['Your model key', 'Your compute credits', 'All features', 'Unlimited workspaces', 'Community support'],
  },
  {
    label: '#Hosted', title: 'Plus', price: '$6', cta: 'Open the app',
    features: ['20 hrs / month', '1 vCPU · 2 GB', 'Hosted compute', 'All features', 'Community support'],
  },
  {
    label: '#Hosted', title: 'Pro', price: '$10', cta: 'Open the app',
    features: ['40 hrs / month', '2 vCPU · 2 GB', 'Hosted compute', 'All features', 'Priority support'],
  },
  {
    label: '#Hosted', title: 'Max', price: '$25', cta: 'Open the app',
    features: ['140 hrs / month', '2 vCPU · 4 GB', 'Hosted compute', 'All features', 'Priority support'],
  },
]

/* ---------- sections ---------- */

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <motion.header
      className={`nav ${scrolled ? 'nav--scrolled' : ''}`}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: easeOut }}
    >
      <div className="nav__inner">
        <a href="#top" className="nav__logo">Atelier</a>
        <nav className="nav__links">
          <a href="#about">How it works</a>
          <a href="#faqs">FAQs</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </nav>
        <a href={APP_URL} className="btn btn--dark nav__cta">Open the app</a>
      </div>
    </motion.header>
  )
}

function Hero() {
  const [flipped, setFlipped] = useState(false)
  const heroRef = useRef(null)
  const downPos = useRef(null)
  const { scrollY } = useScroll()
  const bigY = useTransform(scrollY, [0, 900], [0, 260])
  const bigScale = useTransform(scrollY, [0, 900], [1, 1.08])
  const stageY = useTransform(scrollY, [0, 900], [0, -120])
  return (
    <section className="hero" id="top" ref={heroRef}>
      <motion.h1
        className="hero__bigname"
        style={{ y: bigY, scale: bigScale, x: '-50%' }}
        initial={{ opacity: 0, y: 120 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.3, ease: easeOut }}
      >
        Atelier
      </motion.h1>
      <motion.div className="hero__stage" style={{ y: stageY }}>
        <motion.span
          className="doodle hero__role"
          initial={{ opacity: 0, scale: 0.5, rotate: 44 }}
          animate={{ opacity: 1, scale: 1, rotate: 28 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.7 }}
        >
          Agentic<br />coding
        </motion.span>
        <motion.div
          className={`flipcard ${flipped ? 'flipcard--flipped' : ''}`}
          drag
          dragConstraints={heroRef}
          dragElastic={0.12}
          dragSnapToOrigin
          dragTransition={{ bounceStiffness: 160, bounceDamping: 13 }}
          whileDrag={{ scale: 1.05, rotate: 3 }}
          whileHover={{ scale: 1.02 }}
          onPointerDown={e => { downPos.current = [e.clientX, e.clientY] }}
          onPointerUp={e => {
            const [x, y] = downPos.current ?? [0, 0]
            if (Math.hypot(e.clientX - x, e.clientY - y) < 8) setFlipped(f => !f)
          }}
        >
          <motion.div
            className="flipcard__enter"
            initial={{ opacity: 0, scale: 0.6, rotate: -10, y: 90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
            transition={{ type: 'spring', stiffness: 90, damping: 15, delay: 0.15 }}
          >
          <motion.div
            className="flipcard__float"
            animate={{ y: [0, -12, 0], rotate: [0, 1.4, 0, -1.4, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
          >
          <motion.span
            className="doodle hero__clickme"
            initial={{ opacity: 0, x: 20, rotate: -30 }}
            animate={{ opacity: 1, x: 0, rotate: -16 }}
            transition={{ duration: 0.7, delay: 0.9, ease: easeOut }}
          >
            Click me
            <svg width="26" height="34" viewBox="0 0 26 34" fill="none">
              <path d="M14 2c-6 5 4 7-2 12s3 8-3 13" stroke="#009dff" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 24l5 4-6 3" stroke="#009dff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </motion.span>
          <div className="flipcard__inner">
            <div className="flipcard__face flipcard__front">
              <img src="/hero-card.png" alt="Atelier" draggable="false" />
              <span className="flipcard__name">Atelier</span>
            </div>
            <div className="flipcard__face flipcard__back">
              <p className="flipcard__backname">Atelier</p>
              <div className="flipcard__block">
                <p className="flipcard__label">What the agent does</p>
                <ul>
                  <li>Edits files &amp; runs tests</li>
                  <li>Drives the terminal</li>
                  <li>Plans with todos</li>
                  <li>Ships PRs</li>
                </ul>
              </div>
              <div className="flipcard__block">
                <p className="flipcard__label">Runs on</p>
                <ul>
                  <li>Your model key</li>
                  <li>Your compute</li>
                  <li>Isolated sandboxes</li>
                </ul>
              </div>
            </div>
          </div>
          </motion.div>
          </motion.div>
        </motion.div>
        <motion.div
          className="hero__cta"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.1, ease: easeOut }}
        >
          <p className="hero__sub">Open-source, chat-first agentic coding. Bring your model key, bring your repo, ship from any browser.</p>
          <div className="hero__btns">
            <a href={APP_URL} className="btn btn--dark">Start free →</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="pill">Star on GitHub</a>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}

function Portfolio() {
  return (
    <section className="section portfolio" id="portfolio">
      <div className="portfolio__grid">
        <div className="portfolio__intro">
          <Reveal>
            <p className="doodle section__tag">#Built by agents</p>
            <h2 className="section__title">What your agent can ship</h2>
            <p className="section__sub">Every workspace is a chat that edits code, runs the terminal, and opens a PR. Placeholders for now — swap in real screenshots later.</p>
            <a href={APP_URL} className="btn btn--dark">Start free →</a>
            <span className="doodle portfolio__getstarted">
              <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
                <path d="M4 22C10 20 8 8 18 6c6-1 6 6 2 7s-5-6 1-9c3-1.5 7-1 9 0" stroke="#009dff" strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
              Get started
            </span>
          </Reveal>
        </div>
        <div className="portfolio__cards">
          {projects.map((p, i) => (
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
              transition={{ type: 'spring', stiffness: 70, damping: 14, delay: i * 0.06 }}
            >
              <div className="project-card">
                <div className="project-card__img">
                  <img src={p.img} alt={p.title} loading="lazy" />
                </div>
                <div className="project-card__meta">
                  <p className="doodle project-card__tag">{p.tag}</p>
                  <p className="project-card__title">{p.title}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

const toolIcons = {
  GitHub: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="#009dff" stroke="none">
      <path d="M12 1.5A10.5 10.5 0 0 0 8.6 21.9c.5.1.7-.2.7-.5v-1.7c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.2-4.7-5.2 0-1.1.4-2 1-2.8-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.7 1 2.8 0 4-2.4 4.9-4.7 5.2.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z" />
    </svg>
  ),
  Chat: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#009dff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-1.3 4.5 8.5 8.5 0 0 1-7.2 4 8.4 8.4 0 0 1-4.5-1.3L3 20l1.4-5A8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z" />
    </svg>
  ),
  Terminal: (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#009dff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="M6 9l3.5 3L6 15M12 15h6" />
    </svg>
  ),
}

function About() {
  return (
    <section className="section about">
      <Reveal>
        <p className="doodle section__tag">#Stack and Process</p>
        <h2 className="section__title">How Atelier works</h2>
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
                transition={{ type: 'spring', stiffness: 160, damping: 16, delay: i * 0.07 }}
              >
                {icon}
              </motion.div>
            ))}
          </div>
          <Reveal delay={100}>
            <p className="doodle about__label">Work Process</p>
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
                transition={{ type: 'spring', stiffness: 80, damping: 15, delay: i * 0.08 }}
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
            <img src="/about-photo.png" alt="Atelier studio" loading="lazy" />
            <span className="doodle about__hi">Ship it :)</span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Marquee() {
  const row = txt => Array.from({ length: 4 }, (_, i) => <span key={i}>{txt}</span>)
  return (
    <motion.section
      className="marquee"
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.8, ease: easeOut }}
    >
      <div className="marquee__big">
        <div className="marquee__track marquee__track--slow">{row('YOUR CODE · ANY BROWSER · WITH AI AGENTS ')}</div>
      </div>
      <div className="marquee__divider" />
      <div className="marquee__tags">
        <div className="marquee__track marquee__track--reverse">{row('#BYOK #BYOC #OpenSource #ChatWorkspaces ')}</div>
      </div>
    </motion.section>
  )
}

function Faq() {
  const [open, setOpen] = useState(-1)
  return (
    <section className="section faq" id="faqs">
      <Reveal className="section__center">
        <p className="doodle section__tag">#Questions</p>
        <h2 className="section__title">Frequently asked</h2>
        <p className="section__sub">The basics on keys, compute, security, and open source.</p>
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
            <div className={`faq__item ${open === i ? 'faq__item--open' : ''}`}>
              <button className="faq__row" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="doodle faq__qmark" aria-hidden="true">?</span>
                <span className="faq__question">{f.q}</span>
                <span className="doodle faq__x" aria-hidden="true">{open === i ? '−' : '+'}</span>
              </button>
              <div className="faq__answer"><p>{f.a}</p></div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function Pricing() {
  return (
    <section className="section pricing" id="pricing">
      <Reveal className="section__center">
        <p className="doodle section__tag">#Pricing</p>
        <h2 className="section__title">Pricing that scales<br />with your build</h2>
        <p className="section__sub">Free is BYOK + BYOC — your key, your compute.<br />Paid plans add hosted compute hours.</p>
      </Reveal>
      <div className="pricing__cards pricing__cards--four">
        {plans.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, x: i % 2 === 0 ? 90 : -90, y: 40, scale: 0.9 }}
            whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ type: 'spring', stiffness: 75, damping: 15, delay: i * 0.08 }}
          >
            <div className="price-card">
              <p className="doodle price-card__label">{p.label}</p>
              <h3 className="price-card__title">{p.title}</h3>
              <p className="doodle price-card__price">{p.price}</p>
              <a href={APP_URL} className="btn btn--dark">{p.cta}</a>
              <div className="price-card__features">
                {p.features.map(f => (
                  <div className="price-card__feature" key={f}>
                    <Check />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      <span className="doodle pricing__getstarted">
        <svg width="30" height="30" viewBox="0 0 34 26" fill="none">
          <path d="M4 22C10 20 8 8 18 6c6-1 6 6 2 7s-5-6 1-9c3-1.5 7-1 9 0" stroke="#009dff" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
        Get started
      </span>
    </section>
  )
}

function Contact() {
  const [tab, setTab] = useState('message')
  const [form, setForm] = useState({ name: '', email: '', design: '', message: '' })
  const [sent, setSent] = useState(false)
  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const submit = e => {
    e.preventDefault()
    // ponytail: no backend — deliver via the visitor's mail client
    const subject = `Atelier question from ${form.name}${form.design ? ` — ${form.design}` : ''}`
    const body = `${form.message}\n\n— ${form.name} (${form.email})`
    window.location.href = `mailto:ali@studioatelier.ca?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setSent(true)
  }
  const loop = [...highlights, ...highlights]
  return (
    <section className="section contact" id="contact">
      <Reveal className="section__center">
        <p className="doodle section__tag">#Contact</p>
        <h2 className="section__title">Questions about Atelier?</h2>
        <p className="section__sub">Self-hosting, the credits program, or the product itself —<br />reach out and we&rsquo;ll help.</p>
      </Reveal>
      <div className="contact__grid">
        <Reveal className="contact__testimonials">
          <div className="contact__testimonials-track">
            {loop.map((t, i) => (
              <div className="review-card" key={i}>
                <div className="review-card__stars">{Array.from({ length: 5 }, (_, s) => <Star key={s} />)}</div>
                <p className="review-card__text">{t.text}</p>
                <div className="review-card__person">
                  <img src="/hash-icon.png" alt="" loading="lazy" className="review-card__icon" />
                  <div>
                    <p className="review-card__name">{t.label}</p>
                    <p className="review-card__role">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal className="contact__right" delay={120}>
          <div className="contact__tabs">
            <button className={tab === 'message' ? 'active' : ''} onClick={() => setTab('message')}>Send a Message</button>
            <button className={tab === 'call' ? 'active' : ''} onClick={() => setTab('call')}>Book a Call</button>
          </div>
          {tab === 'message' ? (
            <form className="contact__form" onSubmit={submit}>
              <div className="contact__row">
                <label>
                  <span className="doodle">Name</span>
                  <input type="text" placeholder="Jane Smith" value={form.name} onChange={set('name')} required />
                </label>
                <label>
                  <span className="doodle">Email</span>
                  <input type="email" placeholder="jane@example.com" value={form.email} onChange={set('email')} required />
                </label>
              </div>
              <label>
                <span className="doodle">What&rsquo;s this about?</span>
                <input type="text" placeholder="e.g.: Self-hosting, credits, a feature..." value={form.design} onChange={set('design')} />
              </label>
              <label>
                <span className="doodle">Message</span>
                <textarea rows="4" placeholder="Your question" value={form.message} onChange={set('message')} />
              </label>
              <button type="submit" className="btn btn--dark contact__submit">{sent ? 'Sent ✓' : 'Submit'}</button>
            </form>
          ) : (
            <div className="contact__form contact__call">
              <p className="doodle">Book a Call</p>
              <p>Pick a time that works for you and let&rsquo;s talk about Atelier, self-hosting, or the credits program.</p>
              <a className="btn btn--dark" href="mailto:ali@studioatelier.ca?subject=Call%20booking">Schedule a Call</a>
            </div>
          )}
          <span className="doodle contact__doodle">
            Send a Message
            <svg width="24" height="30" viewBox="0 0 26 34" fill="none">
              <path d="M14 2c-6 5 4 7-2 12s3 8-3 13" stroke="#009dff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        </Reveal>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer-wrap">
      <div className="footer">
        <div className="footer__top">
          <Reveal className="footer__left">
            <p className="footer__logo">Atelier</p>
            <p className="doodle section__tag">#Get started</p>
            <h2 className="footer__title">Open a workspace today.</h2>
            <p className="section__sub">BYOK + BYOC free plan. Ship a PR from any browser.</p>
            <a href={APP_URL} className="btn btn--dark">Open the app</a>
            <span className="doodle portfolio__getstarted">
              <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
                <path d="M4 22C10 20 8 8 18 6c6-1 6 6 2 7s-5-6 1-9c3-1.5 7-1 9 0" stroke="#009dff" strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
              Get started
            </span>
          </Reveal>
          <Reveal className="footer__right" delay={120}>
            <p className="footer__socials-label">Follow along</p>
            <div className="footer__socials">
              <a href="https://x.com" target="_blank" rel="noreferrer" className="pill">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1.6 2H8l4.4 5.9L18.9 2zm-1.1 18h1.7L7.1 3.9H5.3L17.8 20z" /></svg>
                Twitter/X
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="pill">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5A10.5 10.5 0 0 0 8.6 21.9c.5.1.7-.2.7-.5v-1.7c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.2-4.7-5.2 0-1.1.4-2 1-2.8-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.7 1 2.8 0 4-2.4 4.9-4.7 5.2.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z" /></svg>
                GitHub
              </a>
            </div>
            <div className="footer__cols">
              <div>
                <p className="footer__col-title">Pages</p>
                <a href="#top">Home</a>
                <a href="#pricing">Pricing</a>
                <a href="#faqs">FAQs</a>
                <a href="#contact">Contact</a>
              </div>
              <div>
                <p className="footer__col-title">Product</p>
                <a href={APP_URL}>Open the app</a>
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

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <Hero />
        <Portfolio />
        <About />
        <Marquee />
        <Faq />
        <Pricing />
        <Contact />
      </main>
      <Footer />
    </MotionConfig>
  )
}
