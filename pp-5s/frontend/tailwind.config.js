/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe',
          300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6',
          600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a'
        },
        s1: { light: '#fef3c7', DEFAULT: '#f59e0b', dark: '#b45309' }, // Sort
        s2: { light: '#dcfce7', DEFAULT: '#22c55e', dark: '#15803d' }, // Set
        s3: { light: '#dbeafe', DEFAULT: '#3b82f6', dark: '#1d4ed8' }, // Shine
        s4: { light: '#ede9fe', DEFAULT: '#8b5cf6', dark: '#6d28d9' }, // Standardize
        s5: { light: '#fce7f3', DEFAULT: '#ec4899', dark: '#be185d' }, // Sustain
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
