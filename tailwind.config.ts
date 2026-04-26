import type { Config } from 'tailwindcss';

export default {
  content: ['./app/static/src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0a0e27', mid: '#1a1a3e', far: '#2d1b4e' },
        surface: { DEFAULT: 'rgba(255,255,255,0.04)', hover: 'rgba(255,255,255,0.06)' },
        border: { DEFAULT: 'rgba(255,255,255,0.08)', accent: 'rgba(124,131,253,0.2)' },
        text: { DEFAULT: '#e8eaff', muted: '#9aa0d4', faint: '#6c70a0' },
        accent: { DEFAULT: '#7c83fd', secondary: '#ff6b9d', success: '#4ecca3', error: '#ff7a92' },
        success: '#4ecca3',
        error: '#ff7a92',
      },
      backgroundImage: {
        'app-bg': 'linear-gradient(135deg, #0a0e27 0%, #1a1a3e 50%, #2d1b4e 100%)',
        'accent-gradient': 'linear-gradient(90deg, #7c83fd, #ff6b9d)',
        'accent-radial': 'radial-gradient(circle at top left, #7c83fd, #ff6b9d)',
      },
      boxShadow: {
        neon: '0 0 12px rgba(124,131,253,0.4)',
        'neon-strong': '0 0 16px rgba(124,131,253,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
        glass: '0 6px 20px rgba(0,0,0,0.3)',
      },
      backdropBlur: {
        glass: '10px',
      },
    },
  },
  plugins: [],
} satisfies Config;
