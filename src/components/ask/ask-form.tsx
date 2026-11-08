"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { askAction } from "@/app/actions/ask";
import { answerParts, visibleCitations } from "@/components/ask/answer";
import { ModeBadge } from "@/components/ask/mode-badge";
import { emptyAskState, QUESTION_LIMIT } from "@/components/ask/state";
import { buttonPrimary, inputClass, labelClass } from "@/components/ui/styles";

export function AskForm() {
  const [state, action, pending] = useActionState(askAction, emptyAskState);
  const [question, setQuestion] = useState("");
  const sources = state.result ? visibleCitations(state.result.found, state.result.citations) : [];
  const parts = state.result ? answerParts(state.result.answer, sources.length) : [];

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4" aria-busy={pending}>
        <input type="hidden" name="question" value={question} />
        <label className={labelClass} htmlFor="ask-question">
          <span>Question</span>
          <textarea
            id="ask-question"
            value={question}
            maxLength={QUESTION_LIMIT}
            required
            disabled={pending}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about the notes you can read"
            className={`${inputClass} min-h-32 resize-y leading-relaxed`}
          />
        </label>
        <p className="text-sm text-muted">
          {question.length.toLocaleString("en-US")} / {QUESTION_LIMIT.toLocaleString("en-US")} characters.
        </p>
        {state.error && (
          <p role="alert" className="break-words text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending || question.trim().length === 0} className={`${buttonPrimary} w-full sm:w-auto`}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>

      {state.result ? (
        <section aria-live="polite" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl font-semibold">Answer</h2>
            <ModeBadge mode={state.result.mode} />
          </div>
          <p className="break-words leading-relaxed">
            {parts.map((part, index) =>
              part.type === "text" ? (
                <span key={index}>{part.text}</span>
              ) : (
                <a key={index} href={`#source-${part.n}`} className="font-semibold text-accent underline">
                  <span className="sr-only">Source </span>[{part.n}]
                </a>
              ),
            )}
          </p>
          {sources.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Sources</h3>
              <ol className="space-y-2">
                {sources.map((source, index) => (
                  <li id={`source-${index + 1}`} key={`${source.noteId}-${index}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">{index + 1}.</span>
                    <Link
                      href={`/notes/${source.noteId}`}
                      className="inline-flex min-h-11 items-center break-words font-semibold text-accent hover:underline"
                    >
                      {source.title}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      ) : (
        !state.error && (
          <p className="text-muted">
            Answers cite only notes you can read. If none of them cover the question, you get a refusal and no sources.
          </p>
        )
      )}
    </div>
  );
}
