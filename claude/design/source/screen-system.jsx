// AI Lecturer — Design System Reference Board

const SystemView = () => (
  <div style={{
    width: '100%', height: '100%',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-sans)',
    overflow: 'auto',
  }}>
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: 'var(--space-7) var(--space-6) var(--space-9)' }}>
      <div style={{ marginBottom: 'var(--space-7)' }}>
        <div style={{ fontSize: '10.5px', color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
          Foundations
        </div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-3xl)', fontWeight: 600, letterSpacing: '-0.025em' }}>
          AI Lecturer · Design System
        </h1>
        <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 'var(--fs-md)', lineHeight: 1.55, maxWidth: 620 }}>
          A focused, content-first system for an AI-powered learning notebook. Warm neutrals, single accent color,
          quiet semantic tones, monospaced metadata. Typography is the hero.
        </p>
      </div>

      {/* COLOR */}
      <Section title="Color" subtitle="Light + dark, single accent. Widget rails are hairlines, not fills.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
          <SwatchGroup title="Surface">
            <Swatch name="bg" var="--bg" />
            <Swatch name="bg-elevated" var="--bg-elevated" />
            <Swatch name="bg-subtle" var="--bg-subtle" />
            <Swatch name="bg-hover" var="--bg-hover" />
          </SwatchGroup>
          <SwatchGroup title="Text">
            <Swatch name="text" var="--text" />
            <Swatch name="text-secondary" var="--text-secondary" />
            <Swatch name="text-tertiary" var="--text-tertiary" />
            <Swatch name="text-quaternary" var="--text-quaternary" />
          </SwatchGroup>
          <SwatchGroup title="Accent">
            <Swatch name="accent" var="--accent" />
            <Swatch name="accent-hover" var="--accent-hover" />
            <Swatch name="accent-subtle" var="--accent-subtle" />
            <Swatch name="accent-border" var="--accent-border" />
          </SwatchGroup>
          <SwatchGroup title="Semantic">
            <Swatch name="success" var="--success" />
            <Swatch name="warning" var="--warning" />
            <Swatch name="danger"  var="--danger" />
            <Swatch name="insight" var="--insight" />
          </SwatchGroup>
        </div>
        <div style={{ marginTop: 'var(--space-5)' }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10 }}>
            Widget rail colors (subtle accents per type)
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(widgetMeta).map(([k, m]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ width: 4, height: 18, background: m.color, borderRadius: 2 }} />
                <Icon name={m.icon} size={13} style={{ color: m.color }} />
                <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 500 }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* TYPE */}
      <Section title="Typography" subtitle="Geist for UI and prose, Geist Mono for code & numerics.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <TypeRow size="64px" weight="600" tracking="-0.03em" label="Display · 5xl">Learn anything.</TypeRow>
          <TypeRow size="36px" weight="600" tracking="-0.025em" label="H1 · 3xl">How networks learn</TypeRow>
          <TypeRow size="28px" weight="600" tracking="-0.02em" label="H2 · 2xl">The intuition</TypeRow>
          <TypeRow size="22px" weight="600" tracking="-0.015em" label="H3 · xl">A foggy hillside</TypeRow>
          <TypeRow size="16px" weight="400" tracking="0" label="Body · md" prose>The gradient points in the direction of steepest ascent. Negate it, and you have the direction of steepest descent.</TypeRow>
          <TypeRow size="13px" weight="400" tracking="0" label="Small · sm">Auto-saved · 12s ago</TypeRow>
          <TypeRow size="11px" weight="600" tracking="0.08em" upper label="Eyebrow · xs">Stage 3 of 5</TypeRow>
          <TypeRow size="13px" weight="400" tracking="0" label="Mono · code" mono>theta - lr * grad(theta)</TypeRow>
        </div>
      </Section>

      {/* COMPONENTS */}
      <Section title="Components" subtitle="Buttons, inputs, badges, progress, callouts, code.">
        <ComponentGrid>
          <ComponentCard title="Buttons">
            <Row><Button variant="primary">Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button></Row>
            <Row><Button variant="primary" size="sm">sm</Button><Button variant="primary" size="md">md</Button><Button variant="primary" size="lg">lg</Button></Row>
            <Row><Button variant="primary" leftIcon="plus">New course</Button><Button variant="secondary" rightIcon="arrowRight">Next</Button><Button variant="ghost" leftIcon="play" kbd="⇧⏎">Run</Button></Row>
          </ComponentCard>

          <ComponentCard title="Badges">
            <Row><Badge tone="neutral" dot>Idle</Badge><Badge tone="accent" dot>Active</Badge><Badge tone="success" dot>Done</Badge><Badge tone="warning" dot>Warn</Badge><Badge tone="danger" dot>Error</Badge><Badge tone="insight" dot>Insight</Badge></Row>
            <Row><Badge tone="neutral" size="sm">12 lessons</Badge><Badge tone="accent" size="sm">Pyodide</Badge></Row>
          </ComponentCard>

          <ComponentCard title="Inputs">
            <Input placeholder="Course title…" leftIcon="search" />
            <Input placeholder="With keyboard hint" rightSlot={<Kbd>⌘K</Kbd>} />
          </ComponentCard>

          <ComponentCard title="Progress">
            <div style={{ width: '100%' }}><Progress value={42} label="Course progress" showValue size="sm" /></div>
            <div style={{ width: '100%' }}><SegmentedProgress total={5} done={3} current={3} /></div>
          </ComponentCard>

          <ComponentCard title="Callouts">
            <Callout tone="info" title="Info">Heads-up about something the learner should know.</Callout>
            <Callout tone="warning" title="Watch out">A common pitfall to avoid.</Callout>
            <Callout tone="insight" title="Insight">An "aha" — the why behind the what.</Callout>
          </ComponentCard>

          <ComponentCard title="Code block">
            <CodeBlock code={`def step(theta, grad, lr):\n    return theta - lr * grad`} />
          </ComponentCard>

          <ComponentCard title="Quiz options">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <QuizOption id="A" text="Idle option" />
              <QuizOption id="B" text="Selected" selected />
              <QuizOption id="C" text="Correct answer" correct disabled />
              <QuizOption id="D" text="Wrong answer" incorrect disabled />
            </div>
          </ComponentCard>

          <ComponentCard title="Keyboard shortcuts">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-xs)' }}>
              <ShortcutRow keys={['⌘', 'N']} label="Create new course" />
              <ShortcutRow keys={['⇧', '⏎']} label="Run code cell" />
              <ShortcutRow keys={['⌘', '\\']} label="Toggle sidebar" />
              <ShortcutRow keys={['⌘', '→']} label="Next lesson" />
              <ShortcutRow keys={['?']} label="Show all shortcuts" />
            </div>
          </ComponentCard>
        </ComponentGrid>
      </Section>

      {/* WIDGETS */}
      <Section title="Widget container" subtitle="One shape, many contents — this is what makes the system extensible.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-5)' }}>
          {Object.entries(widgetMeta).map(([k, m]) => (
            <Widget key={k} type={k} title={`Sample ${m.label.toLowerCase()}`}>
              <div style={{ padding: 'var(--space-4) var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
                {k === 'theory'  && 'Long-form prose. Wide column, prose font, room for callouts and KaTeX.'}
                {k === 'demo'    && 'Live, editable visualization with sliders. Reset + collapsible explanation.'}
                {k === 'quiz'    && 'Single- or multi-select. Always shows an explanation, right or wrong.'}
                {k === 'code'    && 'Editor + Run/Check/Reset. Tests as a checklist, output below.'}
                {k === 'sandbox' && "No tests, no grading — just 'try changing X.'"}
                {k === 'custom'  && "Adding a new widget? Same shell, drop your contents in. The accent color is up to you."}
              </div>
            </Widget>
          ))}
        </div>
      </Section>

      {/* SPACING */}
      <Section title="Spacing & radii" subtitle="A 4px base scale that flexes per density mode.">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, padding: 'var(--space-4)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
          {[
            { name: 'space-1', v: 4 },{ name: 'space-2', v: 8 },{ name: 'space-3', v: 12 },{ name: 'space-4', v: 16 },
            { name: 'space-5', v: 20 },{ name: 'space-6', v: 24 },{ name: 'space-7', v: 32 },{ name: 'space-8', v: 40 },
            { name: 'space-9', v: 56 },{ name: 'space-10', v: 80 },
          ].map(s => (
            <div key={s.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: s.v, height: s.v, background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', borderRadius: 2 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>{s.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-quaternary)' }}>{s.v}px</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          {['xs','sm','md','lg','xl','2xl'].map((r) => (
            <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 56, height: 56, background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', borderRadius: `var(--radius-${r})` }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>radius-{r}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ICONS */}
      <Section title="Iconography" subtitle="1.75px stroke, 24×24 viewBox, currentColor. Lucide-style.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, padding: 'var(--space-4)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          {ICON_NAMES.map(n => (
            <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 8, borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}>
              <Icon name={n} size={18} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-quaternary)' }}>{n}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  </div>
);

const ICON_NAMES = ['plus','check','x','search','book','bookOpen','sparkles','play','pause','refresh','sun','moon','edit','code','flask','brain','target','layout','fileText','folder','keyboard','save','arrowRight','arrowLeft','pencil','trash','grip','info','alertTriangle','lightbulb','settings','user','bot','clock','chart','layers','eye','panel','panelRight','menu','grid','list','star','history','terminal','git'];

const Section = ({ title, subtitle, children }) => (
  <div style={{ marginBottom: 'var(--space-9)' }}>
    <div style={{ marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h2>
      {subtitle && <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)' }}>{subtitle}</p>}
    </div>
    {children}
  </div>
);

const SwatchGroup = ({ title, children }) => (
  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
    <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
  </div>
);

const Swatch = ({ name, var: cssVar }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div style={{ width: 28, height: 28, borderRadius: 6, background: `var(${cssVar})`, border: '1px solid var(--border)', flexShrink: 0 }} />
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{name}</span>
  </div>
);

const TypeRow = ({ size, weight, tracking, label, upper, mono, prose, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 24, alignItems: 'baseline', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
    <span style={{
      fontSize: size,
      fontWeight: weight,
      letterSpacing: tracking,
      textTransform: upper ? 'uppercase' : 'none',
      fontFamily: mono ? 'var(--font-mono)' : prose ? 'var(--font-prose)' : 'var(--font-display)',
      lineHeight: parseInt(size) > 30 ? 1.15 : 1.5,
      color: 'var(--text)',
    }}>{children}</span>
  </div>
);

const ComponentGrid = ({ children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>{children}</div>
);

const ComponentCard = ({ title, children }) => (
  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{title}</div>
    {children}
  </div>
);

const Row = ({ children }) => <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>;

const ShortcutRow = ({ keys, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <div style={{ display: 'flex', gap: 3 }}>{keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</div>
    <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
  </div>
);

window.SystemView = SystemView;
