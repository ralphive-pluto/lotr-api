import React, { useCallback, useEffect, useState } from "react";
import Helmet from "react-helmet";
import { getQuizRound } from "../helpers/api";
import "./Quiz.css";

interface QuizQuestion {
  id: string;
  category: "who-said-it" | "quote-movie" | "character-trait";
  prompt: string;
  options: string[];
  answerIndex: number;
  source: { label: string; wikiUrl?: string };
}

type Mode = "picker" | "loading" | "playing" | "reveal" | "summary" | "error";

const BEST_KEY = "lotr-quiz:bestScore";
const ROUND_LENGTH = 10;

/** Filled gold One-Ring SVG progress ring with the current question number. */
const ProgressRing: React.FC<{ current: number; total: number }> = ({
  current,
  total,
}) => {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(current / total, 1);
  const dashOffset = circumference * (1 - progress);
  return (
    <svg className="quiz-progress" viewBox="0 0 60 60" aria-hidden="true">
      <circle className="quiz-progress-track" cx="30" cy="30" r={radius} />
      <circle
        className="quiz-progress-fill"
        cx="30"
        cy="30"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 30 30)"
      />
      <text className="quiz-progress-text" x="30" y="35" textAnchor="middle">
        {current}/{total}
      </text>
    </svg>
  );
};

const Quiz: React.FC = () => {
  const [mode, setMode] = useState<Mode>("picker");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [bestScore, setBestScore] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = parseInt(window.localStorage.getItem(BEST_KEY) || "0", 10);
    if (!Number.isNaN(stored)) setBestScore(stored);
  }, []);

  const startRound = useCallback(async () => {
    setMode("loading");
    setError(null);
    setIndex(0);
    setScore(0);
    setChosen(null);
    try {
      const round = await getQuizRound();
      if (!Array.isArray(round) || round.length === 0) {
        setError("The library is empty. Try again later.");
        setMode("error");
        return;
      }
      setQuestions(round);
      setMode("playing");
    } catch (e) {
      setError("Could not reach the archives. Try again in a moment.");
      setMode("error");
    }
  }, []);

  const onPick = (i: number) => {
    if (mode !== "playing") return;
    const q = questions[index];
    setChosen(i);
    if (i === q.answerIndex) setScore((s) => s + 1);
    setMode("reveal");
  };

  const onNext = () => {
    const nextIndex = index + 1;
    if (nextIndex >= questions.length) {
      // Persist best score before showing summary.
      setBestScore((prev) => {
        const next = Math.max(prev, score);
        if (next !== prev) window.localStorage.setItem(BEST_KEY, String(next));
        return next;
      });
      setMode("summary");
      return;
    }
    setIndex(nextIndex);
    setChosen(null);
    setMode("playing");
  };

  const current = questions[index];
  const isCorrect = current && chosen === current.answerIndex;

  return (
    <div className="quiz-page">
      <Helmet>
        <title>Quiz — The One API</title>
      </Helmet>

      <div className="quiz-card">
        <div className="quiz-runes">᛫ ᚱ ᛫ ᛟ ᛫ ᛗ ᛫ ᚷ ᛫</div>

        {mode === "picker" && (
          <>
            <h2 className="quiz-title">The Trial of Lore</h2>
            <p className="quiz-subtitle">
              Ten questions on the deeds, words, and folk of Middle-earth.
            </p>
            {bestScore > 0 && (
              <p className="quiz-score" style={{ textAlign: "center" }}>
                Best so far: <strong>{bestScore}</strong> / {ROUND_LENGTH}
              </p>
            )}
            <div className="quiz-cta-row">
              <button className="quiz-cta" onClick={startRound}>
                Begin the Trial
              </button>
            </div>
          </>
        )}

        {mode === "loading" && (
          <div className="quiz-status">
            Summoning questions from the archives…
          </div>
        )}

        {mode === "error" && (
          <>
            <div className="quiz-status quiz-error">{error}</div>
            <div className="quiz-cta-row">
              <button className="quiz-cta" onClick={startRound}>
                Try Again
              </button>
            </div>
          </>
        )}

        {(mode === "playing" || mode === "reveal") && current && (
          <>
            <div className="quiz-meta">
              <div className="quiz-score">
                Score: <strong>{score}</strong>
              </div>
              <ProgressRing current={index + 1} total={ROUND_LENGTH} />
            </div>
            <p className="quiz-prompt">{current.prompt}</p>
            <div
              className="quiz-options"
              role="radiogroup"
              aria-label="Answers"
            >
              {current.options.map((opt, i) => {
                const cls = ["quiz-option"];
                if (mode === "reveal") {
                  if (i === current.answerIndex)
                    cls.push("correct", "reveal-correct");
                  if (chosen === i && i !== current.answerIndex)
                    cls.push("wrong");
                }
                return (
                  <button
                    key={i}
                    className={cls.join(" ")}
                    onClick={() => onPick(i)}
                    disabled={mode !== "playing"}
                    role="radio"
                    aria-checked={chosen === i}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>

            {mode === "reveal" && (
              <>
                <div className="quiz-reveal">
                  <div
                    className={`quiz-reveal-heading ${isCorrect ? "correct" : "wrong"}`}
                  >
                    {isCorrect ? "✓ Correct!" : "✗ Not quite."}
                  </div>
                  <div className="quiz-reveal-body">
                    {isCorrect ? "You speak true. " : `The right answer was `}
                    <strong>{current.options[current.answerIndex]}</strong>.
                    <br />
                    <em>{current.source.label}</em>
                    {current.source.wikiUrl && (
                      <>
                        {" — "}
                        <a
                          href={current.source.wikiUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          read more
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="quiz-cta-row">
                  <button className="quiz-cta" onClick={onNext}>
                    {index + 1 >= ROUND_LENGTH ? "See your score →" : "Next →"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {mode === "summary" && (
          <div className="quiz-summary">
            <div className="quiz-summary-score">
              {score}
              <span> / {ROUND_LENGTH}</span>
            </div>
            <div className="quiz-summary-label">
              {score === ROUND_LENGTH && "A loremaster of Middle-earth!"}
              {score >= 7 &&
                score < ROUND_LENGTH &&
                "A scholar of the histories."}
              {score >= 4 && score < 7 && "Your studies are well underway."}
              {score < 4 && "Even Pippin started somewhere."}
            </div>
            {score >= bestScore && score > 0 && (
              <div className="quiz-best-banner">★ A new personal best ★</div>
            )}
            {bestScore > 0 && (
              <p className="quiz-score">
                Best so far: <strong>{bestScore}</strong> / {ROUND_LENGTH}
              </p>
            )}
            <div className="quiz-cta-row">
              <button className="quiz-cta" onClick={startRound}>
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Quiz;
