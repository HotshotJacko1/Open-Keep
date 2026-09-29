import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import tailwindTypography from "@tailwindcss/typography";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        "note-editor-background": "hsl(var(--note-editor-background))",
        "note-editor-foreground": "hsl(var(--note-editor-foreground))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        "text-primary": "hsl(var(--text-primary))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Material 3 motion tokens. tailwindcss-animate reads these too, so
      // `duration-md3-*` / `ease-md3-*` work on both transitions and
      // animate-in/animate-out. DEFAULT makes every plain `transition-*`
      // utility use the M3 standard curve instead of Tailwind's M2-era one.
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0.0, 0, 1.0)',
        // Emphasized: large moves (dialogs, sheets, drawers)
        'md3-decelerate': 'cubic-bezier(0.05, 0.7, 0.1, 1.0)',
        'md3-accelerate': 'cubic-bezier(0.3, 0.0, 0.8, 0.15)',
        // Standard: small, on-screen changes (menus, tooltips, colour)
        'md3-standard': 'cubic-bezier(0.2, 0.0, 0, 1.0)',
        'md3-standard-decelerate': 'cubic-bezier(0, 0, 0, 1)',
        'md3-standard-accelerate': 'cubic-bezier(0.3, 0, 1, 1)',
      },
      transitionDuration: {
        'md3-short1': '50ms',
        'md3-short2': '100ms',
        'md3-short3': '150ms',
        'md3-short4': '200ms',
        'md3-medium1': '250ms',
        'md3-medium2': '300ms',
        'md3-medium3': '350ms',
        'md3-medium4': '400ms',
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate, tailwindTypography],
} satisfies Config;