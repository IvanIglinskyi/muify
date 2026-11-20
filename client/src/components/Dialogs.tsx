import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** Textarea instead of a one-line input (line breaks are kept). */
  multiline?: boolean;
  /** Allow confirming an empty value (resolves with ""). */
  allowEmpty?: boolean;
  /** Helper text under the field. */
  hint?: string;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogApi {
  /** Resolves with the trimmed text, or null if cancelled ("" only with `allowEmpty`). */
  prompt: (o: PromptOptions) => Promise<string | null>;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}

type Pending = { id: number } & (
  | { kind: "prompt"; options: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; options: ConfirmOptions; resolve: (v: boolean) => void }
);

let nextId = 1;

const DialogContext = createContext<DialogApi | null>(null);

/**
 * App-wide modal dialogs on the native <dialog> element: focus is trapped, Escape cancels,
 * and focus returns to the element that opened it.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => setPending({ id: nextId++, kind: "prompt", options, resolve })),
    []
  );
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ id: nextId++, kind: "confirm", options, resolve })),
    []
  );

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}
      {pending && <Modal key={pending.id} pending={pending} onDone={() => setPending(null)} />}
    </DialogContext.Provider>
  );
}

function Modal({ pending, onDone }: { pending: Pending; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [text, setText] = useState(pending.kind === "prompt" ? pending.options.initial ?? "" : "");
  const settled = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const finish = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (pending.kind === "prompt") {
      const o = pending.options;
      const value = o.multiline
        ? text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
        : text.replace(/\s+/g, " ").trim();
      pending.resolve(ok ? (value || (o.allowEmpty ? "" : null)) : null);
    }
    else pending.resolve(ok);
    ref.current?.close();
    onDone();
    // The opener may have been a menu item that no longer exists; fall back to the body.
    const el = opener.current as HTMLElement | null;
    if (el?.isConnected) el.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pending.kind === "prompt" && !text.trim() && !pending.options.allowEmpty) return;
    finish(true);
  };

  const o = pending.options;
  const titleId = "dialog-title";
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) finish(false); // backdrop click
      }}
    >
      <form onSubmit={onSubmit} className="modal-body">
        <h2 id={titleId} className="modal-title">
          {o.title}
        </h2>
        {pending.kind === "prompt" ? (
          <label className="field">
            <span>{pending.options.label}</span>
            {pending.options.multiline ? (
              <textarea
                autoFocus
                rows={4}
                value={text}
                maxLength={pending.options.maxLength ?? 300}
                aria-describedby={pending.options.hint ? "dialog-hint" : undefined}
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              <input
                autoFocus
                value={text}
                maxLength={pending.options.maxLength ?? 60}
                aria-describedby={pending.options.hint ? "dialog-hint" : undefined}
                onChange={(e) => setText(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            )}
            {pending.options.hint && (
              <small id="dialog-hint" className="field-hint">
                {pending.options.hint}
              </small>
            )}
          </label>
        ) : (
          <p className="modal-text">{pending.options.message}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={() => finish(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className={`pill-btn${pending.kind === "confirm" && pending.options.danger ? " is-danger" : ""}`}
            disabled={pending.kind === "prompt" && !text.trim() && !pending.options.allowEmpty}
            autoFocus={pending.kind === "confirm"}
          >
            {o.confirmLabel ?? "OK"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used inside <DialogProvider>");
  return ctx;
}
