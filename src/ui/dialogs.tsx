import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export const toastMsg = signal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2500) {
  toastMsg.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = null), ms);
}

type ModalRender = (close: () => void) => ComponentChildren;
export const modal = signal<ModalRender | null>(null);
export function openModal(render: ModalRender) {
  modal.value = render;
}
export function closeModal() {
  modal.value = null;
}

export function confirmDialog(
  message: string,
  opts: { ok?: string; danger?: boolean; title?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    openModal((close) => (
      <div>
        {opts.title && <h3>{opts.title}</h3>}
        <p style="white-space:pre-line">{message}</p>
        <div class="row">
          <button class="btn grow" onClick={() => (close(), resolve(false))}>
            Cancel
          </button>
          <button class={`btn grow ${opts.danger ? 'danger' : 'primary'}`} onClick={() => (close(), resolve(true))}>
            {opts.ok ?? 'OK'}
          </button>
        </div>
      </div>
    ));
  });
}

function PromptBody(props: {
  title: string;
  initial: string;
  multiline?: boolean;
  placeholder?: string;
  onDone: (v: string | null) => void;
}) {
  const [v, setV] = useState(props.initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onDone(v);
      }}
    >
      <h3>{props.title}</h3>
      {props.multiline ? (
        <textarea value={v} placeholder={props.placeholder} onInput={(e) => setV((e.target as HTMLTextAreaElement).value)} autoFocus />
      ) : (
        <input style="width:100%" value={v} placeholder={props.placeholder} onInput={(e) => setV((e.target as HTMLInputElement).value)} autoFocus />
      )}
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn grow" onClick={() => props.onDone(null)}>
          Cancel
        </button>
        <button type="submit" class="btn primary grow">
          Save
        </button>
      </div>
    </form>
  );
}

export function promptDialog(
  title: string,
  initial = '',
  opts: { multiline?: boolean; placeholder?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    openModal((close) => (
      <PromptBody
        title={title}
        initial={initial}
        {...opts}
        onDone={(v) => {
          close();
          resolve(v);
        }}
      />
    ));
  });
}

export interface SheetAction {
  label: string;
  danger?: boolean;
  run: () => void;
}
export function actionSheet(title: string, actions: SheetAction[]) {
  openModal((close) => (
    <div>
      <h3>{title}</h3>
      {actions.map((a) => (
        <button
          class={`btn block ${a.danger ? 'danger' : ''}`}
          style="margin-bottom:8px"
          onClick={() => {
            close();
            a.run();
          }}
        >
          {a.label}
        </button>
      ))}
      <button class="btn block ghost" onClick={close}>
        Cancel
      </button>
    </div>
  ));
}

export function DialogHost() {
  const render = modal.value;
  return (
    <>
      {render && (
        <div class="modal-back" onClick={closeModal}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            {render(closeModal)}
          </div>
        </div>
      )}
      {toastMsg.value && <div class="toast">{toastMsg.value}</div>}
    </>
  );
}
