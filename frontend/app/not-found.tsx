/*
 * Global 404-side. Vises av Next.js når en rute ikke matcher.
 * Inkluderer et lite Snake-spill for litt moro mens brukeren er her.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Home, LayoutDashboard, Gamepad2 } from "lucide-react";
import { useLanguage } from "@/app/i18n";

/* Snake-spillogikk */
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type Point = { x: number; y: number };

const GRID = 25;
const CELL = 20;
const TICK_MS = 110;
const CANVAS_PX = GRID * CELL;

function randomFood(snake: Point[]): Point {
  let p: Point;
  do {
    p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
  } while (snake.some((s) => s.x === p.x && s.y === p.y));
  return p;
}

function SnakeGame({ onScore }: { onScore: (s: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    snake: [{ x: 10, y: 10 }] as Point[],
    food: { x: 15, y: 10 } as Point,
    dir: "RIGHT" as Direction,
    nextDir: "RIGHT" as Direction,
    alive: true,
    score: 0,
  });
  const [gameOver, setGameOver] = useState(false);
  const { t } = useLanguage();

  const reset = useCallback(() => {
    const s = stateRef.current;
    s.snake = [{ x: 10, y: 10 }];
    s.food = { x: 15, y: 10 };
    s.dir = "RIGHT";
    s.nextDir = "RIGHT";
    s.alive = true;
    s.score = 0;
    onScore(0);
    setGameOver(false);
  }, [onScore]);

  /* Keyboard */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = stateRef.current;
      if (!s.alive) return;
      const map: Record<string, Direction> = {
        ArrowUp: "UP",
        ArrowDown: "DOWN",
        ArrowLeft: "LEFT",
        ArrowRight: "RIGHT",
        w: "UP",
        s: "DOWN",
        a: "LEFT",
        d: "RIGHT",
      };
      const nd = map[e.key];
      if (!nd) return;
      e.preventDefault();
      const opp: Record<Direction, Direction> = {
        UP: "DOWN",
        DOWN: "UP",
        LEFT: "RIGHT",
        RIGHT: "LEFT",
      };
      if (opp[nd] !== s.dir) s.nextDir = nd;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Touch/swipe */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let startX = 0,
      startY = 0;
    function onTouchStart(e: TouchEvent) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }
    function onTouchEnd(e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
      const s = stateRef.current;
      if (!s.alive) return;
      const opp: Record<Direction, Direction> = {
        UP: "DOWN",
        DOWN: "UP",
        LEFT: "RIGHT",
        RIGHT: "LEFT",
      };
      let nd: Direction;
      if (Math.abs(dx) > Math.abs(dy)) {
        nd = dx > 0 ? "RIGHT" : "LEFT";
      } else {
        nd = dy > 0 ? "DOWN" : "UP";
      }
      if (opp[nd] !== s.dir) s.nextDir = nd;
    }
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  /* Game loop */
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s.alive) return;

      s.dir = s.nextDir;
      const head = { ...s.snake[0] };
      if (s.dir === "UP") head.y--;
      else if (s.dir === "DOWN") head.y++;
      else if (s.dir === "LEFT") head.x--;
      else head.x++;

      /* Wall or self collision */
      if (
        head.x < 0 ||
        head.x >= GRID ||
        head.y < 0 ||
        head.y >= GRID ||
        s.snake.some((p) => p.x === head.x && p.y === head.y)
      ) {
        s.alive = false;
        setGameOver(true);
        return;
      }

      s.snake.unshift(head);
      if (head.x === s.food.x && head.y === s.food.y) {
        s.score++;
        onScore(s.score);
        s.food = randomFood(s.snake);
      } else {
        s.snake.pop();
      }

      const isDark = document.documentElement.classList.contains("dark");
      ctx.fillStyle = isDark ? "#0f172a" : "#f1f5f9";
      ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

      ctx.strokeStyle = isDark ? "#1e293b" : "#e2e8f0";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= GRID; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL, 0);
        ctx.lineTo(i * CELL, CANVAS_PX);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL);
        ctx.lineTo(CANVAS_PX, i * CELL);
        ctx.stroke();
      }

      for (let i = 0; i < s.snake.length; i++) {
        const p = s.snake[i];
        const isHead = i === 0;
        ctx.fillStyle = isHead ? (isDark ? "#60a5fa" : "#2563eb") : isDark ? "#3b82f6" : "#2563eb";
        ctx.globalAlpha = isHead ? 1 : 0.7 + 0.3 * (1 - i / s.snake.length);
        const r = 3;
        const x = p.x * CELL + 1;
        const y = p.y * CELL + 1;
        const w = CELL - 2;
        ctx.beginPath();
        ctx.roundRect(x, y, w, w, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const fx = s.food.x * CELL + CELL / 2;
      const fy = s.food.y * CELL + CELL / 2;
      ctx.fillStyle = isDark ? "#f87171" : "#dc2626";
      ctx.beginPath();
      ctx.arc(fx, fy, CELL / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    }, TICK_MS);

    return () => clearInterval(id);
  }, [onScore]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={CANVAS_PX}
        height={CANVAS_PX}
        className="rounded-lg border border-slate-200 dark:border-slate-700 touch-none"
      />
      {gameOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/60 backdrop-blur-sm">
          <p className="text-lg font-bold text-white">{t("errorPages.notFound.gameOver")}</p>
          <p className="mt-1 text-sm text-slate-300">
            {t("errorPages.notFound.gameScore")}: {stateRef.current.score}
          </p>
          <button
            onClick={reset}
            className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t("errorPages.notFound.gameRestart")}
          </button>
        </div>
      )}
    </div>
  );
}

/* 404-side */
export default function NotFound() {
  const { t } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-md text-center">
        <p className="text-7xl font-black tabular-nums text-blue-600/20 dark:text-blue-400/20 select-none">
          404
        </p>
        <p className="mt-2 text-sm font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          {t("errorPages.notFound.eyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("errorPages.notFound.title")}</h1>
        <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">
          {t("errorPages.notFound.description")}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            <Home className="h-4 w-4" />
            {t("errorPages.notFound.goHome")}
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t("errorPages.notFound.goDashboard")}
          </Link>
        </div>

        {/* Snake-spill */}
        <div className="mt-10">
          {!playing ? (
            <button
              onClick={() => setPlaying(true)}
              className="inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
            >
              <Gamepad2 className="h-4 w-4" />
              {t("errorPages.notFound.gameTitle")}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t("errorPages.notFound.gameScore")}: {score}
                </span>
              </div>
              <SnakeGame onScore={setScore} />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {t("errorPages.notFound.gameControls")}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
