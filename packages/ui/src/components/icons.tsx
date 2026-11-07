/**
 * @file The UI's icons, from Material Design Icons (`@mdi/js`, ADR-042), named
 *   for what they mean here. Each is one path on MDI's 24 px grid, drawn in the
 *   current text color at the font's size, and the bundle takes only the ones
 *   imported. A status has its own drawn glyph instead (status-glyphs.tsx).
 *   Icons are decoration: the word or the accessible name beside one says what
 *   it means.
 */

import {
  mdiAccountCheckOutline,
  mdiAccountStarOutline,
  mdiAlertOutline,
  mdiArrowDown,
  mdiArrowLeft,
  mdiArrowRight,
  mdiArrowUp,
  mdiArrowUpCircleOutline,
  mdiAws,
  mdiBellOutline,
  mdiCallMerge,
  mdiCallSplit,
  mdiCheck,
  mdiChevronDown,
  mdiChevronRight,
  mdiClose,
  mdiConsoleLine,
  mdiContentCopy,
  mdiDockBottom,
  mdiDockWindow,
  mdiFileTreeOutline,
  mdiFitToScreenOutline,
  mdiChartBar,
  mdiPencilRuler,
  mdiFormatListBulleted,
  mdiForumOutline,
  mdiGit,
  mdiGithub,
  mdiGraphOutline,
  mdiHelpBoxMultipleOutline,
  mdiKeyboardOutline,
  mdiLayersOutline,
  mdiMagnify,
  mdiMessageAlertOutline,
  mdiMinus,
  mdiNoteEditOutline,
  mdiOpenInNew,
  mdiPause,
  mdiPlay,
  mdiPlus,
  mdiRestart,
  mdiRobotHappyOutline,
  mdiRobotOutline,
  mdiSourceBranch,
  mdiSourceRepositoryMultiple,
  mdiStop,
  mdiTextBoxOutline,
  mdiWindowMaximize,
  mdiWindowMinimize,
  mdiWindowRestore,
} from "@mdi/js";

const icon = (path: string) => {
  const Icon = () => (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
    >
      <path d={path} />
    </svg>
  );
  return Icon;
};

export const IconPlay = icon(mdiPlay);
export const IconPause = icon(mdiPause);
export const IconStop = icon(mdiStop);
export const IconClose = icon(mdiClose);
export const IconCheck = icon(mdiCheck);
export const IconChevronDown = icon(mdiChevronDown);
export const IconChevronRight = icon(mdiChevronRight);
export const IconArrowLeft = icon(mdiArrowLeft);
export const IconArrowRight = icon(mdiArrowRight);
export const IconArrowUp = icon(mdiArrowUp);
export const IconArrowDown = icon(mdiArrowDown);
export const IconCopy = icon(mdiContentCopy);
export const IconSearch = icon(mdiMagnify);
export const IconConsole = icon(mdiConsoleLine);

export const IconMinimize = icon(mdiWindowMinimize);
export const IconMaximize = icon(mdiWindowMaximize);
export const IconRestore = icon(mdiWindowRestore);
export const IconFloat = icon(mdiDockWindow);
export const IconDock = icon(mdiDockBottom);

export const IconRuns = icon(mdiFormatListBulleted);
export const IconMonitor = icon(mdiGraphOutline);
export const IconLogs = icon(mdiTextBoxOutline);
export const IconDecisions = icon(mdiHelpBoxMultipleOutline);
export const IconChats = icon(mdiForumOutline);
export const IconNotifications = icon(mdiBellOutline);
export const IconUsage = icon(mdiChartBar);
export const IconBuilder = icon(mdiPencilRuler);
export const IconContext = icon(mdiLayersOutline);
export const IconAlert = icon(mdiAlertOutline);
export const IconFeedback = icon(mdiMessageAlertOutline);
export const IconNote = icon(mdiNoteEditOutline);
export const IconExternal = icon(mdiOpenInNew);
export const IconWorktrees = icon(mdiSourceRepositoryMultiple);

export const IconLeader = icon(mdiAccountStarOutline);
export const IconWorker = icon(mdiRobotOutline);
export const IconSubagent = icon(mdiRobotHappyOutline);
export const IconSplit = icon(mdiCallSplit);
export const IconJoin = icon(mdiCallMerge);
export const IconRouter = icon(mdiSourceBranch);
export const IconGate = icon(mdiAccountCheckOutline);
export const IconCall = icon(mdiFileTreeOutline);
export const IconGitHub = icon(mdiGithub);
export const IconAws = icon(mdiAws);
export const IconGit = icon(mdiGit);
export const IconPlus = icon(mdiPlus);
export const IconMinus = icon(mdiMinus);
export const IconFit = icon(mdiFitToScreenOutline);
export const IconKeyboard = icon(mdiKeyboardOutline);
export const IconUpgrade = icon(mdiArrowUpCircleOutline);
export const IconRestart = icon(mdiRestart);
