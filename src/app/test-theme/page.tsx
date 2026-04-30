const swatches = [
  { name: "bg", token: "var(--bg)", textToken: "var(--text)" },
  { name: "bg-elevated", token: "var(--bg-elevated)", textToken: "var(--text)" },
  { name: "bg-subtle", token: "var(--bg-subtle)", textToken: "var(--text)" },
  { name: "accent", token: "var(--accent)", textToken: "var(--text-on-accent)" },
  { name: "accent-subtle", token: "var(--accent-subtle)", textToken: "var(--accent-text)" },
  { name: "border", token: "var(--border)", textToken: "var(--text-secondary)" },
];

export default function TestThemePage() {
  return (
    <main
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "100vh",
        padding: "var(--space-7)",
        fontFamily: "var(--font-prose)",
      }}
    >
      <h1
        data-testid="theme-h1"
        style={{
          fontSize: "var(--fs-3xl)",
          fontWeight: 600,
          marginBottom: "var(--space-4)",
        }}
      >
        Theme tokens — live preview
      </h1>
      <p
        data-testid="theme-body"
        style={{
          fontSize: "var(--fs-md)",
          color: "var(--text-secondary)",
          maxWidth: "640px",
          lineHeight: "var(--line-height-prose)",
          marginBottom: "var(--space-7)",
        }}
      >
        Six swatches below resolve from CSS variables. Toggle{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>data-theme</code> on{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>&lt;html&gt;</code> to
        verify light/dark switching. The accent button below uses{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>--accent</code>.
      </p>

      <section
        data-testid="theme-swatches"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "var(--space-4)",
          marginBottom: "var(--space-7)",
          maxWidth: "720px",
        }}
      >
        {swatches.map((s) => (
          <div
            key={s.name}
            data-swatch={s.name}
            style={{
              background: s.token,
              color: s.textToken,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-5)",
              fontSize: "var(--fs-sm)",
              fontFamily: "var(--font-mono)",
              boxShadow: "var(--shadow-xs)",
              minHeight: "72px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            {s.name}
          </div>
        ))}
      </section>

      <button
        data-testid="theme-accent-button"
        type="button"
        style={{
          background: "var(--accent)",
          color: "var(--text-on-accent)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3) var(--space-5)",
          fontSize: "var(--fs-sm)",
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          cursor: "pointer",
          boxShadow: "var(--shadow-sm)",
          transition: "background var(--t-base)",
        }}
      >
        Accent button
      </button>
    </main>
  );
}
