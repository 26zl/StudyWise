/*
 * Dekorativ bakgrunn for forsiden — utdanningstema.
 * Spredte SVG-figurer (formler, geometriske former, ikoner) som flyter subtilt.
 * Pure SVG + CSS — ingen JavaScript, server-renderbar.
 * pointer-events-none + aria-hidden så det ikke forstyrrer interaksjon eller skjermlesere.
 */
import {
  Atom,
  BookMarked,
  Calculator,
  Compass,
  FlaskConical,
  GraduationCap,
  Lightbulb,
  Microscope,
  PenTool,
  Sigma,
} from "lucide-react";
import type { ReactNode } from "react";

interface FloatingItemProps {
  children: ReactNode;
  /** Tailwind klasser for posisjon (top/left/bottom/right) */
  position: string;
  /** Tailwind rotasjon */
  rotate?: string;
  /** Animasjonsforsinkelse i sekunder (0–10) */
  delay?: number;
  /** Animasjonsvarighet i sekunder */
  duration?: number;
}

function Floating({ children, position, rotate = "", delay = 0, duration = 8 }: FloatingItemProps) {
  // Animasjonen settes via inline style i stedet for arbitrary Tailwind-klasser.
  // Grunn: `animate-[shorthand]` + `[animation-delay:...]` har ikke garantert
  // cascade-rekkefølge — shorthand kan resette delay til 0 og ødelegge spredningen.
  return (
    <div
      className={`absolute ${position} ${rotate} text-slate-400/30 dark:text-slate-500/20 motion-reduce:animate-none`}
      style={{
        animation: `landing-float ${duration}s ease-in-out ${delay}s infinite`,
      }}
    >
      {children}
    </div>
  );
}

export function LandingBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Subtilt prikkemønster i bakgrunnen */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(148_163_184/0.18)_1px,transparent_0)] bg-size-[32px_32px] dark:bg-[radial-gradient(circle_at_1px_1px,rgb(148_163_184/0.08)_1px,transparent_0)]" />

      {/* Soft gradient blob øverst (allerede i hero, men forsterket bredere) */}
      <div className="absolute -top-32 left-1/2 h-125 w-225 -translate-x-1/2 rounded-full bg-blue-400/10 blur-3xl dark:bg-blue-600/10" />
      <div className="absolute top-40 right-0 h-100 w-100 rounded-full bg-purple-400/10 blur-3xl dark:bg-purple-600/10" />
      <div className="absolute top-60 left-0 h-87.5 w-87.5 rounded-full bg-emerald-400/10 blur-3xl dark:bg-emerald-600/10" />

      {/* Flytende ikoner — utdanning og vitenskap */}
      <Floating position="top-24 left-[8%]" rotate="-rotate-12" delay={0} duration={9}>
        <GraduationCap className="h-12 w-12 md:h-16 md:w-16" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-32 right-[10%]" rotate="rotate-12" delay={1.5} duration={10}>
        <BookMarked className="h-10 w-10 md:h-14 md:w-14" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[55%] left-[5%]" rotate="rotate-6" delay={3} duration={11}>
        <Atom className="h-14 w-14 md:h-20 md:w-20" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[60%] right-[6%]" rotate="-rotate-6" delay={2} duration={9}>
        <FlaskConical className="h-12 w-12 md:h-16 md:w-16" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[40%] left-[12%]" rotate="rotate-3" delay={4} duration={12}>
        <Sigma className="h-10 w-10 md:h-12 md:w-12" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[42%] right-[14%]" rotate="-rotate-3" delay={5} duration={10}>
        <Calculator className="h-10 w-10 md:h-12 md:w-12" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[78%] left-[18%]" rotate="-rotate-12" delay={6} duration={11}>
        <Compass className="h-10 w-10 md:h-14 md:w-14" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[80%] right-[20%]" rotate="rotate-12" delay={2.5} duration={9}>
        <PenTool className="h-9 w-9 md:h-12 md:w-12" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[20%] left-[40%]" rotate="rotate-6" delay={4.5} duration={13}>
        <Lightbulb className="h-8 w-8 md:h-10 md:w-10" strokeWidth={1.5} />
      </Floating>

      <Floating position="top-[68%] left-[45%]" rotate="-rotate-6" delay={1} duration={10}>
        <Microscope className="h-10 w-10 md:h-14 md:w-14" strokeWidth={1.5} />
      </Floating>

      {/* Matematiske formler som tekst */}
      <div
        aria-hidden="true"
        className="absolute top-[15%] right-[28%] select-none font-serif text-2xl text-slate-400/25 dark:text-slate-500/15 md:text-4xl motion-reduce:animate-none"
        style={{ animation: "landing-float 14s ease-in-out 2s infinite" }}
      >
        E = mc²
      </div>
      <div
        aria-hidden="true"
        className="absolute top-[50%] left-[28%] select-none font-serif text-xl text-slate-400/25 dark:text-slate-500/15 md:text-3xl motion-reduce:animate-none"
        style={{ animation: "landing-float 12s ease-in-out 5s infinite" }}
      >
        ∫ ƒ(x) dx
      </div>
      <div
        aria-hidden="true"
        className="absolute top-[72%] right-[32%] select-none font-serif text-xl text-slate-400/25 dark:text-slate-500/15 md:text-3xl motion-reduce:animate-none"
        style={{ animation: "landing-float 13s ease-in-out 3.5s infinite" }}
      >
        a² + b² = c²
      </div>
      <div
        aria-hidden="true"
        className="absolute top-[30%] right-[40%] select-none font-serif text-lg text-slate-400/25 dark:text-slate-500/15 md:text-2xl motion-reduce:animate-none"
        style={{ animation: "landing-float 11s ease-in-out 6s infinite" }}
      >
        π · r²
      </div>

      {/* Geometriske former */}
      <svg
        aria-hidden="true"
        className="absolute top-[25%] left-[25%] h-16 w-16 text-blue-400/20 dark:text-blue-500/15 motion-reduce:animate-none md:h-24 md:w-24"
        style={{ animation: "landing-float 15s ease-in-out 0s infinite" }}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="50" cy="50" r="45" />
        <circle cx="50" cy="50" r="30" />
        <circle cx="50" cy="50" r="15" />
      </svg>

      <svg
        aria-hidden="true"
        className="absolute top-[58%] right-[28%] h-16 w-16 text-purple-400/20 dark:text-purple-500/15 motion-reduce:animate-none md:h-20 md:w-20"
        style={{ animation: "landing-float 13s ease-in-out 4s infinite" }}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polygon points="50,10 90,80 10,80" />
      </svg>

      <svg
        aria-hidden="true"
        className="absolute top-[10%] left-[60%] h-12 w-12 text-emerald-400/20 dark:text-emerald-500/15 motion-reduce:animate-none md:h-16 md:w-16"
        style={{ animation: "landing-float 12s ease-in-out 7s infinite" }}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="15" y="15" width="70" height="70" rx="8" />
        <rect x="30" y="30" width="40" height="40" rx="4" />
      </svg>

      {/* Keyframes for flytende animasjon — definert lokalt slik at vi ikke trenger å endre globals.css */}
      <style>{`
        @keyframes landing-float {
          0%, 100% { transform: translateY(0) translateX(0); }
          25% { transform: translateY(-10px) translateX(4px); }
          50% { transform: translateY(-4px) translateX(-4px); }
          75% { transform: translateY(-12px) translateX(2px); }
        }
      `}</style>
    </div>
  );
}
