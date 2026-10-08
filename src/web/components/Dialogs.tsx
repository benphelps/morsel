// Styled stand-ins for confirm() and prompt(). Call confirmDialog / promptDialog
// from anywhere and await the answer; <DialogHost /> (mounted once in App)
// shows them one at a time in a native modal <dialog>, which traps focus and
// closes on Escape.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";

interface Request {
  id: number;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive: the confirm button is red. */
  danger?: boolean;
  /** Present for prompts: the text field's starting value. */
  input?: { value: string; placeholder?: string };
  resolve(answer: string | null): void;
}

const useDialogs = create<{ queue: Request[] }>(() => ({ queue: [] }));
let nextId = 1;

function open(req: Omit<Request, "id">) {
  useDialogs.setState((s) => ({ queue: [...s.queue, { ...req, id: nextId++ }] }));
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Resolves true if the user confirms, false if they cancel (button, Escape or a click outside). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => open({ confirmLabel: "OK", cancelLabel: "Cancel", ...opts, resolve: (a) => resolve(a !== null) }));
}

/** Resolves to the entered text (trimmed), or null if cancelled or left empty. */
export function promptDialog(opts: ConfirmOptions & { value?: string; placeholder?: string }): Promise<string | null> {
  const { value = "", placeholder, ...rest } = opts;
  return new Promise((resolve) =>
    open({ confirmLabel: "OK", cancelLabel: "Cancel", ...rest, input: { value, placeholder }, resolve: (a) => resolve(a?.trim() ? a.trim() : null) }),
  );
}

export function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);
  return req ? <Dialog key={req.id} req={req} /> : null;
}

function Dialog({ req }: { req: Request }) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(req.input?.value ?? "");

  useEffect(() => {
    ref.current?.showModal();
    // Prompts start with their text selected. Destructive confirmations start on
    // Cancel, so a stray Enter can't delete anything; others on the confirm button.
    if (req.input) inputRef.current?.select();
    else (req.danger ? cancelRef : confirmRef).current?.focus();
  }, [req.input, req.danger]);

  const finish = (ok: boolean) => {
    ref.current?.close();
    useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
    req.resolve(ok ? (req.input ? value : "") : null);
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`dialog-title-${req.id}`}
      onCancel={(e) => {
        e.preventDefault(); // Escape: close through finish() so the caller hears back
        finish(false);
      }}
      // Keep keys (Space, Delete, Escape…) away from the editor's shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
      // A click on the backdrop lands on the <dialog> itself; the form covers the rest.
      onMouseDown={(e) => e.target === ref.current && finish(false)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          finish(true);
        }}
      >
        <h3 id={`dialog-title-${req.id}`}>{req.title}</h3>
        {req.message && <div className="dialog-message">{req.message}</div>}
        {req.input && <input ref={inputRef} value={value} placeholder={req.input.placeholder} onChange={(e) => setValue(e.target.value)} />}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={() => finish(false)}>
            {req.cancelLabel}
          </button>
          <button ref={confirmRef} type="submit" className={`btn ${req.danger ? "danger solid" : "primary"}`} disabled={!!req.input && !value.trim()}>
            {req.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
