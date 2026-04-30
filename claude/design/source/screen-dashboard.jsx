// AI Lecturer — Dashboard ("My courses")

const DashboardView = () => {
  const [view, setView] = useState('grid');
  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-sans)',
      display: 'flex', flexDirection: 'column',
      overflow: 'auto',
    }}>
      {/* TOP BAR */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
        padding: 'var(--space-4) var(--space-6)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo />
          <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', letterSpacing: '-0.01em' }}>AI Lecturer</span>
        </div>
        <nav style={{ display: 'flex', gap: 2, marginLeft: 'var(--space-5)' }}>
          {['My courses', 'Library', 'History'].map((l, i) => (
            <button key={l} style={{
              padding: '6px 12px',
              border: 'none',
              background: i === 0 ? 'var(--bg-active)' : 'transparent',
              color: i === 0 ? 'var(--text)' : 'var(--text-tertiary)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'inherit', fontSize: 'var(--fs-sm)',
              fontWeight: i === 0 ? 500 : 400,
              cursor: 'pointer',
            }}>{l}</button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <Input leftIcon="search" placeholder="Search courses, lessons…" size="md" style={{ width: 280 }} rightSlot={<Kbd>⌘K</Kbd>} />
        <Button variant="ghost" size="md" leftIcon="settings" />
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: 'var(--space-7) var(--space-6) var(--space-9)', width: '100%' }}>
        {/* Continue learning hero */}
        <ContinueHero />

        {/* All courses header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'var(--space-7)', marginBottom: 'var(--space-5)' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              All courses
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)' }}>
              5 courses · 1 in progress · 1 completed
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 2 }}>
              <button onClick={() => setView('grid')} style={{
                ...iconBtnSm,
                background: view === 'grid' ? 'var(--bg-elevated)' : 'transparent',
                boxShadow: view === 'grid' ? 'var(--shadow-xs)' : 'none',
                color: view === 'grid' ? 'var(--text)' : 'var(--text-tertiary)',
              }}><Icon name="grid" size={13} /></button>
              <button onClick={() => setView('list')} style={{
                ...iconBtnSm,
                background: view === 'list' ? 'var(--bg-elevated)' : 'transparent',
                boxShadow: view === 'list' ? 'var(--shadow-xs)' : 'none',
                color: view === 'list' ? 'var(--text)' : 'var(--text-tertiary)',
              }}><Icon name="list" size={13} /></button>
            </div>
            <Button variant="primary" size="md" leftIcon="plus" kbd="⌘N">
              New course
            </Button>
          </div>
        </div>

        {/* Course grid */}
        {view === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-5)' }}>
            {DASHBOARD_COURSES.map((c, i) => <CourseCard key={i} course={c} />)}
            <NewCourseCard />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--border)' }}>
            {DASHBOARD_COURSES.map((c, i) => <CourseRow key={i} course={c} />)}
          </div>
        )}
      </div>
    </div>
  );
};

const Logo = () => (
  <div style={{
    width: 28, height: 28,
    borderRadius: 'var(--radius-md)',
    background: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'white',
  }}>
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h6M2 8h12M2 12h8" />
    </svg>
  </div>
);

const iconBtnSm = {
  width: 28, height: 26,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

const ContinueHero = () => (
  <div style={{
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-6)',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 'var(--space-6)',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  }}>
    <div style={{ position: 'absolute', right: -40, top: -40, width: 280, height: 280, background: 'radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)', pointerEvents: 'none' }} />
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: '10.5px', color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
        Continue where you left off
      </div>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
        Gradient Descent
      </h2>
      <p style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
        Lesson 5 of 16 · Intro to Neural Networks · You're 2/5 sections through this lesson.
      </p>
      <div style={{ marginTop: 'var(--space-4)', maxWidth: 380 }}>
        <Progress value={42} max={100} label="Course progress" showValue size="sm" />
      </div>
      <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 8 }}>
        <Button variant="primary" size="md" rightIcon="arrowRight">Resume lesson</Button>
        <Button variant="ghost" size="md">View course</Button>
      </div>
    </div>
    <div style={{ width: 240, height: 160, position: 'relative' }}>
      <MiniLossPlot />
    </div>
  </div>
);

