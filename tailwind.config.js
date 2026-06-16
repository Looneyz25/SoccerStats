/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        header: 'var(--header)',
        'header-fg': 'var(--header-fg)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          fg: 'var(--accent-fg)',
          soft: 'var(--accent-soft)',
        },
        // Legacy aliases retained so any un-codemodded stragglers still theme.
        ink: 'var(--text)',
        field: 'var(--surface-2)',
        line: 'var(--border)',
        'line-soft': 'var(--border-soft)',
        signal: 'rgb(var(--accent-rgb) / <alpha-value>)',
        warning: 'rgb(180 83 9 / <alpha-value>)',
        miss: 'rgb(185 28 28 / <alpha-value>)',
      },
      fontFamily: {
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: 'var(--panel-shadow)',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out-soft': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
    },
  },
  plugins: [],
};
