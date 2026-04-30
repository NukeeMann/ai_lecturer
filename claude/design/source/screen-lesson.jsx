// AI Lecturer — Lesson View
// 3-column notebook layout: course TOC + main stream of widgets + notes panel.
// Demo subject: Gradient Descent (ML/AI fundamental).

const LessonView = ({ initialNotesOpen = true, density = 'comfortable' }) => {
  const [activeSectionId, setActiveSectionId] = useState('s2');
  const [notesOpen, setNotesOpen] = useState(initialNotesOpen);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [completedSections, setCompletedSections] = useState(new Set(['s1']));
  const [notes, setNotes] = useState(LESSON_INITIAL_NOTES);
  const [notesSaved, setNotesSaved] = useState('saved');

  // Quiz state
  const [quizAnswer, setQuizAnswer] = useState(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Demo state — learning rate slider + iterations
  const [learningRate, setLearningRate] = useState(0.1);
  const [iterations, setIterations] = useState(20);
  const [startX, setStartX] = useState(-3.5);

  // Code state
  const [codeOutput, setCodeOutput] = useState(null);
  const [codeRunning, setCodeRunning] = useState(false);
  const [testsRun, setTestsRun] = useState(false);

  const onNoteChange = (v) => {
    setNotes(v);
    setNotesSaved('saving');
    clearTimeout(window.__notesTimer);
    window.__notesTimer = setTimeout(() => setNotesSaved('saved'), 600);
  };

  const markComplete = (id) => {
    setCompletedSections((prev) => new Set([...prev, id]));
  };

  const sections = LESSON_SECTIONS;
  const totalSections = sections.length;
  const doneCount = sections.filter((s) => completedSections.has(s.id)).length;
  const currentIdx = sections.findIndex((s) => s.id === activeSectionId);

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'grid',
      gridTemplateColumns: `${tocCollapsed ? '52px' : '276px'} minmax(0, 1fr) ${notesOpen ? '320px' : '0px'}`,
      gridTemplateRows: '52px 1fr 56px',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-sans)',
      transition: 'grid-template-columns var(--t-base)',
      overflow: 'hidden',
    }}>
      {/* TOP BAR — spans all columns */}
      <header style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: '0 var(--space-5)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}>
        <button
          onClick={() => setTocCollapsed(!tocCollapsed)}
          style={iconBtn}
          title="Toggle sidebar (⌘\)"
        >
          <Icon name="panel" size={16} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)', minWidth: 0 }}>
          <Icon name="bookOpen" size={14} />
          <span>Intro to Neural Networks</span>
          <Icon name="chevronRight" size={12} style={{ opacity: 0.5 }} />
          <span>Module 2 · Optimization</span>
          <Icon name="chevronRight" size={12} style={{ opacity: 0.5 }} />
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>Gradient Descent</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ width: 140 }}>
            <SegmentedProgress total={totalSections} done={doneCount} current={currentIdx} />
          </div>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
            {doneCount}/{totalSections}
          </span>
        </div>
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <button style={iconBtn} title="Keyboard shortcuts (?)">
          <Icon name="keyboard" size={16} />
        </button>
        <button
          onClick={() => setNotesOpen(!notesOpen)}
          style={{ ...iconBtn, ...(notesOpen ? { color: 'var(--accent)', background: 'var(--accent-subtle)' } : {}) }}
          title="Toggle AI tutor (⌘.)"
        >
          <Icon name="sparkles" size={16} />
        </button>
      </header>

      {/* LEFT TOC */}
      <aside style={{
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
        overflow: 'auto',
        padding: tocCollapsed ? 'var(--space-3) var(--space-2)' : 'var(--space-4)',
      }}>
        {tocCollapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', paddingTop: 8 }}>
            <Icon name="folder" size={16} style={{ color: 'var(--text-tertiary)' }} />
            <Icon name="bookOpen" size={16} style={{ color: 'var(--accent)' }} />
            <Icon name="bookOpen" size={16} style={{ color: 'var(--text-quaternary)' }} />
          </div>
        ) : (
          <Toc completedSections={completedSections} activeSectionId={activeSectionId} sections={sections} />
        )}
      </aside>

      {/* MAIN STREAM */}
      <main style={{ overflow: 'auto', padding: 'var(--space-7) var(--space-6) var(--space-9)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-section)' }}>
          {/* Lesson header */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 'var(--fs-xs)', marginBottom: 12, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 500 }}>
              <span>Lesson 4 of 7</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-quaternary)' }} />
              <span>~ 18 min</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-quaternary)' }} />
              <span>Intermediate</span>
            </div>
            <h1 style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-3xl)',
              fontWeight: 600,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
            }}>
              Gradient Descent: How Networks Actually Learn
            </h1>
            <p style={{
              margin: '12px 0 0',
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-md)',
              lineHeight: 1.55,
              maxWidth: 620,
            }}>
              We've seen what a loss function measures. Now we'll see how the network climbs <em>down</em> that loss
              surface — one small step at a time.
            </p>
          </div>

          {/* §1 THEORY */}
          <Widget type="theory" title="The intuition" sectionNumber="1" status="done">
            <div style={proseStyle}>
              <p>
                Imagine you're standing on a foggy hillside, blindfolded, and you want to reach the bottom of the
                valley. You can't see far — but you <em>can</em> feel the slope under your feet. The strategy is
                simple: feel which way is downhill, take a small step in that direction, and repeat.
              </p>
              <p>
                That's gradient descent. The "hillside" is the <strong>loss surface</strong>, your position is the
                current set of weights, and the slope is the <strong>gradient</strong>: the partial derivative of
                the loss with respect to each weight.
              </p>
              <Callout tone="insight" title="Why a gradient, not just any direction?">
                The gradient points in the direction of <em>steepest ascent</em>. Negate it, and you have the
                direction of steepest descent — locally, the fastest way down.
              </Callout>
              <p>
                Each step looks like this:
              </p>
              <div style={mathBox}>
                <span style={{ fontFamily: 'var(--font-prose)', fontStyle: 'italic' }}>
                  θ<sub>t+1</sub>&nbsp;&nbsp;=&nbsp;&nbsp;θ<sub>t</sub>&nbsp;−&nbsp;η&nbsp;·&nbsp;∇L(θ<sub>t</sub>)
                </span>
              </div>
              <p>
                Three pieces: the current parameters <em>θ</em>, the gradient ∇L, and the step size <em>η</em> (the
                <strong> learning rate</strong>) — the only knob you really tune by hand.
              </p>
            </div>
          </Widget>

          {/* §2 DEMO */}
          <Widget
            type="demo"
            title="See it descend"
            sectionNumber="2"
            status={activeSectionId === 's2' ? 'progress' : completedSections.has('s2') ? 'done' : null}
            headerRight={
              <Button variant="ghost" size="sm" leftIcon="refresh" onClick={() => { setLearningRate(0.1); setIterations(20); setStartX(-3.5); }}>
                Reset
              </Button>
            }
          >
            <div style={{ padding: 'var(--space-5)' }}>
              <p style={{ ...proseStyle, padding: 0, margin: '0 0 var(--space-5)', fontSize: 'var(--fs-sm)' }}>
                A 1D loss surface: <code style={inlineCode}>L(x) = x⁴ − 3x² + x</code>. Drag the sliders to see how
                the learning rate and starting point change the path.
              </p>

              {/* Plot */}
              <GradientDescentPlot lr={learningRate} iters={iterations} startX={startX} />

              {/* Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
                <DemoSlider label="Learning rate η" value={learningRate} min={0.01} max={0.4} step={0.01} format={(v) => v.toFixed(2)} onChange={setLearningRate} />
                <DemoSlider label="Iterations" value={iterations} min={1} max={60} step={1} format={(v) => Math.round(v)} onChange={setIterations} />
                <DemoSlider label="Start position x₀" value={startX} min={-4} max={4} step={0.1} format={(v) => v.toFixed(1)} onChange={setStartX} />
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <Badge tone={learningRate > 0.25 ? 'warning' : 'accent'} size="md" dot>
                    {learningRate > 0.25 ? 'Likely to overshoot' : learningRate < 0.04 ? 'Slow but stable' : 'Healthy step size'}
                  </Badge>
                </div>
              </div>
            </div>

            <details style={detailsStyle}>
              <summary style={detailsSummary}>
                <Icon name="lightbulb" size={13} />
                <span>What just happened?</span>
                <Icon name="chevronDown" size={13} className="chevron" style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }} />
              </summary>
              <div style={{ padding: '0 var(--space-5) var(--space-4)', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
                Notice the trade-off: too small a learning rate and you crawl; too large and you overshoot the
                minimum (sometimes oscillating, sometimes diverging entirely). There's a sweet spot — and finding
                it is more art than science. Modern optimizers (Adam, RMSprop) try to adapt η automatically.
              </div>
            </details>
          </Widget>

          {/* §3 QUIZ */}
          <Widget type="quiz" title="Quick check" sectionNumber="3">
            <div style={{ padding: 'var(--space-5)' }}>
              <p style={{ ...proseStyle, padding: 0, margin: '0 0 var(--space-4)', fontSize: 'var(--fs-md)', fontWeight: 500 }}>
                You set the learning rate too high and watch your loss bounce wildly between high values instead of
                decreasing. What's the <em>most likely</em> cause?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'a', text: 'The gradient is being computed incorrectly.' },
                  { id: 'b', text: "You're stepping past the minimum and overshooting in each iteration." },
                  { id: 'c', text: 'The loss surface has no minimum to descend to.' },
                  { id: 'd', text: 'Your network has too few parameters.' },
                ].map((opt) => (
                  <QuizOption
                    key={opt.id}
                    id={opt.id}
                    text={opt.text}
                    selected={quizAnswer === opt.id}
                    correct={quizSubmitted && opt.id === 'b'}
                    incorrect={quizSubmitted && quizAnswer === opt.id && opt.id !== 'b'}
                    disabled={quizSubmitted}
                    onClick={() => !quizSubmitted && setQuizAnswer(opt.id)}
                  />
                ))}
              </div>
              {!quizSubmitted ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
                  <Button variant="primary" size="md" disabled={!quizAnswer} onClick={() => { setQuizSubmitted(true); markComplete('s3'); }} rightIcon="arrowRight">
                    Submit
                  </Button>
                </div>
              ) : (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <Callout tone={quizAnswer === 'b' ? 'insight' : 'warning'} title={quizAnswer === 'b' ? 'Correct — well spotted.' : 'Not quite. The answer is B.'}>
                    A high learning rate means your steps are too big. When you reach a region near the minimum, instead of
                    settling in, you leap right over it and end up on the opposite slope — possibly higher than where you
                    started. Repeat that, and your loss oscillates or even grows.
                  </Callout>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
                    <Button variant="ghost" size="sm" leftIcon="refresh" onClick={() => { setQuizSubmitted(false); setQuizAnswer(null); }}>
                      Try again
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Widget>

          {/* §4 CODE */}
          <Widget
            type="code"
            title="Implement one step of gradient descent"
            sectionNumber="4"
            headerRight={<Badge tone="neutral" size="sm">Graded · Pyodide</Badge>}
          >
            <div style={{ padding: 'var(--space-4) var(--space-5) 0' }}>
              <p style={{ ...proseStyle, padding: 0, margin: 0, fontSize: 'var(--fs-sm)' }}>
                Complete <code style={inlineCode}>step()</code> so it returns the new parameter after one
                gradient-descent update. Use the formula above.
              </p>
            </div>
            <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
              <CodeBlock code={`def step(theta, grad, lr):
    # TODO: implement one gradient-descent update
    return theta - lr * grad

# Don't edit below — these are the tests
assert abs(step(2.0, 4.0, 0.1) - 1.6)  < 1e-6
assert abs(step(0.0, -2.0, 0.5) - 1.0) < 1e-6
assert abs(step(5.0, 0.0, 0.1) - 5.0)  < 1e-6
print("All checks passed ✓")`} />
              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)' }}>
                <Button
                  variant="primary"
                  size="md"
                  leftIcon={codeRunning ? 'clock' : 'play'}
                  kbd="⇧⏎"
                  onClick={() => {
                    setCodeRunning(true);
                    setTimeout(() => { setCodeRunning(false); setCodeOutput('all checks passed ✓'); setTestsRun(true); markComplete('s4'); }, 700);
                  }}
                >
                  {codeRunning ? 'Running…' : 'Run tests'}
                </Button>
                <Button variant="ghost" size="md" leftIcon="terminal">Run cell</Button>
                <Button variant="ghost" size="md" leftIcon="refresh">Reset</Button>
                <div style={{ flex: 1 }} />
                <span style={{ alignSelf: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
                  Auto-saved · 12s ago
                </span>
              </div>
              {codeOutput && (
                <div style={outputBox}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <TestRow status="pass" label="step(2.0, 4.0, 0.1) → 1.6" />
                    <TestRow status="pass" label="step(0.0, -2.0, 0.5) → 1.0" />
                    <TestRow status="pass" label="step(5.0, 0.0, 0.1) → 5.0" />
                    <div style={{ marginTop: 6, color: 'var(--success)', fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}>
                      ✓ 3/3 passed · 0.04s
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Widget>

          {/* §5 SANDBOX */}
          <Widget type="sandbox" title="Try it: build your own loop" sectionNumber="5">
            <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
              <Callout tone="info" title="No tests, no pressure.">
                Try changing the loss function, the starting point, or how many steps you take. What does the path
                of <code style={inlineCode}>history</code> look like for a non-convex loss?
              </Callout>
            </div>
            <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
              <CodeBlock code={`def loss(x):    return x**4 - 3*x**2 + x
def grad(x):    return 4*x**3 - 6*x + 1

theta = -3.5     # try different starting points
lr    = 0.05     # try larger / smaller
history = [theta]

for _ in range(40):
    theta = theta - lr * grad(theta)
    history.append(theta)

print(f"final theta = {theta:.4f}")
print(f"final loss  = {loss(theta):.4f}")`} />
              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)' }}>
                <Button variant="primary" size="md" leftIcon="play" kbd="⇧⏎">Run</Button>
                <Button variant="ghost" size="md" leftIcon="refresh">Reset</Button>
              </div>
            </div>
          </Widget>
        </div>
      </main>

      {/* RIGHT CHAT */}
      {notesOpen && (
        <LessonChat />
      )}

      {/* BOTTOM BAR */}
      <footer style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-5)',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}>
        <Button variant="ghost" size="md" leftIcon="arrowLeft">
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
            <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Previous</span>
            <span>The loss function</span>
          </span>
        </Button>
        <Button
          variant={doneCount === totalSections ? 'primary' : 'secondary'}
          size="md"
          leftIcon={completedSections.has('s5') ? 'check' : null}
          onClick={() => markComplete('s5')}
        >
          {completedSections.has('s5') ? 'Lesson completed' : 'Mark lesson complete'}
        </Button>
        <Button variant="primary" size="md" rightIcon="arrowRight" kbd="⌘→">
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1 }}>
            <span style={{ fontSize: '10.5px', opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next</span>
            <span>Backpropagation</span>
          </span>
        </Button>
      </footer>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// LessonChat — AI tutor sidekick (replaces Notes panel)
// ─────────────────────────────────────────────────────────────────

const LESSON_CHAT_INITIAL = [
  {
    role: 'assistant',
    text: "Hi — I'm your tutor for this lesson. Ask me anything about gradient descent, the math, or this lesson's exercises. I can see what you're reading right now.",
    refs: null,
  },
  {
    role: 'user',
    text: 'Why does the gradient point in the direction of steepest ascent and not descent?',
    refs: null,
  },
  {
    role: 'assistant',
    text: "It's a property of the dot product. The directional derivative ∇f·u is maximized when u is parallel to ∇f — that's literally the definition. We then negate it to descend. Section 1 in this lesson has the geometric intuition; want me to expand on the proof?",
    refs: [{ label: '§ The intuition', target: 's1' }],
  },
];

const LESSON_CHAT_SUGGESTIONS = [
  'Explain this section like I\'m new to calculus',
  'Why does η = 0.9 diverge?',
  'Give me a harder version of the quiz',
  'Show me the math for why −∇f descends',
];

const LessonChat = () => {
  const [messages, setMessages] = useState(LESSON_CHAT_INITIAL);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [contextChip, setContextChip] = useState('§ See it descend');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  const send = (text) => {
    const t = (text ?? input).trim();
    if (!t) return;
    setMessages((m) => [...m, { role: 'user', text: t, refs: null }]);
    setInput('');
    setIsThinking(true);
    // Demo: canned reply
    setTimeout(() => {
      setIsThinking(false);
      setMessages((m) => [...m, {
        role: 'assistant',
        text: "Good question. Walking through it: the loss surface here is L(x) = x² + 2x + 5, so the gradient is ∇L = 2x + 2. At x = −1, the gradient vanishes — that's the minimum. With a learning rate η, each step moves x by −η·∇L. Try cranking η past 1.0 in the demo above to see why it overshoots.",
        refs: [{ label: 'Demo: See it descend', target: 's2' }],
      }]);
    }, 1200);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside style={{
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg-subtle)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--space-3) var(--space-5)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        minHeight: 52,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 999,
            background: 'var(--accent-subtle)',
            color: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon name="sparkles" size={12} strokeWidth={2} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.2 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Tutor</span>
            <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>Knows this lesson</span>
          </div>
        </div>
        <button style={{
          width: 26, height: 26, borderRadius: 6, border: 'none',
          background: 'transparent', color: 'var(--text-tertiary)',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }} title="New conversation">
          <Icon name="refresh" size={13} />
        </button>
      </div>

      {/* Context chip */}
      <div style={{
        padding: '8px var(--space-5)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--bg)',
      }}>
        <span style={{
          fontSize: '10.5px',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}>Context</span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          padding: '2px 8px',
          borderRadius: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {contextChip}
          <Icon name="x" size={10} strokeWidth={2} />
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-4) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}>
        {messages.map((m, i) => <ChatMessage key={i} {...m} />)}
        {isThinking && <ChatThinking />}
      </div>

      {/* Suggestions */}
      {messages.length <= 3 && (
        <div style={{
          padding: '0 var(--space-5) var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <span style={{
            fontSize: '10.5px',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
            marginBottom: 2,
          }}>Suggested</span>
          {LESSON_CHAT_SUGGESTIONS.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              style={{
                textAlign: 'left',
                padding: '7px 10px',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-prose)',
                color: 'var(--text-secondary)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: 'var(--space-3)',
      }}>
        <div style={{
          background: 'var(--bg)',
          border: '1px solid var(--border-strong)',
          borderRadius: 8,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about this lesson…"
            rows={2}
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              fontFamily: 'var(--font-prose)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.5,
              color: 'var(--text)',
              width: '100%',
              padding: '2px 4px',
            }}
          />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button style={chatToolBtn} title="Attach context">
                <Icon name="plus" size={13} />
              </button>
              <button style={chatToolBtn} title="Reference section">
                <Icon name="bookOpen" size={13} />
              </button>
            </div>
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              style={{
                width: 26, height: 26, borderRadius: 6, border: 'none',
                background: input.trim() ? 'var(--accent)' : 'var(--bg-subtle)',
                color: input.trim() ? '#ffffff' : 'var(--text-quaternary)',
                cursor: input.trim() ? 'pointer' : 'default',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 120ms',
              }}
              title="Send (⏎)"
            >
              <Icon name="arrowRight" size={13} strokeWidth={2.25} />
            </button>
          </div>
        </div>
        <div style={{
          fontSize: '10.5px',
          color: 'var(--text-quaternary)',
          marginTop: 6,
          textAlign: 'center',
        }}>
          Tutor sees the current section. <kbd style={kbdStyle}>⌘.</kbd> to toggle
        </div>
      </div>
    </aside>
  );
};

const ChatMessage = ({ role, text, refs }) => {
  if (role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          maxWidth: '88%',
          padding: '8px 12px',
          background: 'var(--accent-subtle)',
          color: 'var(--accent-text)',
          borderRadius: '10px 10px 2px 10px',
          fontSize: 'var(--fs-sm)',
          lineHeight: 1.5,
          fontFamily: 'var(--font-prose)',
        }}>{text}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '94%' }}>
      <div style={{
        fontFamily: 'var(--font-prose)',
        fontSize: 'var(--fs-sm)',
        lineHeight: 1.6,
        color: 'var(--text)',
      }}>{text}</div>
      {refs && refs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {refs.map((r, i) => (
            <a key={i} href={`#${r.target}`} style={{
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent-text)',
              background: 'var(--accent-subtle)',
              padding: '2px 8px',
              borderRadius: 4,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <Icon name="arrowRight" size={10} strokeWidth={2.25} />
              {r.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

const ChatThinking = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
    <span className="chat-dot" style={chatDot} />
    <span className="chat-dot" style={{ ...chatDot, animationDelay: '150ms' }} />
    <span className="chat-dot" style={{ ...chatDot, animationDelay: '300ms' }} />
    <span style={{ fontSize: 'var(--fs-xs)', marginLeft: 4 }}>thinking…</span>
  </div>
);

const chatDot = {
  width: 5, height: 5, borderRadius: 999,
  background: 'var(--text-tertiary)',
  display: 'inline-block',
  animation: 'chatDotPulse 1.2s infinite ease-in-out',
};

const chatToolBtn = {
  width: 24, height: 24, borderRadius: 5, border: 'none',
  background: 'transparent', color: 'var(--text-tertiary)',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const kbdStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  padding: '0 4px',
};

const iconBtn = {
  width: 32, height: 32,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  transition: 'background var(--t-fast), color var(--t-fast)',
};

const proseStyle = {
  fontFamily: 'var(--font-prose)',
  fontSize: 'var(--fs-md)',
  lineHeight: 'var(--line-height-prose, 1.7)',
  color: 'var(--text)',
  margin: 0,
  padding: 'var(--space-5) var(--space-6)',
};

const inlineCode = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.88em',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  padding: '1px 5px',
  borderRadius: 4,
  color: 'var(--accent-text)',
};

const mathBox = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-5)',
  margin: 'var(--space-4) 0',
  textAlign: 'center',
  fontSize: 'var(--fs-lg)',
};

const detailsStyle = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
};
const detailsSummary = {
  cursor: 'pointer',
  padding: 'var(--space-4) var(--space-5)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  listStyle: 'none',
};

const outputBox = {
  marginTop: 'var(--space-3)',
  background: 'var(--code-bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  fontFamily: 'var(--font-mono)',
  fontSize: '12.5px',
};

// ─────────────────────────────────────────────────────────────────────────────

const TestRow = ({ status, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: status === 'pass' ? 'var(--success)' : 'var(--danger)' }}>
    <Icon name={status === 'pass' ? 'check' : 'x'} size={12} strokeWidth={2.5} />
    <span style={{ color: 'var(--text)' }}>{label}</span>
  </div>
);

const QuizOption = ({ id, text, selected, correct, incorrect, disabled, onClick }) => {
  let borderColor = 'var(--border-strong)';
  let bg = 'var(--bg-elevated)';
  let labelColor = 'var(--text-tertiary)';
  if (correct) { borderColor = 'var(--success)'; bg = 'var(--success-subtle)'; labelColor = 'var(--success)'; }
  else if (incorrect) { borderColor = 'var(--danger)'; bg = 'var(--danger-subtle)'; labelColor = 'var(--danger)'; }
  else if (selected) { borderColor = 'var(--accent)'; bg = 'var(--accent-subtle)'; labelColor = 'var(--accent)'; }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text)',
        transition: 'border-color var(--t-fast), background var(--t-fast)',
      }}
    >
      <span style={{
        flexShrink: 0,
        width: 22, height: 22,
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${borderColor}`,
        background: 'var(--bg)',
        color: labelColor,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase',
      }}>
        {correct ? <Icon name="check" size={11} strokeWidth={3} /> : incorrect ? <Icon name="x" size={11} strokeWidth={3} /> : id}
      </span>
      <span style={{ flex: 1 }}>{text}</span>
    </button>
  );
};

const DemoSlider = ({ label, value, min, max, step, format, onChange }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-text)', fontVariantNumeric: 'tabular-nums' }}>
        {format(value)}
      </span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ width: '100%', accentColor: 'var(--accent)' }}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Gradient Descent Plot — pure SVG
// ─────────────────────────────────────────────────────────────────────────────

const GradientDescentPlot = ({ lr, iters, startX }) => {
  const W = 680, H = 260, PAD = 30;
  const xMin = -4.2, xMax = 4.2;
  const loss = (x) => x ** 4 - 3 * x ** 2 + x;
  const grad = (x) => 4 * x ** 3 - 6 * x + 1;

  // Sample loss curve
  const samples = 200;
  const points = [];
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const x = xMin + (i / samples) * (xMax - xMin);
    const y = loss(x);
    if (Math.abs(y) < 1000) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
    points.push([x, y]);
  }
  yMin = -8; yMax = 30;

  const X = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - PAD * 2);
  const Y = (y) => PAD + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD * 2);

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${X(x).toFixed(1)} ${Y(Math.max(yMin, Math.min(yMax, y))).toFixed(1)}`).join(' ');

  // Trajectory
  const traj = [];
  let x = startX;
  for (let i = 0; i < iters; i++) {
    traj.push([x, loss(x)]);
    x = x - lr * grad(x);
    if (Math.abs(x) > 6) break; // diverged
  }
  traj.push([x, loss(x)]);

  return (
    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {/* grid */}
        {[-3, -2, -1, 0, 1, 2, 3].map((gx) => (
          <line key={gx} x1={X(gx)} x2={X(gx)} y1={PAD} y2={H - PAD} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {[0, 10, 20].map((gy) => (
          <line key={gy} x1={PAD} x2={W - PAD} y1={Y(gy)} y2={Y(gy)} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {/* axes */}
        <line x1={PAD} x2={W - PAD} y1={Y(0)} y2={Y(0)} stroke="var(--border-strong)" strokeWidth="1" />
        {/* loss curve */}
        <path d={path} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" />
        {/* trajectory */}
        {traj.length > 1 && (
          <path
            d={traj.map(([tx, ty], i) => `${i === 0 ? 'M' : 'L'} ${X(tx).toFixed(1)} ${Y(Math.max(yMin, Math.min(yMax, ty))).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.2"
            strokeDasharray="3,3"
            opacity="0.7"
          />
        )}
        {traj.map(([tx, ty], i) => {
          const cx = X(tx);
          const cy = Y(Math.max(yMin, Math.min(yMax, ty)));
          const isLast = i === traj.length - 1;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={isLast ? 5 : 3}
              fill={isLast ? 'var(--accent)' : 'var(--bg-elevated)'}
              stroke="var(--accent)"
              strokeWidth="1.5"
              opacity={isLast ? 1 : 0.4 + (i / traj.length) * 0.6}
            />
          );
        })}
        {/* axis labels */}
        <text x={W - PAD} y={Y(0) - 6} fontSize="10" fill="var(--text-tertiary)" textAnchor="end" fontFamily="var(--font-mono)">x</text>
        <text x={PAD + 4} y={PAD + 10} fontSize="10" fill="var(--text-tertiary)" fontFamily="var(--font-mono)">L(x)</text>
      </svg>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TOC
// ─────────────────────────────────────────────────────────────────────────────

const Toc = ({ completedSections, activeSectionId, sections }) => {
  const [openModule, setOpenModule] = useState(2);
  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
          Course
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 4 }}>Intro to Neural Networks</div>
        <Progress value={42} label="42% · 7/16 lessons" size="xs" />
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {LESSON_TOC.map((mod, mi) => (
          <div key={mi}>
            <button
              onClick={() => setOpenModule(openModule === mi ? -1 : mi)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--text-secondary)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 500,
              }}
            >
              <Icon name="chevronDown" size={11} style={{
                transform: openModule === mi ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform var(--t-fast)',
              }} />
              <span style={{ flex: 1, color: 'var(--text)' }}>{mod.title}</span>
              <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                {mod.lessons.filter((l) => l.status === 'done').length}/{mod.lessons.length}
              </span>
            </button>
            {openModule === mi && (
              <div style={{ marginLeft: 16, borderLeft: '1px solid var(--border)', paddingLeft: 0, marginTop: 2, marginBottom: 4 }}>
                {mod.lessons.map((les, li) => (
                  <div
                    key={li}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 8px 5px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: les.active ? 'var(--accent-subtle)' : 'transparent',
                      color: les.active ? 'var(--accent-text)' : 'var(--text-secondary)',
                      fontSize: 'var(--fs-sm)',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {les.active && <div style={{ position: 'absolute', left: -1, top: 6, bottom: 6, width: 2, background: 'var(--accent)', borderRadius: 999 }} />}
                    <span style={{
                      width: 14, height: 14,
                      borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: les.status === 'done' ? 'var(--success)' : 'transparent',
                      border: les.status === 'done' ? 'none' : `1.5px solid ${les.active ? 'var(--accent)' : 'var(--border-strong)'}`,
                      color: 'white',
                      flexShrink: 0,
                    }}>
                      {les.status === 'done' && <Icon name="check" size={9} strokeWidth={3} />}
                    </span>
                    <span style={{ flex: 1, fontWeight: les.active ? 500 : 400 }}>{les.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      {/* Section list within current lesson */}
      <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>
          On this page
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 8px',
                fontSize: 'var(--fs-sm)',
                color: s.id === activeSectionId ? 'var(--accent-text)' : 'var(--text-secondary)',
                fontWeight: s.id === activeSectionId ? 500 : 400,
                textDecoration: 'none',
                borderRadius: 'var(--radius-sm)',
                background: s.id === activeSectionId ? 'var(--accent-subtle)' : 'transparent',
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: completedSections.has(s.id) ? 'var(--success)' : s.id === activeSectionId ? 'var(--accent)' : 'var(--border-strong)',
              }} />
              <span style={{ color: 'var(--text-quaternary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>§{s.id.replace('s', '')}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Data ─────────────────────────────────────────────────────────────────

const LESSON_SECTIONS = [
  { id: 's1', label: 'The intuition' },
  { id: 's2', label: 'See it descend' },
  { id: 's3', label: 'Quick check' },
  { id: 's4', label: 'Implement one step' },
  { id: 's5', label: 'Try it: build your own loop' },
];

const LESSON_TOC = [
  {
    title: 'Foundations',
    lessons: [
      { title: 'What is a neuron?',         status: 'done' },
      { title: 'Layers and activations',    status: 'done' },
      { title: 'Forward pass',              status: 'done' },
    ],
  },
  {
    title: 'Optimization',
    lessons: [
      { title: 'The loss function',         status: 'done' },
      { title: 'Gradient descent',          status: 'progress', active: true },
      { title: 'Backpropagation',           status: 'todo' },
      { title: 'Mini-batches and epochs',   status: 'todo' },
    ],
  },
  {
    title: 'Going deeper',
    lessons: [
      { title: 'Vanishing gradients',       status: 'todo' },
      { title: 'Adam, RMSprop, momentum',   status: 'todo' },
      { title: 'Regularization',            status: 'todo' },
    ],
  },
];

const LESSON_INITIAL_NOTES = `Gradient descent is just walking downhill, blindfolded.

Key insight: the *negative* gradient is the
direction of steepest descent — locally.

η too high → overshoots, may diverge
η too low  → slow but stable

Modern optimizers (Adam) adapt η automatically.`;

window.LessonView = LessonView;
