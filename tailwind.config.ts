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
      // `touch:` = the primary pointer is a finger (phones, tablets). Used where
      // M3's 48px touch target would be wasteful with a mouse.
      screens: {
        touch: { raw: "(pointer: coarse)" },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
      // M3 type scale. Prefer these roles (text-title-md, text-body-lg, ...)
      // over raw sizes; they are registered with tailwind-merge in lib/utils.ts.
      fontSize: {
        "display-sm": ["36px", { lineHeight: "44px", fontWeight: "400" }],
        "headline-lg": ["32px", { lineHeight: "40px", fontWeight: "400" }],
        "headline-md": ["28px", { lineHeight: "36px", fontWeight: "400" }],
        "headline-sm": ["24px", { lineHeight: "32px", fontWeight: "400" }],
        "title-lg": ["22px", { lineHeight: "28px", fontWeight: "400" }],
        "title-md": ["16px", { lineHeight: "24px", fontWeight: "500", letterSpacing: "0.15px" }],
        "title-sm": ["14px", { lineHeight: "20px", fontWeight: "500", letterSpacing: "0.1px" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400", letterSpacing: "0.5px" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400", letterSpacing: "0.25px" }],
        "body-sm": ["12px", { lineHeight: "16px", fontWeight: "400", letterSpacing: "0.4px" }],
        "label-lg": ["14px", { lineHeight: "20px", fontWeight: "500", letterSpacing: "0.1px" }],
        "label-md": ["12px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.5px" }],
        "label-sm": ["11px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.5px" }],
      },
      // M3 elevation levels (values in globals.css).
      boxShadow: {
        "elevation-0": "none",
        "elevation-1": "var(--elevation-1)",
        "elevation-2": "var(--elevation-2)",
        "elevation-3": "var(--elevation-3)",
        "elevation-4": "var(--elevation-4)",
        "elevation-5": "var(--elevation-5)",
      },
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
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
          container: "hsl(var(--brand-container))",
          "container-foreground": "hsl(var(--brand-container-foreground))",
        },
        highlight: "hsl(var(--highlight))",
        "header-foreground": "hsl(var(--header-foreground))",
        outline: {
          DEFAULT: "hsl(var(--outline))",
          variant: "hsl(var(--outline-variant))",
        },
        "switch-track": "hsl(var(--switch-track))",
        "surface-container-high": "hsl(var(--surface-container-high))",
        inverse: {
          surface: "hsl(var(--inverse-surface))",
          foreground: "hsl(var(--inverse-on-surface))",
          primary: "hsl(var(--inverse-primary))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          container: "hsl(var(--warning-container))",
          "container-foreground": "hsl(var(--warning-container-foreground))",
        },
        info: "hsl(var(--info))",
        scrim: "hsl(var(--scrim))",
        "on-scrim": "hsl(var(--on-scrim))",
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
        card: "var(--radius-card)",
        fab: "var(--radius-fab)",
        drawer: "var(--radius-drawer)",
        dialog: "var(--radius-dialog)",
        sheet: "var(--radius-sheet)",
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