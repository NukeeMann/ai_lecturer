// AI Lecturer — Course Creation Flow
// Multi-stage agent chain: Topic → Refine → Structure → Approve → Generate.
// Stage variants are switched by `stage` prop (1..5).

const CreateView = ({ initialStage = 2 }) => {
  const [stage, setStage] = useState(initialStage);
  const stages = [
    { id: 1, label: 'Topic',     icon: 'sparkles' },
    { id: 2, label: 'Refine',    icon: 'bot' },
    { id: 3, label: 'Structure', icon: 'layout' },
    { id: 4, label: 'Approve',   icon: 'check' },
    { id: 5, label: 'Generate',  icon: 'brain' },
  ];

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-sans)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* TOP BAR */}
      <header style={{
        display: 'flex', alignItems: 'center',
        padding: 'var(--space-3) var(--space-5)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        gap: 'var(--space-4)',
      }}>
        <Button variant="ghost" size="sm" leftIcon="arrowLeft">Cancel</Button>
        <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>New course</span>
        <div style={{ flex: 1 }} />
        <Stepper stages={stages} current={stage} onJump={setStage} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--success)' }} />
          Draft saved
        </span>
      </header>

      {/* STAGE CONTENT */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        {stage === 1 && <Stage1 onNext={() => setStage(2)} />}
        {stage === 2 && <Stage2 onNext={() => setStage(3)} onBack={() => setStage(1)} />}
        {stage === 3 && <Stage3 onNext={() => setStage(4)} onBack={() => setStage(2)} />}
        {stage === 4 && <Stage4 onNext={() => setStage(5)} onBack={() => setStage(3)} />}
        {stage === 5 && <Stage5 onBack={() => setStage(4)} />}
      </main>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const Stepper = ({ stages, current, onJump }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    {stages.map((s, i) => {
      const done = s.id < current;
      const active = s.id === current;
      return (
        <React.Fragment key={s.id}>
          <button
            onClick={() => onJump(s.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 10px 4px 4px',
              border: 'none',
              background: active ? 'var(--accent-subtle)' : 'transparent',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              color: active ? 'var(--accent-text)' : done ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 500,
              fontFamily: 'inherit',
              transition: 'background var(--t-fast)',
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: done ? 'var(--success)' : active ? 'var(--accent)' : 'transparent',
              border: done || active ? 'none' : '1.5px solid var(--border-strong)',
              color: done || active ? 'white' : 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            }}>
              {done ? <Icon name="check" size={11} strokeWidth={3} /> : s.id}
            </span>
            <span>{s.label}</span>
          </button>
          {i < stages.length - 1 && (
            <span style={{ width: 14, height: 1, background: done ? 'var(--success)' : 'var(--border-strong)' }} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

// ─── STAGE 1: Topic ─────────────────────────────────────────────────────────

const Stage1 = ({ onNext }) => {
  const [topic, setTopic] = useState('');
  const suggestions = [
    'Probability for ML engineers',
    'Linear algebra: just enough for deep learning',
    'How transformers work, end to end',
    'CSS Grid mastery in 90 minutes',
    'Bayesian thinking from scratch',
  ];
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-9) var(--space-6)' }}>
      <div style={{ fontSize: '10.5px', color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>
        Stage 1 of 5
      </div>
      <h1 style={{
        margin: 0,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-3xl)',
        fontWeight: 600,
        letterSpacing: '-0.025em',
        lineHeight: 1.15,
      }}>
        What do you want to learn?
      </h1>
      <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 'var(--fs-md)', lineHeight: 1.55 }}>
        A sentence is fine. A paragraph is better — the more context you give, the better the agent can shape the
        course around what <em>you</em> need.
      </p>

      <div style={{ marginTop: 'var(--space-7)', position: 'relative' }}>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. I want to build an intuition for how neural networks actually learn — I know calculus but I've never trained a model."
          style={{
            width: '100%',
            minHeight: 140,
            padding: 'var(--space-5)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-md)',
            lineHeight: 1.55,
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            resize: 'vertical',
            outline: 'none',
          }}
        />
      </div>

      <div style={{ marginTop: 'var(--space-5)' }}>
        <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10 }}>
          Or start from a suggestion
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setTopic(s)}
              style={{
                padding: '7px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color var(--t-fast), background var(--t-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.background = 'var(--accent-subtle)'; e.currentTarget.style.color = 'var(--accent-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-7)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        <Kbd>⏎</Kbd>
        <Button variant="primary" size="lg" rightIcon="arrowRight" onClick={onNext} disabled={!topic.trim()}>
          Start refining
        </Button>
      </div>
    </div>
  );
};

// ─── STAGE 2: Refine (chat with structure) ──────────────────────────────────

const Stage2 = ({ onNext, onBack }) => {
  const [picks, setPicks] = useState({ level: null, time: null, mix: null });
  const [extra, setExtra] = useState('');
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 'var(--space-7) var(--space-6) var(--space-9)' }}>
      <div style={{ fontSize: '10.5px', color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>
        Stage 2 of 5 · Refining
      </div>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
        Let's narrow it down
      </h1>
      <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
        The agent has a few questions to make sure the course fits you, not someone else.
      </p>

      <div style={{ marginTop: 'var(--space-7)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <ChatBubble role="user">
          I want to build an intuition for how neural networks actually learn — I know calculus but I've never trained a model.
        </ChatBubble>

        <ChatBubble role="agent" agent="Curriculum architect">
          Got it. To shape this well, I need to make a few choices with you. First — how deep do you want to go?
          <ChoiceRow>
            {['Just the intuition, no math', 'Comfortable with the math, but light on it', 'Math-first, derivations welcome'].map((opt) => (
              <Choice key={opt} selected={picks.level === opt} onClick={() => setPicks({ ...picks, level: opt })}>{opt}</Choice>
            ))}
          </ChoiceRow>
        </ChatBubble>

        <ChatBubble role="user">{picks.level || <span style={{ color: 'var(--text-quaternary)' }}>(your answer)</span>}</ChatBubble>

        <ChatBubble role="agent" agent="Curriculum architect">
          Good. How much time can you commit per session, and how many sessions are you planning?
          <ChoiceRow>
            {['~20 min × 6 sessions', '~45 min × 4 sessions', '~90 min × 2 sessions', 'One long sitting'].map((opt) => (
              <Choice key={opt} selected={picks.time === opt} onClick={() => setPicks({ ...picks, time: opt })}>{opt}</Choice>
            ))}
          </ChoiceRow>
        </ChatBubble>

        <ChatBubble role="user">{picks.time || <span style={{ color: 'var(--text-quaternary)' }}>(your answer)</span>}</ChatBubble>

        <ChatBubble role="agent" agent="Curriculum architect">
          Last one — should the lessons lean toward theory or hands-on coding? You can pick a balance.
          <ChoiceRow>
            {['Mostly theory, a few examples', 'Even split', 'Code-heavy, theory only when needed'].map((opt) => (
              <Choice key={opt} selected={picks.mix === opt} onClick={() => setPicks({ ...picks, mix: opt })}>{opt}</Choice>
            ))}
          </ChoiceRow>
          <div style={{ marginTop: 12 }}>
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Anything else to keep in mind? (optional — e.g. 'use PyTorch, not raw NumPy')"
              style={{
                width: '100%',
                minHeight: 64,
                padding: '10px 12px',
                fontFamily: 'inherit',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.55,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-subtle)',
                color: 'var(--text)',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>
        </ChatBubble>
      </div>

      <div style={{ marginTop: 'var(--space-7)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="ghost" size="md" leftIcon="arrowLeft" onClick={onBack}>Back</Button>
        <Button variant="primary" size="md" rightIcon="arrowRight" onClick={onNext}>
          Propose a structure
        </Button>
      </div>
    </div>
  );
};

const ChatBubble = ({ role, agent, children }) => {
  const isAgent = role === 'agent';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28,
        borderRadius: '50%',
        background: isAgent ? 'var(--accent-subtle)' : 'var(--bg-active)',
        color: isAgent ? 'var(--accent-text)' : 'var(--text-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        border: '1px solid ' + (isAgent ? 'var(--accent-border)' : 'var(--border)'),
      }}>
        <Icon name={isAgent ? 'bot' : 'user'} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isAgent && (
          <div style={{ fontSize: '11px', color: 'var(--accent-text)', fontWeight: 600, marginBottom: 6, letterSpacing: '0.01em' }}>
            {agent}
          </div>
        )}
        <div style={{
          background: isAgent ? 'transparent' : 'var(--bg-subtle)',
          border: isAgent ? 'none' : '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: isAgent ? '2px 0' : '10px 14px',
          fontSize: 'var(--fs-sm)',
          lineHeight: 1.6,
          color: 'var(--text)',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};

const ChoiceRow = ({ children }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{children}</div>
);

const Choice = ({ selected, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: '8px 14px',
      background: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      fontSize: 'var(--fs-sm)',
      color: selected ? 'var(--accent-text)' : 'var(--text)',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontWeight: selected ? 500 : 400,
      transition: 'border-color var(--t-fast), background var(--t-fast)',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}
  >
    {selected && <Icon name="check" size={11} strokeWidth={3} />}
    {children}
  </button>
);

// ─── STAGE 3: Structure (column-cascade mind map) ──────────────────────────

const Stage3 = ({ onNext, onBack }) => {
  const [structure, setStructure] = useState(COURSE_STRUCTURE);
  const [selectedModule, setSelectedModule] = useState(1);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-3)', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <div style={{ fontSize: '10.5px', color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
          Stage 3 of 5 · Proposed structure
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              Intro to Neural Networks
            </h1>
            <p style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
              3 modules · 16 lessons · ~45 min each. Click any node to edit, drag to reorder, or add new ones.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="md" leftIcon="sparkles">Regenerate</Button>
            <Button variant="ghost" size="md" leftIcon="plus">Add module</Button>
          </div>
        </div>
      </div>

      {/* Cascade columns */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 'var(--space-4) var(--space-6) var(--space-7)',
        background: 'var(--bg-subtle)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '300px 320px 1fr',
          gap: 'var(--space-5)',
          minHeight: 480,
        }}>
          {/* Course (column 1) */}
          <CascadeColumn title="Course" subtitle="Your full curriculum">
            <CascadeNode
              icon="bookOpen"
              title="Intro to Neural Networks"
              subtitle="3 modules · 16 lessons"
              active
              expanded
            />
          </CascadeColumn>

          {/* Modules (column 2) */}
          <CascadeColumn title="Modules" subtitle="3 modules · drag to reorder">
            {structure.modules.map((m, i) => (
              <CascadeNode
                key={i}
                icon="folder"
                title={m.title}
                subtitle={`${m.lessons.length} lessons`}
                active={selectedModule === i}
                onClick={() => setSelectedModule(i)}
                draggable
              />
            ))}
            <AddNode label="Add module" />
          </CascadeColumn>

          {/* Lessons + sections (column 3 — nested) */}
          <CascadeColumn title="Lessons" subtitle={`${structure.modules[selectedModule].title}`} accent>
            {structure.modules[selectedModule].lessons.map((l, i) => (
              <LessonNode key={i} lesson={l} index={i + 1} />
            ))}
            <AddNode label="Add lesson" />
          </CascadeColumn>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-4) var(--space-6)', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <Button variant="ghost" size="md" leftIcon="arrowLeft" onClick={onBack}>Back</Button>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
          Estimated total time: <strong style={{ color: 'var(--text-secondary)' }}>~6 hours</strong>
        </span>
        <Button variant="primary" size="md" rightIcon="arrowRight" onClick={onNext}>
          Looks good — review
        </Button>
      </div>
    </div>
  );
};

const CascadeColumn = ({ title, subtitle, accent, children }) => (
  <div style={{
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  }}>
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)',
      background: accent ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
    }}>
      <div style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: accent ? 'var(--accent-text)' : 'var(--text-tertiary)' }}>
        {title}
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>
    </div>
    <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      {children}
    </div>
  </div>
);

