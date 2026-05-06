import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // One Eighty brand placeholders — refine when brand tokens land
        brand: {
          DEFAULT: "#0F172A",
          accent: "#F97316",
        },
      },
    },
  },
  plugins: [],
};

export default config;
