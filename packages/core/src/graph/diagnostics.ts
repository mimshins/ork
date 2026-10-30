/** @file Constructors for the compiler's error and warning diagnostics. */

import type { Diagnostic, DiagnosticPath } from "@krapht/ork-schema";

export const error = (
  code: string,
  message: string,
  path: DiagnosticPath,
): Diagnostic => ({ severity: "error", code, message, path });

export const warning = (
  code: string,
  message: string,
  path: DiagnosticPath,
): Diagnostic => ({ severity: "warning", code, message, path });
