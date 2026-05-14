/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        field: '#f7f9fb',
        line: '#d8dee8',
        signal: '#0f766e',
        warning: '#b45309',
        miss: '#b91c1c',
      },
      boxShadow: {
        panel: '0 12px 30px rgba(17, 24, 39, 0.08)',
      },
    },
  },
  plugins: [],
};
