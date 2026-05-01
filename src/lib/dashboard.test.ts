import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// US-033 — Resume button visual artifact (stuck shimmer/gradient overlay).
//
// The Continue learning hero card (page.tsx > ContinueLearningHero) has an
// absolutely-positioned radial-gradient overlay div as its first child. The
// overlay sits at the right edge of the card (right: -60, top: -60, width:
// 240, height: 240) and is clipped by the card's `overflow: hidden`.
//
// Bug: The Resume <Link> is the section's third child and originally had no
// explicit `position` (default `static`). Per CSS painting order, positioned
// siblings (the absolute overlay) paint above non-positioned siblings — so
// the gradient covered the right edge of the Resume label.
//
// Fix: declare `position: 'relative'` on the Resume Link so it joins the
// positioned painting tier; tree order then puts it on top of the overlay.

describe('Dashboard hero (US-033) — Resume button stacking', () => {
  const pageSrc = readFileSync(
    path.join(process.cwd(), 'src/app/page.tsx'),
    'utf8',
  );

  it('hero contains the absolute radial-gradient overlay sibling (bug condition)', () => {
    expect(pageSrc).toMatch(/position:\s*['"]absolute['"][\s\S]{0,400}?radial-gradient/);
  });

  it("Resume button declares position: 'relative' so it stacks above the overlay", () => {
    const startIdx = pageSrc.indexOf('data-testid="continue-hero-resume"');
    expect(startIdx, 'Resume Link with continue-hero-resume test id must exist').toBeGreaterThan(-1);

    // The Resume Link spans multiple lines:
    //   <Link
    //     data-testid="continue-hero-resume"
    //     href={...}
    //     style={{ ...primaryButtonStyle, height: 44, ... }}
    //   >
    // Capture from the testid up to the `>` that closes the JSX opening tag
    // (i.e. one position past the closing `}}` of the inline style prop).
    const closingStyleIdx = pageSrc.indexOf('}}', startIdx);
    expect(closingStyleIdx, 'Resume Link must have an inline style prop').toBeGreaterThan(-1);
    const tagOpenEnd = pageSrc.indexOf('>', closingStyleIdx);
    expect(tagOpenEnd).toBeGreaterThan(-1);
    const linkTag = pageSrc.slice(startIdx, tagOpenEnd);

    expect(
      linkTag,
      "Resume button must declare position: 'relative' to stack above the absolute gradient overlay (US-033)",
    ).toMatch(/position:\s*['"]relative['"]/);
  });
});
