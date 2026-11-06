/**
 * @file The publish dialog's steps (specs/feedback.md): reading the preview,
 *   which only reads, then showing exactly what would be sent, then posting
 *   that and nothing else, by handing the preview's digest back. If what would
 *   be sent changed since it was read (a new record, a thread that appeared),
 *   the server refuses, and the new preview is shown to be read again. Nothing
 *   is posted but by `post`.
 */

import type { Client, PublishPreview } from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef, useState } from "react";

export type PublishStep =
  /** `shown` is the preview before, while hiding names reads it again. */
  | { step: "reading"; shown?: PublishPreview }
  | { step: "preview"; preview: PublishPreview; changed: boolean }
  /** `shown` stays in view, dimmed, so the dialog keeps its shape. */
  | { step: "readFailed"; error: string; shown?: PublishPreview }
  | { step: "posting"; preview: PublishPreview }
  | { step: "postFailed"; preview: PublishPreview; error: string }
  | { step: "posted"; url: string; kind: "created" | "commented" };

/** The preview a step has to show, if any. */
export const previewIn = (step: PublishStep): PublishPreview | undefined => {
  if (step.step === "reading" || step.step === "readFailed") return step.shown;
  return "preview" in step ? step.preview : undefined;
};

/** Whether the preview in view isn't what would be sent now. */
export const isStale = (step: PublishStep): boolean =>
  step.step === "reading" || step.step === "readFailed";

/** An error as a sentence, so the words after it don't run on. */
export const sentence = (words: string): string =>
  /[.!?]$/u.test(words.trim()) ? words.trim() : `${words.trim()}.`;

export const usePublish = (
  client: Client,
  item: string,
  onPosted: () => void,
) => {
  const [hideNames, setHideNames] = useState(false);
  const [step, setStep] = useState<PublishStep>({ step: "reading" });
  const newest = useRef(0);

  /** Reads the preview; only the newest read's answer is shown. */
  const fetchPreview = useCallback(
    async (hide: boolean): Promise<void> => {
      newest.current += 1;
      const mine = newest.current;
      const answer = await client.call("publishPreview", {
        params: { id: item },
        body: { hideNames: hide },
      });
      if (mine !== newest.current) return;
      setStep(before => {
        if (answer.ok) {
          return { step: "preview", preview: answer.data, changed: false };
        }
        const shown = previewIn(before);
        return shown === undefined
          ? { step: "readFailed", error: answer.error }
          : { step: "readFailed", error: answer.error, shown };
      });
    },
    [client, item],
  );

  // It opens reading, so the first read needs no step of its own.
  useEffect(() => {
    void fetchPreview(false);
  }, [fetchPreview]);

  const read = (hide: boolean, shown?: PublishPreview): void => {
    setStep(
      shown === undefined ? { step: "reading" } : { step: "reading", shown },
    );
    void fetchPreview(hide);
  };

  const post = async (preview: PublishPreview): Promise<void> => {
    setStep({ step: "posting", preview });
    const answer = await client.call("publish", {
      params: { id: item },
      body: { hideNames, digest: preview.digest },
    });
    if (answer.ok) {
      setStep({ step: "posted", url: answer.data.url, kind: answer.data.kind });
      onPosted();
      return;
    }
    if (answer.status !== 409) {
      setStep({ step: "postFailed", preview, error: answer.error });
      return;
    }
    // Refused before sending: read what it would send now.
    const again = await client.call("publishPreview", {
      params: { id: item },
      body: { hideNames },
    });
    if (!again.ok) {
      setStep({ step: "readFailed", error: again.error, shown: preview });
    } else if (again.data.digest === preview.digest) {
      setStep({ step: "postFailed", preview, error: answer.error });
    } else {
      setStep({ step: "preview", preview: again.data, changed: true });
    }
  };

  return {
    step,
    hideNames,
    setHideNames: (hide: boolean): void => {
      setHideNames(hide);
      read(hide, previewIn(step));
    },
    tryAgain: (): void => {
      if (step.step === "postFailed") void post(step.preview);
      else read(hideNames);
    },
    post: (): void => {
      if (step.step === "preview") void post(step.preview);
    },
  };
};
