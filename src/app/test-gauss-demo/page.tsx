'use client';

import { useState } from 'react';

import { GaussDemo } from '@/widgets/Demo/GaussDemo';
import type { DemoData } from '@/widgets/Demo/schema';
import { Widget } from '@/widgets/Widget';

const VARIANTS: Array<{ id: string; title: string; data: DemoData }> = [
  {
    id: 'cameraman',
    title: 'Cameraman — sharp edges',
    data: {
      demoType: 'gauss',
      imageSrc: '/demo-images/cameraman.jpg',
      params: { sigmaMin: 0, sigmaMax: 10, sigmaDefault: 1.5 },
    },
  },
  {
    id: 'lena',
    title: 'Color reference — astronaut',
    data: {
      demoType: 'gauss',
      imageSrc: '/demo-images/lena.jpg',
      params: { sigmaMin: 0, sigmaMax: 10, sigmaDefault: 1.5 },
    },
  },
  {
    id: 'noise',
    title: 'Noise test — watch noise dissolve',
    data: {
      demoType: 'gauss',
      imageSrc: '/demo-images/noise-test.png',
      params: { sigmaMin: 0, sigmaMax: 10, sigmaDefault: 0 },
    },
  },
];

export default function TestGaussDemoPage() {
  const [variantId, setVariantId] = useState<string>(VARIANTS[0].id);
  const variant = VARIANTS.find((v) => v.id === variantId) ?? VARIANTS[0];

  return (
    <main
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh',
        padding: 'var(--space-7)',
        fontFamily: 'var(--font-prose)',
      }}
    >
      <h1
        data-testid="test-gauss-demo-h1"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          marginBottom: 'var(--space-2)',
        }}
      >
        GaussDemo — interactive Gaussian blur
      </h1>
      <p
        style={{
          fontSize: 'var(--fs-md)',
          color: 'var(--text-secondary)',
          maxWidth: '640px',
          marginBottom: 'var(--space-5)',
        }}
      >
        Drag σ to convolve the image with a Gaussian kernel of that standard
        deviation. Switch images below to compare behavior on a sharp grayscale
        photo, a colorful color reference, and a synthetic noise sample.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-5)',
          flexWrap: 'wrap',
        }}
      >
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            data-testid={`gauss-demo-variant-${v.id}`}
            onClick={() => setVariantId(v.id)}
            style={{
              padding: '6px var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-strong)',
              background:
                variantId === v.id
                  ? 'var(--accent-subtle)'
                  : 'var(--bg-elevated)',
              color:
                variantId === v.id ? 'var(--accent-text)' : 'var(--text)',
              fontSize: 'var(--fs-sm)',
              cursor: 'pointer',
            }}
          >
            {v.title}
          </button>
        ))}
      </div>
      <section style={{ maxWidth: '780px' }}>
        <Widget
          type="demo"
          sectionNumber={1}
          title={variant.title}
          status="progress"
        >
          <GaussDemo key={variant.id} data={variant.data} />
        </Widget>
      </section>
    </main>
  );
}