const CascadeNode = ({ icon, title, subtitle, active, expanded, onClick, draggable }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      transition: 'border-color var(--t-fast), background var(--t-fast)',
    }}
  >
    {draggable && <Icon name="grip" size={14} style={{ color: 'var(--text-quaternary)' }} />}
    <div style={{
      width: 26, height: 26,
      borderRadius: 'var(--radius-sm)',
      background: active ? 'var(--accent)' : 'var(--bg-subtle)',
      color: active ? 'white' : 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon name={icon} size={13} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: active ? 'var(--accent-text)' : 'var(--text)' }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', marginTop: 1 }}>{subtitle}</div>}
    </div>
    {active && <Icon name="chevronRight" size={14} style={{ color: 'var(--accent)' }} />}
  </div>
);

const LessonNode = ({ lesson, index }) => (
  <div style={{
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 8,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name="grip" size={13} style={{ color: 'var(--text-quaternary)' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
        L{String(index).padStart(2, '0')}
      </span>
      <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 500 }}>{lesson.title}</span>
      <Badge tone="neutral" size="sm">{lesson.estTime}</Badge>
      <button style={{ ...iconBtnSmall }}><Icon name="pencil" size={12} /></button>
      <button style={{ ...iconBtnSmall }}><Icon name="trash" size={12} /></button>
    </div>
    {lesson.sections && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 26 }}>
        {lesson.sections.map((sec, j) => (
          <span key={j} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px',
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-full)',
            fontSize: '10.5px',
            color: 'var(--text-secondary)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: widgetMeta[sec.type]?.color || 'var(--text-secondary)' }} />
            {sec.label}
          </span>
        ))}
      </div>
    )}
  </div>
);