const MiniLossPlot = () => {
  const W = 240, H = 160;
  const loss = (x) => x ** 4 - 3 * x ** 2 + x;
  const xMin = -3.5, xMax = 3, yMin = -8, yMax = 30;
  const X = (x) => 8 + ((x - xMin) / (xMax - xMin)) * (W - 16);
  const Y = (y) => 8 + (1 - (y - yMin) / (yMax - yMin)) * (H - 16);
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const x = xMin + (i / 80) * (xMax - xMin);
    pts.push([x, loss(x)]);
  }
  const traj = [];
  let x = -3.2;
  for (let i = 0; i < 14; i++) { traj.push([x, loss(x)]); x = x - 0.07 * (4 * x ** 3 - 6 * x + 1); }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <path d={pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${X(Math.max(xMin, Math.min(xMax, x)))} ${Y(Math.max(yMin, Math.min(yMax, y)))}`).join(' ')} fill="none" stroke="var(--text-quaternary)" strokeWidth="1.2" />
      <path d={traj.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${X(Math.max(xMin, Math.min(xMax, x)))} ${Y(Math.max(yMin, Math.min(yMax, y)))}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3,3" />
      {traj.map(([x, y], i) => <circle key={i} cx={X(Math.max(xMin, Math.min(xMax, x)))} cy={Y(Math.max(yMin, Math.min(yMax, y)))} r={i === traj.length - 1 ? 4 : 2} fill={i === traj.length - 1 ? 'var(--accent)' : 'var(--bg-elevated)'} stroke="var(--accent)" strokeWidth="1.2" />)}
    </svg>
  );
};

const CourseCard = ({ course }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        cursor: 'pointer',
        transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
        ...(hover ? { borderColor: 'var(--border-strong)', boxShadow: 'var(--shadow-sm)' } : {}),
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      }}
    >
      <div style={{
        height: 64,
        borderRadius: 'var(--radius-md)',
        background: course.bg,
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: course.color,
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        fontWeight: 600,
        letterSpacing: '-0.04em',
        overflow: 'hidden',
      }}>
        {course.glyph}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Badge tone={course.statusTone} size="sm" dot>{course.status}</Badge>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>{course.lessons} lessons</span>
        </div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, letterSpacing: '-0.01em' }}>{course.title}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{course.desc}</p>
      </div>
      <Progress value={course.progress} size="xs" tone={course.progress === 100 ? 'success' : 'accent'} />
    </div>
  );
};

const CourseRow = ({ course }) => (
  <div style={{
    background: 'var(--bg-elevated)',
    padding: '14px 18px',
    display: 'grid',
    gridTemplateColumns: '40px 1fr 100px 120px 28px',
    gap: 16,
    alignItems: 'center',
    cursor: 'pointer',
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 'var(--radius-md)',
      background: course.bg, color: course.color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16,
    }}>{course.glyph}</div>
    <div>
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>{course.title}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>{course.desc}</div>
    </div>
    <Badge tone={course.statusTone} size="sm" dot>{course.status}</Badge>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Progress value={course.progress} size="xs" tone={course.progress === 100 ? 'success' : 'accent'} />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{course.progress}%</span>
    </div>
    <Icon name="chevronRight" size={14} style={{ color: 'var(--text-tertiary)' }} />
  </div>
);

const NewCourseCard = () => (
  <button style={{
    background: 'transparent',
    border: '1px dashed var(--border-strong)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5)',
    cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    color: 'var(--text-tertiary)',
    minHeight: 220,
    fontFamily: 'inherit',
    transition: 'border-color var(--t-fast), color var(--t-fast)',
  }}
  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent-text)'; }}
  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
  >
    <div style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid currentColor', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="plus" size={16} />
    </div>
    <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>Create a new course</span>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-quaternary)' }}>Pick a topic — agents do the rest</span>
  </button>
);

const DASHBOARD_COURSES = [
  { title: 'Intro to Neural Networks',  desc: 'Foundations through optimization and beyond.',     lessons: 16, progress: 42, status: 'In progress', statusTone: 'accent',  bg: 'color-mix(in srgb, var(--accent) 12%, var(--bg-subtle))', color: 'var(--accent)',          glyph: 'NN' },
  { title: 'Probability for ML',         desc: 'Distributions, Bayes, and what likelihood means.', lessons: 12, progress: 100, status: 'Completed',   statusTone: 'success', bg: 'color-mix(in srgb, var(--success) 12%, var(--bg-subtle))', color: 'var(--success)',         glyph: 'P' },
  { title: 'CSS Grid mastery',           desc: 'Past flex — into two-dimensional layouts.',         lessons: 8,  progress: 0,   status: 'Not started', statusTone: 'neutral', bg: 'color-mix(in srgb, var(--insight) 12%, var(--bg-subtle))', color: 'var(--insight)',         glyph: '⊞' },
  { title: 'Linear algebra refresher',   desc: 'Just enough for ML — vectors to eigenvectors.',     lessons: 10, progress: 18,  status: 'In progress', statusTone: 'accent',  bg: 'color-mix(in srgb, var(--warning) 14%, var(--bg-subtle))', color: 'var(--warning)',         glyph: 'A' },
  { title: 'How Transformers work',      desc: 'Attention, end-to-end, with code.',                 lessons: 14, progress: 0,   status: 'Not started', statusTone: 'neutral', bg: 'color-mix(in srgb, var(--text-secondary) 16%, var(--bg-subtle))', color: 'var(--text-secondary)', glyph: 'T' },
];

window.DashboardView = DashboardView;
