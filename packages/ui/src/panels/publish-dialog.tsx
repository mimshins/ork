/**
 * @file The publish dialog: an `ork` item as a post to Ork's Discussions,
 *   previewed and then confirmed, the panel's `y`. Opening it only reads; Post
 *   is never its default, so Enter elsewhere doesn't press it, and the focus
 *   starts on the text to be sent. While it posts it can't be closed, since
 *   that would hide whether the post went. Cancelled, it says nothing was
 *   sent.
 */

import type { Client } from "@krapht/ork-server/client";
import { type RefObject, useCallback, useEffect, useId, useRef } from "react";

import { Button } from "../components/button.tsx";
import { Checkbox } from "../components/checkbox.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Reason } from "./dialog-form.tsx";
import {
  FailureSlot,
  HideNamesHint,
  Posted,
  PreviewWells,
  PublishFoot,
  WhereLine,
} from "./publish-preview.tsx";
import {
  isStale,
  previewIn,
  type PublishStep,
  sentence,
  usePublish,
} from "./use-publish.ts";

const CHANGED =
  "The text to post changed since you read it. Read it again before posting.";

/** What failed, in words, if something did. */
const failureOf = (step: PublishStep): string | null => {
  if (step.step === "readFailed") {
    return `Could not read Ork's Discussions: ${sentence(step.error)} Nothing was sent.`;
  }
  return step.step === "postFailed"
    ? `Could not post: ${sentence(step.error)}`
    : null;
};

/** Whether the dialog's focus went with what had it. */
const focusLost = (): boolean => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    active.getAttribute("role") === "dialog"
  );
};

/** Why Post can't be pressed now, if it can't. */
const postBlocked = (step: PublishStep): string | null => {
  // A failed read says so in its own alert, once.
  return step.step === "reading" ? "Reading the preview…" : null;
};

type Tracked = { busy: boolean; tried: boolean };

type BodyProps = {
  client: Client;
  /** The whole fingerprint, and the id as the CLI shows it. */
  item: string;
  id: string;
  region: RefObject<HTMLElement | null>;
  /** Hears each step, so closing knows whether it may and what to say. */
  onStep: (step: PublishStep) => void;
  onClose: () => void;
  onPosted: () => void;
};

const PublishBody = ({
  client,
  item,
  id,
  region,
  onStep,
  onClose,
  onPosted,
}: BodyProps) => {
  const flow = usePublish(client, item, onPosted);
  const { step, hideNames } = flow;
  const hintId = useId();
  const reasonId = useId();
  const failureId = useId();
  const staleId = useId();
  useEffect(() => {
    onStep(step);
    // A Try again that went with its retry leaves the focus on the text.
    if (step.step !== "posted" && focusLost()) region.current?.focus();
  }, [step, onStep, region]);
  if (step.step === "posted") {
    return (
      <Posted
        id={id}
        kind={step.kind}
        onClose={onClose}
        url={step.url}
      />
    );
  }
  const preview = previewIn(step);
  const posting = step.step === "posting";
  const comment = preview?.plan.kind === "comment";
  return (
    <>
      {step.step === "preview" && step.changed ? (
        <p role="alert">{CHANGED}</p>
      ) : null}
      {preview === undefined ? null : <WhereLine preview={preview} />}
      <PreviewWells
        preview={preview}
        reading={step.step === "reading"}
        region={region}
        stale={isStale(step)}
        staleId={staleId}
      />
      <Checkbox
        checked={hideNames}
        describedBy={hintId}
        disabled={posting}
        label="Hide repository and workflow names"
        onChange={flow.setHideNames}
      />
      <HideNamesHint id={hintId} />
      <CopyCommand
        command={`ork feedback publish ${id}${hideNames ? " --hide-names" : ""}`}
      />
      <FailureSlot
        id={failureId}
        onTryAgain={flow.tryAgain}
        takeFocus={step.step === "postFailed" ? "always" : "ifLost"}
        words={failureOf(step)}
      />
      <Reason
        id={reasonId}
        why={postBlocked(step)}
      />
      <PublishFoot>
        <Button
          disabled={posting}
          focusableWhenDisabled
          onClick={onClose}
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          aria-describedby={`${reasonId} ${failureId}`}
          disabled={step.step !== "preview"}
          focusableWhenDisabled
          onClick={flow.post}
          type="button"
          variant="primary"
        >
          {posting ? "Posting…" : comment ? "Post +1 comment" : "Post thread"}
        </Button>
      </PublishFoot>
    </>
  );
};

export type PublishDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  item: string;
  id: string;
  onPosted: () => void;
  /** Says, as the CLI does, that a cancelled publish sent nothing. */
  onCancelled: () => void;
};

export const PublishDialog = ({
  open,
  onOpenChange,
  client,
  item,
  id,
  onPosted,
  onCancelled,
}: PublishDialogProps) => {
  const region = useRef<HTMLElement>(null);
  const tracked = useRef<Tracked>({ busy: false, tried: false });
  const onStep = useCallback((step: PublishStep): void => {
    const posting = step.step === "posting";
    tracked.current = {
      busy: posting,
      tried: tracked.current.tried || posting || step.step === "posted",
    };
  }, []);
  const close = (): void => {
    if (tracked.current.busy) return;
    if (!tracked.current.tried) onCancelled();
    tracked.current = { busy: false, tried: false };
    onOpenChange(false);
  };
  return (
    <Dialog
      initialFocus={region}
      onOpenChange={next => {
        if (next) onOpenChange(true);
        else close();
      }}
      open={open}
      size="wide"
      title={`Publish ${id} to Ork's Discussions`}
    >
      <PublishBody
        client={client}
        id={id}
        item={item}
        onClose={close}
        onPosted={onPosted}
        onStep={onStep}
        region={region}
      />
    </Dialog>
  );
};
