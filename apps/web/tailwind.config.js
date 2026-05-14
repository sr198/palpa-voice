/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx,mdx}',
    './components/**/*.{js,jsx,ts,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--palpa-surface-canvas)',
        panel: 'var(--palpa-surface-panel)',
        panelRaised: 'var(--palpa-surface-panel-raised)',
        line: 'var(--palpa-border-default)',
        lineSubtle: 'var(--palpa-border-subtle)',
        ink: 'var(--palpa-text-primary)',
        muted: 'var(--palpa-text-secondary)',
        dim: 'var(--palpa-text-muted)',
        brand: 'var(--palpa-brand-bold)',
        brandSoft: 'var(--palpa-brand-soft)',
        success: 'var(--palpa-success-bold)',
        warning: 'var(--palpa-warning-bold)',
        danger: 'var(--palpa-danger-bold)',
        info: 'var(--palpa-info-bold)'
      },
      borderRadius: {
        shell: 'var(--palpa-radius-shell)',
        panel: 'var(--palpa-radius-panel)',
        chip: 'var(--palpa-radius-chip)'
      },
      boxShadow: {
        panel: 'var(--palpa-shadow-panel)',
        raised: 'var(--palpa-shadow-raised)',
        focus: 'var(--palpa-shadow-focus)'
      },
      fontFamily: {
        sans: ['var(--palpa-font-sans)'],
        mono: ['var(--palpa-font-mono)']
      },
      transitionTimingFunction: {
        productive: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    }
  },
  plugins: []
};
