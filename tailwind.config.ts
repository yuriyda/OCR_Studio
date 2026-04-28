import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

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
      // Typography overrides for `prose prose-invert` (rendered markdown preview).
      // Tunes default plugin styles to the Glass+Neon palette: heading accent
      // colour, table borders matching the surface, code-block dark surface,
      // link hover under accent, blockquote accent stripe.
      typography: ({ theme }: { theme: (path: string) => string }) => ({
        invert: {
          css: {
            // Body text + base
            '--tw-prose-body': theme('colors.text.DEFAULT'),
            '--tw-prose-headings': theme('colors.text.DEFAULT'),
            '--tw-prose-lead': theme('colors.text.muted'),
            '--tw-prose-links': theme('colors.accent.DEFAULT'),
            '--tw-prose-bold': theme('colors.text.DEFAULT'),
            '--tw-prose-counters': theme('colors.text.muted'),
            '--tw-prose-bullets': theme('colors.accent.DEFAULT'),
            '--tw-prose-hr': theme('colors.border.DEFAULT'),
            '--tw-prose-quotes': theme('colors.text.DEFAULT'),
            '--tw-prose-quote-borders': theme('colors.accent.DEFAULT'),
            '--tw-prose-captions': theme('colors.text.faint'),
            '--tw-prose-code': theme('colors.accent.DEFAULT'),
            '--tw-prose-pre-code': theme('colors.text.DEFAULT'),
            '--tw-prose-pre-bg': 'rgba(0,0,0,0.4)',
            '--tw-prose-th-borders': theme('colors.accent.DEFAULT'),
            '--tw-prose-td-borders': theme('colors.border.DEFAULT'),

            // Headings — bigger, bolder, with accent underline on h1/h2
            h1: {
              fontSize: '2em',
              fontWeight: '800',
              borderBottom: `2px solid ${theme('colors.accent.DEFAULT')}`,
              paddingBottom: '0.3em',
              marginTop: '1.5em',
              marginBottom: '0.6em',
            },
            h2: {
              fontSize: '1.5em',
              fontWeight: '700',
              borderBottom: `1px solid ${theme('colors.border.DEFAULT')}`,
              paddingBottom: '0.25em',
              marginTop: '1.4em',
              marginBottom: '0.5em',
            },
            h3: { fontSize: '1.25em', fontWeight: '700' },
            h4: { fontSize: '1.1em', fontWeight: '600' },

            // Tables — explicit borders on every cell so structure is visible
            table: {
              borderCollapse: 'collapse',
              width: '100%',
              border: `1px solid ${theme('colors.border.DEFAULT')}`,
            },
            'thead th': {
              backgroundColor: 'rgba(124,131,253,0.1)',
              color: theme('colors.text.DEFAULT'),
              fontWeight: '700',
              padding: '0.5em 0.75em',
              border: `1px solid ${theme('colors.border.DEFAULT')}`,
            },
            'tbody td': {
              padding: '0.5em 0.75em',
              border: `1px solid ${theme('colors.border.DEFAULT')}`,
            },
            'tbody tr:nth-child(even)': {
              backgroundColor: 'rgba(255,255,255,0.02)',
            },

            // Inline code — accent-tinted chip
            code: {
              backgroundColor: 'rgba(124,131,253,0.12)',
              padding: '0.15em 0.4em',
              borderRadius: '0.25rem',
              fontWeight: '500',
              fontSize: '0.9em',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },

            // Code blocks — dark panel
            pre: {
              backgroundColor: 'rgba(0,0,0,0.4)',
              border: `1px solid ${theme('colors.border.DEFAULT')}`,
              borderRadius: '0.5rem',
              padding: '1em 1.25em',
            },

            // Blockquote — accent left border
            blockquote: {
              borderLeftWidth: '4px',
              borderLeftColor: theme('colors.accent.DEFAULT'),
              backgroundColor: 'rgba(124,131,253,0.05)',
              padding: '0.5em 1em',
              fontStyle: 'italic',
              borderRadius: '0 0.25rem 0.25rem 0',
            },

            // Links — underline on hover, no quote-style underline by default
            a: {
              textDecoration: 'none',
              borderBottom: `1px dashed ${theme('colors.accent.DEFAULT')}`,
              transition: 'all 0.15s',
            },
            'a:hover': {
              borderBottomStyle: 'solid',
              color: theme('colors.accent.secondary'),
            },

            // HR — neon-tinted divider
            hr: {
              borderColor: theme('colors.accent.DEFAULT'),
              opacity: '0.3',
              marginTop: '2em',
              marginBottom: '2em',
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
} satisfies Config;