const AddNode = ({ label }) => (
  <button style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '10px 12px',
    background: 'transparent',
    border: '1px dashed var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-tertiary)',
    fontSize: 'var(--fs-xs)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }}>
    <Icon name="plus" size={12} />
    {label}
  </button>
);

const iconBtnSmall = {
  width: 22, height: 22,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
};

// ─── STAGE 4: Approve ───────────────────────────────────────────────────────

const Stage4 = ({ onNext, onBack }) => (
  <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-7) var(--space-6) var(--space-9)' }}>
    <div style={{ fontSize: '10.5px', color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
      Stage 4 of 5 · Final review
    </div>
    <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
      Ready to generate?
    </h1>
    <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
      Quick summary before the agent starts writing all 16 lessons. This will take about 4–6 minutes.
    </p>

    <div style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <SummaryRow label="Topic"        value="How neural networks learn — built on calculus, no prior ML." />
      <SummaryRow label="Depth"        value="Comfortable with math, light on it" />
      <SummaryRow label="Format"       value="~45 min × 4 sessions · even split theory ↔ code" />
      <SummaryRow label="Modules"      value="Foundations · Optimization · Going deeper" />
      <SummaryRow label="Total"        value="16 lessons · 78 sections · ~6 hours" />
      <SummaryRow label="Code runtime" value="Pyodide (Python in browser) · NumPy" />
    </div>

    <Callout tone="info" title="What happens next" style={{ marginTop: 'var(--space-5)' }}>
      Five agents will work in sequence: a researcher gathers source material, a writer drafts each lesson, a
      designer chooses widget types, a reviewer fact-checks, and an editor polishes the prose. You'll see what
      each one is doing in real time.
    </Callout>

    <div style={{ marginTop: 'var(--space-7)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button variant="ghost" size="md" leftIcon="arrowLeft" onClick={onBack}>Back to structure</Button>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="md">Save as draft</Button>
        <Button variant="primary" size="md" leftIcon="sparkles" onClick={onNext}>
          Start generating
        </Button>
      </div>
    </div>
  </div>
);

const SummaryRow = ({ label, value }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
      {label}
    </span>
    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{value}</span>
  </div>
);

// ─── STAGE 5: Generate (live agent log) ─────────────────────────────────────

const Stage5 = ({ onBack }) => (
  <div style={{ maxWidth: 880, margin: '0 auto', padding: 'var(--space-7) var(--space-6) var(--space-9)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 'var(--space-3)' }}>
      <div style={{ position: 'relative', width: 40, height: 40 }}>
        <PulseRing />
        <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <Icon name="brain" size={14} />
        </div>
      </div>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
          Generating your course
        </h1>
        <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontVariantNumeric: 'tabular-nums' }}>
          Lesson <strong style={{ color: 'var(--text)' }}>5</strong> of 16 · about 3 min remaining
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <Button variant="ghost" size="md">Run in background</Button>
      <Button variant="secondary" size="md">Pause</Button>
    </div>

    <Progress value={28} size="md" tone="accent" />

    <div style={{ marginTop: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {AGENT_LOG.map((entry, i) => (
        <AgentLogEntry key={i} entry={entry} index={i} />
      ))}
    </div>

    <div style={{ marginTop: 'var(--space-7)', display: 'flex', justifyContent: 'flex-start' }}>
      <Button variant="ghost" size="md" leftIcon="arrowLeft" onClick={onBack}>Cancel</Button>
    </div>
  </div>
);

const PulseRing = () => (
  <>
    <style>{`
      @keyframes ailect-pulse { 0% { transform: scale(0.6); opacity: 0.6; } 100% { transform: scale(1.3); opacity: 0; } }
    `}</style>
    <div style={{
      position: 'absolute', inset: 0,
      borderRadius: '50%',
      background: 'var(--accent)',
      opacity: 0.2,
      animation: 'ailect-pulse 1.6s ease-out infinite',
    }} />
    <div style={{
      position: 'absolute', inset: 0,
      borderRadius: '50%',
      background: 'var(--accent)',
      opacity: 0.2,
      animation: 'ailect-pulse 1.6s ease-out infinite 0.8s',
    }} />
  </>
);

const AgentLogEntry = ({ entry }) => {
  const isActive = entry.status === 'active';
  const isDone = entry.status === 'done';
  return (
    <div style={{
      border: '1px solid ' + (isActive ? 'var(--accent-border)' : 'var(--border)'),
      background: isActive ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px' }}>
        <div style={{
          width: 28, height: 28,
          borderRadius: '50%',
          background: isDone ? 'var(--success-subtle)' : isActive ? 'var(--accent)' : 'var(--bg-subtle)',
          color: isDone ? 'var(--success)' : isActive ? 'white' : 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          border: '1px solid ' + (isDone ? 'var(--success-border)' : isActive ? 'var(--accent)' : 'var(--border)'),
        }}>
          {isDone ? <Icon name="check" size={14} strokeWidth={3} /> : isActive ? <Icon name={entry.icon} size={13} /> : <Icon name={entry.icon} size={13} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{entry.agent}</span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>{entry.action}</span>
            {isActive && (
              <Badge tone="accent" size="sm" dot>Working · {entry.elapsed}</Badge>
            )}
            {isDone && <Badge tone="success" size="sm">Done · {entry.elapsed}</Badge>}
          </div>
          {isActive && entry.subtasks && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entry.subtasks.map((t, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
                  {t.done ? (
                    <Icon name="check" size={11} strokeWidth={3} style={{ color: 'var(--success)' }} />
                  ) : t.active ? (
                    <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid var(--accent)', borderTopColor: 'transparent', animation: 'ailect-spin 0.7s linear infinite' }} />
                  ) : (
                    <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid var(--border-strong)' }} />
                  )}
                  <span style={{ color: t.done ? 'var(--text-tertiary)' : t.active ? 'var(--text)' : 'var(--text-tertiary)', textDecoration: t.done ? 'line-through' : 'none' }}>
                    {t.label}
                  </span>
                </div>
              ))}
              <style>{`@keyframes ailect-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {entry.note && !isActive && (
            <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {entry.note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── DATA ───────────────────────────────────────────────────────────────────

const COURSE_STRUCTURE = {
  modules: [
    {
      title: 'Foundations',
      lessons: [
        { title: 'What is a neuron?', estTime: '~25 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }, { type: 'quiz', label: 'Quiz' }] },
        { title: 'Layers and activations', estTime: '~35 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }, { type: 'code', label: 'Code' }, { type: 'quiz', label: 'Quiz' }] },
        { title: 'The forward pass', estTime: '~40 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'code', label: 'Code' }, { type: 'sandbox', label: 'Sandbox' }] },
      ],
    },
    {
      title: 'Optimization',
      lessons: [
        { title: 'The loss function', estTime: '~30 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }, { type: 'quiz', label: 'Quiz' }] },
        { title: 'Gradient descent', estTime: '~45 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }, { type: 'quiz', label: 'Quiz' }, { type: 'code', label: 'Code' }, { type: 'sandbox', label: 'Sandbox' }] },
        { title: 'Backpropagation', estTime: '~50 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }, { type: 'code', label: 'Code' }] },
        { title: 'Mini-batches and epochs', estTime: '~30 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'code', label: 'Code' }] },
      ],
    },
    {
      title: 'Going deeper',
      lessons: [
        { title: 'Vanishing gradients', estTime: '~35 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }] },
        { title: 'Adam, RMSprop, momentum', estTime: '~40 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'demo', label: 'Demo' }, { type: 'code', label: 'Code' }] },
        { title: 'Regularization', estTime: '~30 min', sections: [{ type: 'theory', label: 'Theory' }, { type: 'quiz', label: 'Quiz' }] },
      ],
    },
  ],
};

const AGENT_LOG = [
  { agent: 'Researcher',           icon: 'search',    status: 'done',   elapsed: '42s',  action: 'Gathered 14 sources for "neural network basics"', note: '→ 14 sources cached · 4 textbooks, 6 papers, 4 explainers' },
  { agent: 'Curriculum architect', icon: 'layout',    status: 'done',   elapsed: '18s',  action: 'Approved structure: 3 modules, 16 lessons',   note: '→ structure.json' },
  { agent: 'Lesson writer',        icon: 'pencil',    status: 'active', elapsed: '01:24',
    action: 'Drafting "Gradient Descent" (lesson 5/16)',
    subtasks: [
      { label: 'Outline 5 sections',                 done: true },
      { label: 'Draft theory section (~600 words)',  done: true },
      { label: 'Pick interactive demo type',         active: true },
      { label: 'Generate quiz with 4 distractors',   active: false },
      { label: 'Generate code exercise + 3 tests',   active: false },
    ],
  },
  { agent: 'Widget designer', icon: 'flask', status: 'pending', elapsed: '—', action: 'Waiting for lesson draft' },
  { agent: 'Reviewer',        icon: 'eye',   status: 'pending', elapsed: '—', action: 'Waiting' },
  { agent: 'Editor',          icon: 'star',  status: 'pending', elapsed: '—', action: 'Waiting' },
];

window.CreateView = CreateView;
